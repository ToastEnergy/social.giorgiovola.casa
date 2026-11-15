import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
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
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
	Dimensions,
	FlatList,
	KeyboardAvoidingView,
	Modal,
	Pressable,
	ScrollView,
	TextInput,
	View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, errorMessage, getPage, uploadImage } from '@/lib/api';
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
import {
	AttachmentStrip,
	PasteImageButton,
	pickImages,
	useClipboardImage,
	type Picked
} from './attachments';
import { GifPicker } from './GifPicker';
import { MentionSuggestions, useMentionSuggestions } from './mentions';
import { GifMedia, ImageGrid, QuoteCard } from './media';
import { MessageGestures } from './MessageGestures';
import { confirm, showMenu, toast, type MenuAnchor } from './overlays';
import { RichText } from './RichText';
import { UploadProgress } from './UploadProgress';
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

/** a message on its way: shown at once, replaced by the real one when it lands */
type Pending = {
	key: number;
	/** what was typed, given back if it fails */
	content: string;
	/** what's sent */
	text: string;
	images: Picked[];
	gif: { gif: Gif; sent: () => void } | null;
	replyTo: Msg | null;
	/** share of each image uploaded, 0 to 1; 2 once done */
	progress: number[];
};

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
	const input = useRef<ComponentRef<typeof TextInput>>(null);
	const focused = useRef(false);
	/** the first load is done: from then on, focusing the chat marks it read */
	const opened = useRef(false);
	const scrollTries = useRef(0);

	// what is being written
	const [text, setText] = useState('');
	const [cursor, setCursor] = useState(0);
	const [images, setImages] = useState<Picked[]>([]);
	const [gif, setGif] = useState<{ gif: Gif; sent: () => void } | null>(null);
	const [picking, setPicking] = useState(false);
	const [replyTo, setReplyTo] = useState<Msg | null>(null);
	const bubbles = useRef(new Map<number, ComponentRef<typeof View>>());
	const pills = useRef(new Map<number, ComponentRef<typeof View>>());
	/** the message whose reactions list (who reacted with what) is open, and where */
	const [reactors, setReactors] = useState<{ id: number; anchor: MenuAnchor } | null>(null);
	const [editing, setEditing] = useState<Msg | null>(null);
	const [saving, setSaving] = useState(false);
	const [pending, setPending] = useState<Pending[]>([]);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;
	const pendingKey = useRef(0);
	// messages go out one at a time, in order, while the input is already free for the next one
	const outbox = useRef(Promise.resolve());
	const imagesRef = useRef(images);
	imagesRef.current = images;
	// group chats suggest their members for @mentions, direct chats search everyone (like the web)
	const mention = useMentionSuggestions(
		text,
		cursor,
		group
			? (query) =>
					group.members.filter(
						(m) =>
							m.username !== myName &&
							(m.username.startsWith(query) || m.name.toLowerCase().startsWith(query))
					)
			: undefined
	);
	const clipboard = useClipboardImage();
	const gifRef = useRef(gif);
	gifRef.current = gif;
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
			opened.current = true;
			// even without unread messages: unread reactions to yours also clear on read
			if (focused.current) markRead();
			if (first) {
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
			// back on the chat: what arrived while another screen was on top is seen now
			if (opened.current) markRead();
			return () => {
				focused.current = false;
			};
		}, [markRead])
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
		// our own message echoed by the stream before the send's answer: it replaces its pending
		// bubble (the oldest one with that text, they go out in order) right away
		if (message.sender.username === myName && message.kind === 'message') {
			const draft = pendingRef.current.find((p) => p.text === message.content.trim());
			if (draft) {
				pendingRef.current = pendingRef.current.filter((p) => p !== draft);
				setPending((now) => now.filter((p) => p.key !== draft.key));
			}
		}
		setMessages((now) => (now.some((m) => m.id === message.id) ? now : [...now, message]));
		if (message.sender.username !== myName && message.kind === 'message') {
			setTyping(null);
			if (focused.current) markRead();
		}
	};
	const replace = (message: Msg) =>
		setMessages((now) => now.map((m) => (m.id === message.id ? message : m)));
	const remove = (id: number) => setMessages((now) => now.filter((m) => m.id !== id));
	const setReactions = (id: number, reactions: Reaction[]) => {
		setMessages((now) => now.map((m) => (m.id === id ? { ...m, reactions } : m)));
		// a reaction to your message is unread until you see the chat, like a message
		const message = messages.find((m) => m.id === id);
		if (message?.sender.username === myName && focused.current) markRead();
	};

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

	async function saveEdit(message: Msg) {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			const res = await api<Message | GroupMessage>(`${base}/messages/${message.id}`, {
				method: 'PATCH',
				body: { content: text.trim() }
			});
			replace(normalize(res));
			setEditing(null);
			setText('');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setSaving(false);
		}
	}

	function send() {
		if (editing) return saveEdit(editing);
		const content = text.trim();
		if (!content && !images.length && !gif) return;
		const draft: Pending = {
			key: pendingKey.current++,
			content: text,
			text: content,
			images,
			gif,
			replyTo,
			progress: images.map(() => 0)
		};
		// cleared right away, so the next message can be typed while this one is on its way
		setText('');
		setImages([]);
		setGif(null);
		setReplyTo(null);
		setError(null);
		setFirstUnread(null);
		pendingRef.current = [...pendingRef.current, draft];
		setPending(pendingRef.current);
		outbox.current = outbox.current.then(() => post(draft));
		list.current?.scrollToOffset({ offset: 0, animated: true });
	}

	async function post(draft: Pending) {
		const setProgress = (i: number, share: number) =>
			setPending((now) =>
				now.map((p) =>
					p.key === draft.key
						? { ...p, progress: p.progress.map((v, j) => (j === i ? share : v)) }
						: p
				)
			);
		const settle = () => {
			pendingRef.current = pendingRef.current.filter((p) => p.key !== draft.key);
			setPending((now) => now.filter((p) => p.key !== draft.key));
		};
		const sendOnce = async () => {
			const uploads: string[] = [];
			for (const [i, image] of draft.images.entries()) {
				uploads.push(await uploadImage(image, { onProgress: (share) => setProgress(i, share) }));
				setProgress(i, 2);
			}
			return api<Message | GroupMessage>(`${base}/messages`, {
				method: 'POST',
				body: {
					content: draft.text,
					uploads,
					gif: draft.gif?.gif ?? null,
					reply_to: draft.replyTo?.id ?? null
				}
			});
		};
		try {
			let res: Message | GroupMessage;
			try {
				res = await sendOnce();
			} catch (e) {
				// the server let the images expire (kept for a day, or lost on a restart): upload again
				if (!(e instanceof ApiError && e.status === 410 && draft.images.length)) throw e;
				res = await sendOnce();
			}
			settle();
			draft.gif?.sent();
			add(normalize(res));
			emit('chats_changed');
			return;
		} catch (e) {
			setError(e instanceof ApiError && e.status === 413 ? 'Images are too big.' : errorMessage(e));
		}
		settle();
		// give back what didn't go out, without overwriting what was typed since
		setText((now) => (now.trim() ? now : draft.content));
		if (draft.images.length && !gifRef.current)
			setImages((now) => [...draft.images, ...now].slice(0, maxImages));
		if (draft.gif && !imagesRef.current.length) setGif((now) => now ?? draft.gif);
		if (draft.replyTo) setReplyTo((now) => now ?? draft.replyTo);
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

	/** shows who reacted to the message with what, next to its reactions */
	function openReactors(message: Msg) {
		const mine = message.sender.username === myName;
		const row = pills.current.get(message.id);
		if (!row) return;
		row.measureInWindow((x, y, width, height) =>
			setReactors({ id: message.id, anchor: { x, y, width, height, mine } })
		);
	}

	/** opens the message's menu next to its bubble */
	function messageMenu(message: Msg) {
		const bubble = bubbles.current.get(message.id);
		if (!bubble) return openMessageMenu(message);
		bubble.measureInWindow((x, y, width, height) =>
			openMessageMenu(message, {
				x,
				y,
				width,
				height,
				mine: message.sender.username === myName
			})
		);
	}

	function openMessageMenu(message: Msg, anchor?: MenuAnchor) {
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
						input.current?.focus();
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
			},
			anchor
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
	const canWrite = !blocked && !me?.muted;
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
					<MessageGestures
						enabled={canWrite}
						onReply={() => {
							setEditing(null);
							setReplyTo(item);
							input.current?.focus();
						}}
						onDoubleTap={() => {
							// like the web (and Instagram), a double tap only ever adds the heart
							if (item.reactions.find((r) => r.username === myName)?.emoji !== '❤️')
								react(item, '❤️');
						}}
					>
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
									ref={(node) => {
										if (node) bubbles.current.set(item.id, node);
										else bubbles.current.delete(item.id);
									}}
									onLongPress={() => messageMenu(item)}
									delayLongPress={450}
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
										<ImageGrid
											images={item.images}
											sizes={item.image_sizes}
											width={230}
											height={300}
										/>
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
									<View
										ref={(node) => {
											if (node) pills.current.set(item.id, node);
											else pills.current.delete(item.id);
										}}
										style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 }}
									>
										{grouped.map((reaction) => (
											<Pressable
												key={reaction.emoji}
												accessibilityLabel={`${reaction.emoji} ${reaction.by.length}`}
												accessibilityHint="Shows who reacted"
												onPress={() => openReactors(item)}
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
					</MessageGestures>
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
					// inverted: the header is at the bottom, under the newest message
					ListHeaderComponent={
						pending.length ? (
							<View style={{ gap: 3, marginTop: 3 }}>
								{pending.map((p) => (
									<PendingBubble key={p.key} pending={p} />
								))}
							</View>
						) : undefined
					}
					// the list flips the empty component back itself (scaleY on iOS, scale on Android):
					// a transform of our own would replace that one, and mirror the text on Android
					ListEmptyComponent={
						pending.length ? undefined : (
							<View>
								<Txt muted style={{ textAlign: 'center', padding: 40 }}>
									No messages yet. Say hi!
								</Txt>
							</View>
						)
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
							onReplaceImage={(old, edited) =>
								setImages((now) => now.map((image) => (image === old ? edited : image)))
							}
						/>
						<MentionSuggestions
							users={mention.users}
							max={4}
							onPick={(user) => {
								const next = mention.apply(user);
								onChangeText(next.text);
								setCursor(next.cursor);
								input.current?.setSelection(next.cursor, next.cursor);
							}}
						/>
						{clipboard.available && !editing ? (
							<PasteImageButton
								onPress={async () => {
									if (gif) return toast('A message can have a GIF or images, not both');
									if (images.length >= maxImages)
										return toast(`You can attach at most ${maxImages} images`);
									const pasted = await clipboard.paste();
									if (pasted) setImages((now) => [...now, pasted].slice(0, maxImages));
								}}
							/>
						) : null}
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
								ref={input}
								multiline
								value={text}
								onChangeText={onChangeText}
								onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
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
								style={{ paddingBottom: 8, opacity: saving ? 0.5 : 1 }}
								onPress={send}
							>
								<SendHorizontal size={24} color={colors.accent} />
							</IconButton>
						</View>
					</>
				)}
			</View>
			<ReactorsPopover
				anchor={reactors?.anchor ?? null}
				// follows the live reactions, so the list updates while it's open
				message={reactors ? messages.find((m) => m.id === reactors.id) ?? null : null}
				myName={myName}
				canRemove={canWrite}
				onRemove={(message, emoji) => {
					setReactors(null);
					react(message, emoji);
				}}
				onClose={() => setReactors(null)}
			/>
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

/** A message on its way: dimmed, with each image's upload, until the real one replaces it. */
function PendingBubble({ pending: p }: { pending: Pending }) {
	return (
		<View
			accessibilityLabel="Sending"
			style={{ alignSelf: 'flex-end', maxWidth: '80%', alignItems: 'flex-end', opacity: 0.6 }}
		>
			<View
				style={{
					borderRadius: 10,
					borderWidth: 1,
					borderColor: colors.accent,
					backgroundColor: 'rgba(121,154,116,0.15)',
					paddingVertical: 7,
					paddingHorizontal: 10,
					gap: 6
				}}
			>
				{p.replyTo ? (
					<View style={{ borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 8 }}>
						<Txt size={13} bold accent>
							{p.replyTo.sender.name}
						</Txt>
						<Txt size={13} muted numberOfLines={2}>
							{p.replyTo.content || (p.replyTo.gif ? 'GIF' : 'Image')}
						</Txt>
					</View>
				) : null}
				{p.images.length ? (
					<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, maxWidth: 230 }}>
						{p.images.map((image, i) => (
							<View key={image.uri} style={{ width: 70, height: 70 }}>
								<Image
									source={{ uri: image.uri }}
									style={{ width: 70, height: 70, borderRadius: 5, backgroundColor: '#111' }}
								/>
								{(p.progress[i] ?? 0) < 2 ? (
									<View
										style={{
											position: 'absolute',
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											borderRadius: 5,
											backgroundColor: 'rgba(0,0,0,0.5)',
											alignItems: 'center',
											justifyContent: 'center'
										}}
									>
										<UploadProgress progress={p.progress[i] ?? 0} size={24} />
									</View>
								) : null}
							</View>
						))}
					</View>
				) : null}
				{p.gif ? (
					<Image
						source={{ uri: p.gif.gif.poster }}
						style={{
							width: 150,
							aspectRatio: p.gif.gif.width / p.gif.gif.height || 1,
							borderRadius: 5,
							backgroundColor: '#111'
						}}
					/>
				) : null}
				{p.text ? <Txt>{p.text}</Txt> : null}
				<Txt size={11} muted style={{ alignSelf: 'flex-end' }}>
					Sending…
				</Txt>
			</View>
		</View>
	);
}

