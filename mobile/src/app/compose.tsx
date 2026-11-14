import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { ChartNoAxesColumn, ImagePlus, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState, KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
	AttachmentStrip,
	PasteImageButton,
	pickImages,
	useClipboardImage,
	type Picked
} from '@/components/attachments';
import { GifPicker } from '@/components/GifPicker';
import { MentionSuggestions, useMentionSuggestions } from '@/components/mentions';
import { QuoteCard } from '@/components/media';
import { Avatar, Button, ErrorBanner, IconButton, Input, Loading, Txt } from '@/components/ui';
import { api, auth, errorMessage } from '@/lib/api';
import { emit, useBus } from '@/lib/bus';
import {
	isEmptyDraft,
	loadDraft,
	saveDraft,
	type ComposerDraft,
	type DraftOwner
} from '@/lib/drafts';
import { isSending, startPost } from '@/lib/posting';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import type { Gif, Post } from '@/lib/types';

const DURATIONS = [
	{ label: '1 hour', minutes: 60 },
	{ label: '1 day', minutes: 1440 },
	{ label: '3 days', minutes: 4320 },
	{ label: '7 days', minutes: 10080 }
];

/** how long typing pauses before the draft is saved */
const SAVE_DELAY_MS = 800;

/** Writing a post, a reply (?reply=id), a quote (?quote=id) or editing one (?edit=id). */
export default function Compose() {
	const params = useLocalSearchParams<{ reply?: string; quote?: string; edit?: string }>();
	const { me, instance, server } = useSession();
	const insets = useSafeAreaInsets();
	const limits = instance?.limits ?? {};
	const maxLength = limits.postContent ?? 2000;
	const maxImages = limits.postImages ?? 5;

	// the post replied to, quoted or edited
	const targetId = params.reply ?? params.quote ?? params.edit;
	const [target, setTarget] = useState<Post | null>(null);
	const [text, setText] = useState('');
	const [cursor, setCursor] = useState(0);
	const [images, setImages] = useState<Picked[]>([]);
	const [gif, setGif] = useState<{ gif: Gif; sent: () => void } | null>(null);
	const [picking, setPicking] = useState(false);
	const [poll, setPoll] = useState<{ options: string[]; minutes: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const mention = useMentionSuggestions(text, cursor);
	const clipboard = useClipboardImage();
	const input = useRef<ComponentRef<typeof TextInput>>(null);

	useEffect(() => {
		if (!targetId) return;
		api<Post>(`posts/${targetId}`)
			.then((post) => {
				setTarget(post);
				if (params.edit) {
					setText(post.content);
					setCursor(post.content.length);
				}
			})
			.catch((e) => setError(errorMessage(e)));
	}, [targetId, params.edit]);

	const editing = !!params.edit;

	// drafts: kept per profile and composer, never for edits
	const composer = editing
		? null
		: params.reply
		? `reply:${params.reply}`
		: params.quote
		? `quote:${params.quote}`
		: 'post';
	const userId = me?.user.id;
	const owner = useRef<DraftOwner | null>(null);
	owner.current = userId === undefined ? null : { server, id: userId };
	const current: ComposerDraft = { content: text, images, gif: gif?.gif ?? null, poll };
	const latest = useRef(current);
	latest.current = current;
	/** false until the saved draft was looked at: saving before would overwrite it */
	const loaded = useRef(false);
	/** the profile whose draft the form holds */
	const loadedFor = useRef<number | null>(null);
	/** sent: the saved draft is exactly what went out, and must stay so */
	const submitted = useRef(false);

	const persist = useCallback(() => {
		if (!composer || !owner.current || !loaded.current || submitted.current) return;
		// another profile meanwhile: what's written isn't its draft
		if (owner.current.id !== loadedFor.current) return;
		const draft = latest.current;
		// a post from this composer on its way keeps its saved draft until it lands
		if (isEmptyDraft(draft) && isSending(owner.current, composer)) return;
		saveDraft(owner.current, composer, draft);
	}, [composer]);

	const restore = useCallback(async () => {
		if (!composer || !owner.current) return;
		const who = owner.current;
		// the saved draft is the post on its way: it would be sent twice
		const draft = isSending(who, composer) ? null : await loadDraft(who, composer);
		if (owner.current?.id !== who.id) return;
		loaded.current = true;
		loadedFor.current = who.id;
		if (!draft || !isEmptyDraft(latest.current)) return;
		setText(draft.content);
		setCursor(draft.content.length);
		setImages(draft.images);
		setGif(draft.gif ? { gif: draft.gif, sent: () => {} } : null);
		setPoll(draft.poll);
		setError(draft.error ?? null);
	}, [composer]);

	useEffect(() => {
		restore();
		// the app may be killed in the background without unmounting anything
		const sub = AppState.addEventListener('change', (state) => state !== 'active' && persist());
		return () => {
			sub.remove();
			persist();
		};
	}, [restore, persist, userId]);

	// saved as it's typed
	useEffect(() => {
		if (!loaded.current) return;
		const timer = setTimeout(persist, SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [text, images, gif, poll, persist]);

	// a post from this composer failed while it's open: it comes back here if nothing new is written
	useBus('draft_returned', (e: { owner: DraftOwner; composer: string }) => {
		const who = owner.current;
		if (e.composer === composer && who && e.owner.id === who.id && e.owner.server === who.server)
			restore();
	});

	const title = editing
		? 'Edit post'
		: params.reply
		? 'Reply'
		: params.quote
		? 'Quote'
		: 'New post';
	const hasMedia = images.length > 0 || !!gif;
	const canSend =
		!busy &&
		text.length <= maxLength &&
		(text.trim().length > 0 || (hasMedia && !poll) || (editing && !!target)) &&
		(!poll || poll.options.filter((o) => o.trim()).length >= (limits.pollOptionsMin ?? 2));

	async function submit() {
		setError(null);
		if (editing) {
			setBusy(true);
			try {
				const post = await api<Post>(`posts/${params.edit}`, {
					method: 'PATCH',
					body: { content: text }
				});
				emit('post_patch', post);
				router.back();
			} catch (e) {
				setError(errorMessage(e));
			} finally {
				setBusy(false);
			}
			return;
		}
		if (!composer || !owner.current) return;
		// the saved draft is exactly what's sent, and stays until the post lands
		const draft: ComposerDraft = { ...current, error: null };
		submitted.current = true;
		const savedAt = await saveDraft(owner.current, composer, draft);
		// sent in the background (src/lib/posting.ts): the composer closes at once
		startPost({
			composer,
			owner: owner.current,
			draft,
			savedAt,
			token: auth.token,
			onSent: gif?.sent
		});
		router.back();
	}

	if (!me) return null;
	const iconColor = colors.accent;
	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<Stack.Screen
				options={{
					title,
					headerRight: () => (
						<Button
							size="sm"
							variant="primary"
							label={editing ? 'Save' : params.reply ? 'Reply' : 'Post'}
							onPress={submit}
							disabled={!canSend}
							loading={busy}
						/>
					)
				}}
			/>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ padding: 20, gap: 12 }}
			>
				<ErrorBanner message={error} />
				{targetId && !target && !error ? <Loading /> : null}
				{params.reply && target ? (
					<Txt size={14} muted>
						Replying to{' '}
						<Txt size={14} accent>
							@{target.user.username}
						</Txt>
						{target.content ? `: ${target.content.slice(0, 140)}` : ''}
					</Txt>
				) : null}
				<View style={{ flexDirection: 'row', gap: 10 }}>
					<Avatar user={me.user} size={45} />
					<TextInput
						ref={input}
						autoFocus
						multiline
						value={text}
						onChangeText={setText}
						onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
						placeholder={
							poll ? 'Ask a question' : params.reply ? 'Giorgia un commento' : instance?.motd ?? ''
						}
						placeholderTextColor={colors.muted}
						selectionColor={colors.accent}
						style={{
							flex: 1,
							minHeight: 100,
							fontFamily: fonts.medium,
							fontSize: 18,
							color: colors.foreground,
							textAlignVertical: 'top',
							padding: 0
						}}
					/>
				</View>
				<MentionSuggestions
					users={mention.users}
					onPick={(user) => {
						const next = mention.apply(user);
						setText(next.text);
						setCursor(next.cursor);
						input.current?.setSelection(next.cursor, next.cursor);
					}}
				/>
				<AttachmentStrip
					images={images}
					gif={gif?.gif ?? null}
					onRemoveImage={(index) => setImages((now) => now.filter((_, i) => i !== index))}
					onRemoveGif={() => setGif(null)}
					onReplaceImage={(old, edited) =>
						setImages((now) => now.map((image) => (image === old ? edited : image)))
					}
				/>
				{poll ? (
					<View
						style={{
							borderWidth: 1,
							borderColor: colors.line,
							borderRadius: 5,
							padding: 10,
							gap: 10
						}}
					>
						<View style={{ flexDirection: 'row', alignItems: 'center' }}>
							<Txt bold style={{ flex: 1 }}>
								Poll
							</Txt>
							<IconButton label="Remove poll" onPress={() => setPoll(null)}>
								<X size={18} color={colors.muted} />
							</IconButton>
						</View>
						{poll.options.map((option, index) => (
							<Input
								key={index}
								value={option}
								maxLength={limits.pollOption ?? 80}
								autoCapitalize="sentences"
								placeholder={`Option ${index + 1}`}
								onChangeText={(value) =>
									setPoll({
										...poll,
										options: poll.options.map((o, i) => (i === index ? value : o))
									})
								}
							/>
						))}
						{poll.options.length < (limits.pollOptionsMax ?? 4) ? (
							<Button
								size="sm"
								label="Add option"
								style={{ alignSelf: 'flex-start' }}
								onPress={() => setPoll({ ...poll, options: [...poll.options, ''] })}
							/>
						) : null}
						<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
							{DURATIONS.map((duration) => (
								<Button
									key={duration.minutes}
									size="sm"
									variant={poll.minutes === duration.minutes ? 'primary' : 'default'}
									label={duration.label}
									onPress={() => setPoll({ ...poll, minutes: duration.minutes })}
								/>
							))}
						</View>
					</View>
				) : null}
				{params.quote && target ? (
					<QuoteCard quote={{ ...target, is_quote: !!target.quote }} />
				) : null}
			</ScrollView>
			{editing ? null : (
				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						gap: 20,
						paddingHorizontal: 20,
						paddingTop: 10,
						paddingBottom: insets.bottom + 10,
						borderTopWidth: 1,
						borderTopColor: colors.line
					}}
				>
					<IconButton
						label="Attach images"
						onPress={async () => {
							if (gif) return setError('A post can have a GIF or images, not both.');
							const picked = await pickImages(maxImages - images.length);
							setImages((now) => [...now, ...picked].slice(0, maxImages));
						}}
					>
						<ImagePlus size={22} color={iconColor} />
					</IconButton>
					{instance?.gifs ? (
						<IconButton
							label="Add a GIF"
							onPress={() => {
								if (images.length) return setError('A post can have a GIF or images, not both.');
								setPicking(true);
							}}
						>
							<Txt bold accent size={15}>
								GIF
							</Txt>
						</IconButton>
					) : null}
					<IconButton
						label="Add a poll"
						onPress={() => setPoll(poll ?? { options: ['', ''], minutes: 1440 })}
					>
						<ChartNoAxesColumn size={22} color={iconColor} />
					</IconButton>
					{clipboard.available ? (
						<PasteImageButton
							onPress={async () => {
								if (gif) return setError('A post can have a GIF or images, not both.');
								if (images.length >= maxImages)
									return setError(`You can attach at most ${maxImages} images.`);
								const pasted = await clipboard.paste();
								if (pasted) setImages((now) => [...now, pasted].slice(0, maxImages));
							}}
						/>
					) : null}
					<View style={{ flex: 1 }} />
					<Txt
						size={13}
						muted
						style={text.length > maxLength ? { color: colors.danger } : undefined}
					>
						{text.length}/{maxLength}
					</Txt>
				</View>
			)}
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
