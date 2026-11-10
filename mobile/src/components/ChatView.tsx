import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack } from 'expo-router/stack';
import {
	BellOff,
	Ellipsis,
	ImagePlus,
	Pencil,
	Reply,
	SendHorizontal,
	Trash2,
	X,
	Copy
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorMessage, getPage, uploadImage } from '@/lib/api';
import { emit, useBus } from '@/lib/bus';
import { clock, dayLabel, groupEventText, sameDay } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import type {
	Gif,
	Group,
	GroupMessage,
	GroupMessageKind,
	Message,
	Reaction,
	User
} from '@/lib/types';
import { AttachmentStrip, pickImages, type Picked } from './attachments';
import { GifPicker } from './GifPicker';
import { GifMedia, ImageGrid, QuoteCard } from './media';
import { confirm, showMenu, toast } from './overlays';
import { RichText } from './RichText';
import { Avatar, ErrorBanner, IconButton, Loading, Notice, Txt } from './ui';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];
/** how long after sending a message can still be edited */
const EDIT_WINDOW_MS = 60 * 60 * 1000;

/** direct and group messages in one shape: the sender is always a profile */
type Msg = Omit<GroupMessage, 'group_id'>;

type DirectInfo = {
	peer: User;
	block: { me: boolean; peer: boolean };
	muted: boolean;
	first_unread_id: number | null;
};

type Props = { kind: 'direct'; username: string } | { kind: 'group'; id: number };