/**
 * Who reacted to a message with which emoji, like the web chat's reactions list: a small box next
 * to the reactions, above them when there is room. Your own row removes your reaction; the others
 * open the profile.
 */
function ReactorsPopover({
	anchor,
	message,
	myName,
	canRemove,
	onRemove,
	onClose
}: {
	anchor: MenuAnchor | null;
	message: Msg | null;
	myName: string;
	canRemove: boolean;
	onRemove: (message: Msg, emoji: string) => void;
	onClose: () => void;
}) {
	const reactions = message?.reactions ?? [];
	const open = !!anchor && !!message && reactions.length > 0;
	// every reaction removed meanwhile: nothing left to show
	useEffect(() => {
		if (anchor && message && reactions.length === 0) onClose();
	}, [anchor, message, reactions.length, onClose]);
	const { width, height } = Dimensions.get('window');
	const above = (anchor?.y ?? 0) > 260;
	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			statusBarTranslucent
			navigationBarTranslucent
			onRequestClose={onClose}
		>
			<Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close">
				{anchor && message ? (
					<Pressable
						accessibilityViewIsModal
						accessibilityLabel="Reactions"
						style={{
							position: 'absolute',
							top: above ? undefined : anchor.y + anchor.height + 5,
							bottom: above ? height - anchor.y + 5 : undefined,
							left: anchor.mine ? undefined : Math.max(10, anchor.x),
							right: anchor.mine ? Math.max(10, width - anchor.x - anchor.width) : undefined,
							width: 256,
							maxWidth: width - 20,
							maxHeight: 240,
							padding: 5,
							borderRadius: 5,
							borderWidth: 1,
							borderColor: colors.accent,
							backgroundColor: colors.background
						}}
					>
						<ScrollView>
							{reactions.map((reaction) => {
								const yours = reaction.username === myName;
								return (
									<Pressable
										key={reaction.username}
										accessibilityRole="button"
										accessibilityLabel={
											yours
												? `Remove your ${reaction.emoji}`
												: `${reaction.name} reacted ${reaction.emoji}`
										}
										disabled={yours && !canRemove}
										onPress={() => {
											if (yours) onRemove(message, reaction.emoji);
											else {
												onClose();
												router.push(`/user/${reaction.username}`);
											}
										}}
										style={({ pressed }) => ({
											flexDirection: 'row',
											alignItems: 'center',
											gap: 10,
											padding: 5,
											borderRadius: 5,
											backgroundColor: pressed ? colors.hover : 'transparent'
										})}
									>
										<Avatar user={reaction} size={32} />
										<View style={{ flex: 1 }}>
											<Txt bold numberOfLines={1}>
												{yours ? 'You' : reaction.name}
											</Txt>
											<Txt size={13} muted numberOfLines={1}>
												{yours
													? canRemove
														? 'Tap to remove'
														: `@${reaction.username}`
													: `@${reaction.username}`}
											</Txt>
										</View>
										<Txt size={21}>{reaction.emoji}</Txt>
									</Pressable>
								);
							})}
						</ScrollView>
					</Pressable>
				) : null}
			</Pressable>
		</Modal>
	);
}