/** A conversation: with one profile (`direct`) or a group chat. */
export function ChatView(props: Props) {
	const { me, instance, profileKey } = useSession();
	const insets = useSafeAreaInsets();
	const headerHeight = useHeaderHeight();
	const direct = props.kind === 'direct';
	const base = direct ? `conversations/${props.username}` : `groups/${props.id}`;
	const myName = me?.user.username ?? '';

	const [info, setInfo] = useState<DirectInfo | null>(null);
	const [group, setGroup] = useState<Group | null>(null);
	const [messages, setMessages] = useState<Msg[]>([]);
	const [firstUnread, setFirstUnread] = useState<number | null>(null);
	const [muted, setMuted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const older = useRef<string | null>(null);
	const loadingOlder = useRef(false);
	const list = useRef<FlatList<Msg>>(null);
	const focused = useRef(false);
	const scrollTries = useRef(0);

	// what is being written
	const [text, setText] = useState('');
	const [images, setImages] = useState<Picked[]>([]);
	const [gif, setGif] = useState<{ gif: Gif; sent: () => void } | null>(null);
	const [picking, setPicking] = useState(false);
	const [replyTo, setReplyTo] = useState<Msg | null>(null);
	const [editing, setEditing] = useState<Msg | null>(null);
	const [sending, setSending] = useState(false);
	const [typing, setTyping] = useState<string | null>(null);
	const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const lastTyping = useRef(0);

	const peer = info?.peer;
	const normalize = useCallback(
		(message: Message | GroupMessage): Msg => {
			if (typeof message.sender !== 'string') return message as GroupMessage;
			const m = message as Message;
			const sender: User =
				m.sender === myName && me
					? me.user
					: peer ?? { username: m.sender, name: m.sender, avatar: null };
			return { ...m, kind: 'message', sender, target: null };
		},
		[me, myName, peer]
	);

	const markRead = useCallback(() => {
		api(`${base}/read`, { method: 'POST' })
			.then(() => emit('chats_changed'))
			.catch(() => {});
	}, [base]);

	const load = useCallback(async () => {
		try {
			let first: number | null;
			let other: User | undefined;
			if (direct) {
				const res = await api<DirectInfo>(base);
				setInfo(res);
				setMuted(res.muted);
				first = res.first_unread_id;
				other = res.peer;
			} else {
				const res = await api<Group>(base);
				setGroup(res);
				setMuted(res.muted);
				first = res.first_unread_id;
			}
			const self = me?.user;
			const toMsg = (m: Message | GroupMessage): Msg =>
				typeof m.sender === 'string'
					? {
							...(m as Message),
							kind: 'message' as GroupMessageKind,
							target: null,
							sender:
								m.sender === self?.username && self
									? self
									: other ?? { username: m.sender, name: m.sender, avatar: null }
					  }
					: (m as GroupMessage);
			let page = await getPage<Message | GroupMessage>(`${base}/messages`);
			let all = page.items;
			// the first unread message may be further back than one page: load up to it
			for (
				let i = 0;
				i < 10 && first && page.next_cursor && !all.some((m) => m.id === first);
				i++
			) {
				page = await getPage<Message | GroupMessage>(`${base}/messages`, page.next_cursor);
				all = [...page.items, ...all];
			}
			older.current = page.next_cursor;
			setMessages(all.map(toMsg));
			setFirstUnread(first);
			setError(null);
			if (first) {
				if (focused.current) markRead();
				// open at the divider: the list is inverted, so indexes count from the newest
				const index = all.length - 1 - all.findIndex((m) => m.id === first);
				scrollTries.current = 0;
				if (index > 3)
					setTimeout(
						() => list.current?.scrollToIndex({ index, viewPosition: 1, animated: false }),
						100
					);
			}
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setLoading(false);
		}
	}, [base, direct, markRead, myName]);

	useEffect(() => {
		load();
	}, [load, profileKey]);
	useBus('stream_open', load);

	useFocusEffect(
		useCallback(() => {
			focused.current = true;
			return () => {
				focused.current = false;
			};
		}, [])
	);

	async function loadOlder() {
		if (!older.current || loadingOlder.current) return;
		loadingOlder.current = true;
		try {
			const page = await getPage<Message | GroupMessage>(`${base}/messages`, older.current);
			older.current = page.next_cursor;
			setMessages((now) => {
				const seen = new Set(now.map((m) => m.id));
				return [...page.items.map(normalize).filter((m) => !seen.has(m.id)), ...now];
			});
		} catch {
			// scrolling again retries
		} finally {
			loadingOlder.current = false;
		}
	}

	// realtime
	const add = (message: Msg) => {
		setMessages((now) => (now.some((m) => m.id === message.id) ? now : [...now, message]));
		if (message.sender.username !== myName && message.kind === 'message') {
			setTyping(null);
			if (focused.current) markRead();
		}
	};
	const replace = (message: Msg) =>
		setMessages((now) => now.map((m) => (m.id === message.id ? message : m)));
	const remove = (id: number) => setMessages((now) => now.filter((m) => m.id !== id));
	const setReactions = (id: number, reactions: Reaction[]) =>
		setMessages((now) => now.map((m) => (m.id === id ? { ...m, reactions } : m)));

	const here = (m: Message) =>
		direct &&
		((m.sender === props.username && m.recipient === myName) ||
			(m.sender === myName && m.recipient === props.username));
	const thisGroup = (e: { group_id: number }) => !direct && e.group_id === props.id;

	useBus('message', (m: Message) => here(m) && add(normalize(m)));
	useBus('message_edited', (m: Message) => here(m) && replace(normalize(m)));
	useBus('message_deleted', (e: { id: number }) => direct && remove(e.id));
	useBus(
		'message_reactions',
		(e: { id: number; reactions: Reaction[] }) => direct && setReactions(e.id, e.reactions)
	);
	useBus('group_message', (m: GroupMessage) => thisGroup(m) && add(m));
	useBus('group_message_edited', (m: GroupMessage) => thisGroup(m) && replace(m));
	useBus(
		'group_message_deleted',
		(e: { group_id: number; id: number }) => thisGroup(e) && remove(e.id)
	);
	useBus(
		'group_message_reactions',
		(e: { group_id: number; id: number; reactions: Reaction[] }) =>
			thisGroup(e) && setReactions(e.id, e.reactions)
	);
	useBus('group_updated', (e: { id: number }) => {
		if (direct || e.id !== props.id) return;
		api<Group>(base)
			.then(setGroup)
			.catch(() => router.canGoBack() && router.back());
	});
	useBus('typing', (e: { group_id: number | null; user: { username: string; name: string } }) => {
		const mine = direct
			? e.group_id === null && e.user.username === props.username
			: e.group_id === props.id && e.user.username !== myName;
		if (!mine) return;
		setTyping(e.user.name);
		clearTimeout(typingTimer.current);
		typingTimer.current = setTimeout(() => setTyping(null), 5000);
	});
	useEffect(() => () => clearTimeout(typingTimer.current), []);

	function onChangeText(value: string) {
		setText(value);
		if (value && !editing && Date.now() - lastTyping.current > 3500) {
			lastTyping.current = Date.now();
			api(`${base}/typing`, { method: 'POST' }).catch(() => {});
		}
	}

	async function send() {
		if (sending) return;
		const content = text.trim();
		setSending(true);
		setError(null);
		try {
			if (editing) {
				const res = await api<Message | GroupMessage>(`${base}/messages/${editing.id}`, {
					method: 'PATCH',
					body: { content }
				});
				replace(normalize(res));
				setEditing(null);
			} else {
				if (!content && !images.length && !gif) return;
				const uploads: string[] = [];
				for (const image of images) uploads.push(await uploadImage(image));
				const res = await api<Message | GroupMessage>(`${base}/messages`, {
					method: 'POST',
					body: { content, uploads, gif: gif?.gif ?? null, reply_to: replyTo?.id ?? null }
				});
				gif?.sent();
				add(normalize(res));
				setImages([]);
				setGif(null);
				setReplyTo(null);
				setFirstUnread(null);
				list.current?.scrollToOffset({ offset: 0, animated: true });
			}
			setText('');
			emit('chats_changed');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setSending(false);
		}
	}

	async function react(message: Msg, emoji: string) {
		const mine = message.reactions.find((r) => r.username === myName);
		try {
			const res = await api<{ reactions: Reaction[] }>(`${base}/messages/${message.id}/reaction`, {
				method: mine?.emoji === emoji ? 'DELETE' : 'PUT',
				body: mine?.emoji === emoji ? {} : { emoji }
			});
			setReactions(message.id, res.reactions);
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	function messageMenu(message: Msg) {
		const mine = message.sender.username === myName;
		const editable = mine && Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;
		const icon = { size: 18, color: colors.foreground };
		showMenu(
			[
				{
					label: 'Reply',
					icon: <Reply {...icon} />,
					onPress: () => {
						setEditing(null);
						setReplyTo(message);
					}
				},
				!!message.content && {
					label: 'Copy text',
					icon: <Copy {...icon} />,
					onPress: async () => {
						await Clipboard.setStringAsync(message.content);
						toast('Copied');
					}
				},
				editable && {
					label: 'Edit',
					icon: <Pencil {...icon} />,
					onPress: () => {
						setReplyTo(null);
						setEditing(message);
						setText(message.content);
					}
				},
				mine && {
					label: 'Delete',
					danger: true,
					icon: <Trash2 size={18} color={colors.danger} />,
					onPress: async () => {
						if (!(await confirm('Delete message?', 'It is deleted for everyone.', 'Delete', true)))
							return;
						try {
							await api(`${base}/messages/${message.id}`, { method: 'DELETE' });
							remove(message.id);
							emit('chats_changed');
						} catch (e) {
							toast(errorMessage(e));
						}
					}
				}
			],
			{
				list: QUICK_REACTIONS,
				selected: message.reactions.find((r) => r.username === myName)?.emoji,
				onPick: (emoji) => react(message, emoji)
			}
		);
	}

	async function toggleMute() {
		try {
			const res = await api<{ muted: boolean }>(`${base}/mute`, {
				method: muted ? 'DELETE' : 'PUT'
			});
			setMuted(res.muted);
			emit('chats_changed');
			toast(res.muted ? 'Muted' : 'Unmuted');
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	function chatMenu() {
		if (direct) {
			showMenu([
				{ label: 'View profile', onPress: () => router.push(`/user/${props.username}`) },
				{ label: muted ? 'Unmute' : 'Mute', onPress: toggleMute },
				info && {
					label: info.block.me ? 'Unblock' : 'Block',
					danger: !info.block.me,
					onPress: async () => {
						try {
							const res = await api<{ blocked: boolean; blocks_you: boolean }>(
								`users/${props.username}/block`,
								{ method: info.block.me ? 'DELETE' : 'PUT' }
							);
							setInfo({ ...info, block: { me: res.blocked, peer: res.blocks_you } });
						} catch (e) {
							toast(errorMessage(e));
						}
					}
				}
			]);
		} else {
			showMenu([
				{ label: 'Group info', onPress: () => router.push(`/group/${props.id}/settings`) },
				{ label: muted ? 'Unmute' : 'Mute', onPress: toggleMute }
			]);
		}
	}

	// the list is inverted: newest first
	const data = useMemo(() => [...messages].reverse(), [messages]);
	const title = direct ? peer?.name ?? `@${props.username}` : group?.name ?? 'Group';
	const blocked = direct && info ? info.block.me || info.block.peer : false;
	const maxImages = instance?.limits.messageImages ?? 5;
	const banner = editing ?? replyTo;

	const renderItem = ({ item, index }: { item: Msg; index: number }) => {
		const previous = data[index + 1];
		const newDay = !previous || !sameDay(previous.created_at, item.created_at);
		const mine = item.sender.username === myName;
		const grouped = groupReactions(item.reactions);
		const showSender =
			!direct &&
			!mine &&
			(newDay || previous?.sender.username !== item.sender.username || previous.kind !== 'message');
		return (
			<View>
				{newDay ? (
					<Txt size={13} muted style={{ textAlign: 'center', paddingVertical: 10 }}>
						{dayLabel(item.created_at)}
					</Txt>
				) : null}
				{item.id === firstUnread ? (
					<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
						<View style={{ flex: 1, height: 1, backgroundColor: colors.accent }} />
						<Txt size={13} accent>
							New messages
						</Txt>
						<View style={{ flex: 1, height: 1, backgroundColor: colors.accent }} />
					</View>
				) : null}
				{item.kind !== 'message' ? (
					<Txt size={13} muted style={{ textAlign: 'center', paddingVertical: 6 }}>
						{groupEventText(item, myName)}
					</Txt>
				) : (
					<View
						style={{
							flexDirection: 'row',
							justifyContent: mine ? 'flex-end' : 'flex-start',
							alignItems: 'flex-end',
							gap: 8,
							marginTop: showSender ? 8 : 3
						}}
					>
						{!direct && !mine ? (
							<View style={{ width: 28 }}>
								{showSender ? <Avatar user={item.sender} size={28} link /> : null}
							</View>
						) : null}
						<View style={{ maxWidth: '80%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
							{showSender ? (
								<Txt size={13} bold dim={0.8} style={{ marginBottom: 2 }}>
									{item.sender.name}
								</Txt>
							) : null}
							<Pressable
								onLongPress={() => messageMenu(item)}
								delayLongPress={250}
								accessibilityHint="Long press to react, reply, edit, copy or delete"
								style={{
									borderRadius: 10,
									borderWidth: 1,
									borderColor: mine ? colors.accent : colors.line,
									backgroundColor: mine ? 'rgba(121,154,116,0.15)' : 'rgba(255,255,255,0.04)',
									paddingVertical: 7,
									paddingHorizontal: 10,
									gap: 6
								}}
							>
								{item.reply_to ? (
									<View
										style={{ borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 8 }}
									>
										<Txt size={13} bold accent>
											{item.reply_to.sender.name}
										</Txt>
										<Txt size={13} muted numberOfLines={2}>
											{item.reply_to.content ||
												(item.reply_to.gif
													? 'GIF'
													: item.reply_to.images
													? `${item.reply_to.images} ${
															item.reply_to.images === 1 ? 'image' : 'images'
													  }`
													: '')}
										</Txt>
									</View>
								) : null}
								{item.images.length ? (
									<View style={{ width: 230 }}>
										<ImageGrid images={item.images} isPrivate height={200} />
									</View>
								) : null}
								{item.gif ? (
									<View style={{ width: 230 }}>
										<GifMedia gif={item.gif} maxHeight={230} />
									</View>
								) : null}
								{item.content ? <RichText content={item.content} /> : null}
								{item.linked_post ? (
									<View style={{ width: 230 }}>
										<QuoteCard quote={item.linked_post} />
									</View>
								) : null}
								<Txt size={11} muted style={{ alignSelf: 'flex-end' }}>
									{item.edited_at ? 'edited · ' : ''}
									{clock(item.created_at)}
								</Txt>
							</Pressable>
							{grouped.length ? (
								<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
									{grouped.map((reaction) => (
										<Pressable
											key={reaction.emoji}
											accessibilityLabel={`${reaction.emoji} ${reaction.by.length}`}
											onPress={() =>
												reaction.mine
													? react(item, reaction.emoji)
													: toast(`${reaction.emoji} ${reaction.by.map((r) => r.name).join(', ')}`)
											}
											onLongPress={() =>
												toast(`${reaction.emoji} ${reaction.by.map((r) => r.name).join(', ')}`)
											}
											style={{
												flexDirection: 'row',
												gap: 3,
												borderRadius: 12,
												borderWidth: 1,
												borderColor: reaction.mine ? colors.accent : colors.line,
												paddingHorizontal: 6,
												paddingVertical: 1
											}}
										>
											<Txt size={13}>{reaction.emoji}</Txt>
											{reaction.by.length > 1 ? (
												<Txt size={13} muted>
													{reaction.by.length}
												</Txt>
											) : null}
										</Pressable>
									))}
								</View>
							) : null}
						</View>
					</View>
				)}
			</View>
		);
	};

	function groupReactions(reactions: Reaction[]) {
		const byEmoji = new Map<string, Reaction[]>();
		for (const r of reactions) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r]);
		return [...byEmoji].map(([emoji, by]) => ({
			emoji,
			by,
			mine: by.some((r) => r.username === myName)
		}));
	}

	return (
		<KeyboardAvoidingView
			behavior="padding"
			keyboardVerticalOffset={headerHeight}
			style={{ flex: 1 }}
		>
			<Stack.Screen
				options={{
					headerTitle: () => (
						<Pressable
							onPress={() =>
								router.push(direct ? `/user/${props.username}` : `/group/${props.id}/settings`)
							}
							style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
						>
							{peer ? <Avatar user={peer} size={30} /> : null}
							<Txt bold size={18} numberOfLines={1} style={{ maxWidth: 200 }}>
								{title}
							</Txt>
							{muted ? <BellOff size={14} color={colors.muted} /> : null}
						</Pressable>
					),
					headerRight: () => (
						<IconButton label="Chat options" onPress={chatMenu}>
							<Ellipsis size={22} color={colors.foreground} />
						</IconButton>
					)
				}}
			/>
			{loading ? (
				<View style={{ flex: 1 }}>
					<Loading />
				</View>
			) : (
				<FlatList
					ref={list}
					inverted
					data={data}
					keyExtractor={(message) => String(message.id)}
					renderItem={renderItem}
					onEndReached={loadOlder}
					onEndReachedThreshold={0.5}
					onScrollToIndexFailed={({ averageItemLength, index }) => {
						// the row isn't rendered yet: go near it by estimate, then ask again
						list.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
						if (scrollTries.current++ < 10)
							setTimeout(
								() => list.current?.scrollToIndex({ index, viewPosition: 1, animated: false }),
								150
							);
					}}
					contentContainerStyle={{ paddingHorizontal: 15, paddingVertical: 10 }}
					keyboardShouldPersistTaps="handled"
					ListEmptyComponent={
						<View style={{ transform: [{ scaleY: -1 }] }}>
							<Txt muted style={{ textAlign: 'center', padding: 40 }}>
								No messages yet. Say hi!
							</Txt>
						</View>
					}
				/>
			)}
			<View
				style={{
					paddingHorizontal: 15,
					paddingTop: 8,
					paddingBottom: insets.bottom + 8,
					borderTopWidth: 1,
					borderTopColor: colors.line,
					gap: 8
				}}
			>
				{typing ? (
					<Txt size={13} muted>
						{direct ? 'typing…' : `${typing} is typing…`}
					</Txt>
				) : null}
				<ErrorBanner message={error} />
				{blocked ? (
					<Notice>
						{info?.block.me
							? 'You blocked this profile. Unblock it to send messages.'
							: 'This profile blocked you.'}
					</Notice>
				) : me?.muted ? (
					<Notice>Your account is muted: you can’t send messages.</Notice>
				) : (
					<>
						{banner ? (
							<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
								<View
									style={{
										flex: 1,
										borderLeftWidth: 2,
										borderLeftColor: colors.accent,
										paddingLeft: 8
									}}
								>
									<Txt size={13} bold accent>
										{editing ? 'Editing' : `Replying to ${banner.sender.name}`}
									</Txt>
									<Txt size={13} muted numberOfLines={1}>
										{banner.content || (banner.gif ? 'GIF' : 'Image')}
									</Txt>
								</View>
								<IconButton
									label={editing ? 'Cancel editing' : 'Cancel reply'}
									onPress={() => {
										if (editing) setText('');
										setEditing(null);
										setReplyTo(null);
									}}
								>
									<X size={18} color={colors.muted} />
								</IconButton>
							</View>
						) : null}
						<AttachmentStrip
							images={images}
							gif={gif?.gif ?? null}
							onRemoveImage={(index) => setImages((now) => now.filter((_, i) => i !== index))}
							onRemoveGif={() => setGif(null)}
						/>
						<View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
							{editing ? null : (
								<>
									<IconButton
										label="Attach images"
										style={{ paddingBottom: 8 }}
										onPress={async () => {
											if (gif) return toast('A message can have a GIF or images, not both');
											const picked = await pickImages(maxImages - images.length);
											setImages((now) => [...now, ...picked].slice(0, maxImages));
										}}
									>
										<ImagePlus size={22} color={colors.accent} />
									</IconButton>
									{instance?.gifs ? (
										<IconButton
											label="Send a GIF"
											style={{ paddingBottom: 9 }}
											onPress={() => {
												if (images.length)
													return toast('A message can have a GIF or images, not both');
												setPicking(true);
											}}
										>
											<Txt bold accent size={15}>
												GIF
											</Txt>
										</IconButton>
									) : null}
								</>
							)}
							<TextInput
								multiline
								value={text}
								onChangeText={onChangeText}
								maxLength={instance?.limits.messageContent}
								placeholder={editing ? 'Edit your message' : 'Write a message'}
								placeholderTextColor={colors.muted}
								selectionColor={colors.accent}
								style={{
									flex: 1,
									maxHeight: 120,
									fontFamily: fonts.medium,
									fontSize: 16,
									color: colors.foreground,
									borderBottomWidth: 1,
									borderBottomColor: colors.line,
									paddingVertical: 8,
									paddingHorizontal: 0
								}}
							/>
							<IconButton
								label={editing ? 'Save' : 'Send'}
								style={{ paddingBottom: 8, opacity: sending ? 0.5 : 1 }}
								onPress={send}
							>
								<SendHorizontal size={24} color={colors.accent} />
							</IconButton>
						</View>
					</>
				)}
			</View>
			{instance?.gifs ? (
				<GifPicker
					config={instance.gifs}
					visible={picking}
					onClose={() => setPicking(false)}
					onPick={(picked, sent) => setGif({ gif: picked, sent })}
				/>
			) : null}
		</KeyboardAvoidingView>
	);
}
