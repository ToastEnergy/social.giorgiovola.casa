import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Camera, ChartNoAxesColumn, ChevronDown, ImagePlus, Mic, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
	AppState,
	KeyboardAvoidingView,
	Pressable,
	ScrollView,
	TextInput,
	View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
	AttachmentStrip,
	PasteImageButton,
	pickImages,
	takePhoto,
	useClipboardImage,
	type Picked
} from '@/components/attachments';
import { GifPicker } from '@/components/GifPicker';
import { MentionSuggestions, useMentionSuggestions } from '@/components/mentions';
import { QuoteCard } from '@/components/media';
import { pickProfile } from '@/components/overlays';
import { Avatar, Button, ErrorBanner, IconButton, Input, Loading, Txt } from '@/components/ui';
import { ComposerRecorder } from '@/components/VoiceRecorder';
import { useAsParam } from '@/lib/actAs';
import { api, auth, errorMessage } from '@/lib/api';
import { emit, useBus } from '@/lib/bus';
import { voicePreview } from '@/lib/format';
import {
	isEmptyDraft,
	loadDraft,
	saveDraft,
	type ComposerDraft,
	type DraftOwner
} from '@/lib/drafts';
import { isSending, startPost } from '@/lib/posting';
import { useKnownProfiles } from '@/lib/profilesStore';
import { useVoiceRecorder } from '@/lib/recorder';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import type { Gif, Post } from '@/lib/types';
import { startVoiceUpload } from '@/lib/voiceUpload';

const DURATIONS = [
	{ label: '1 hour', minutes: 60 },
	{ label: '1 day', minutes: 1440 },
	{ label: '3 days', minutes: 4320 },
	{ label: '7 days', minutes: 10080 }
];

/** how long typing pauses before the draft is saved */
const SAVE_DELAY_MS = 800;
const VOICE_ONLY = 'A voice note can’t have images, a GIF or a poll: only a caption.';

/** Writing a post, a reply (?reply=id), a quote (?quote=id) or editing one (?edit=id). */
export default function Compose() {
	const params = useLocalSearchParams<{ reply?: string; quote?: string; edit?: string }>();
	const { me, instance, server } = useSession();
	const profiles = useKnownProfiles();
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
	// who posts: the screen the composer was opened from (?as=), else the profile in use, or any
	// other profile of the account picked from the avatar. Drafts stay the profile in use's
	const contextAs = useAsParam();
	const [picked, setPicked] = useState<string | null | undefined>(undefined);
	const wanted = picked === undefined ? contextAs : picked;
	const postingAs =
		wanted && wanted !== me?.user.username && profiles.some((p) => p.username === wanted)
			? wanted
			: null;
	const poster = profiles.find((p) => p.username === postingAs) ?? me?.user;
	const mention = useMentionSuggestions(text, cursor);
	const clipboard = useClipboardImage();
	const input = useRef<ComponentRef<typeof TextInput>>(null);

	useEffect(() => {
		if (!targetId) return;
		api<Post>(`posts/${targetId}`, { as: contextAs })
			.then((post) => {
				setTarget(post);
				if (params.edit) {
					setText(post.content);
					setCursor(post.content.length);
				}
			})
			.catch((e) => setError(errorMessage(e)));
	}, [targetId, params.edit, contextAs]);

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

	// a voice note, recorded here hands-free; the text is its caption
	const rec = useVoiceRecorder({
		maxMs: instance?.voice_notes?.max_duration_ms,
		onReview: (voice) => {
			// uploading starts below, once it's in review. also when the screen goes away while recording: kept with the draft
			if (composer && owner.current && loaded.current && !submitted.current)
				saveDraft(owner.current, composer, { ...latest.current, voice });
		}
	});
	const recPhase = rec.state.phase;
	const reviewVoice = recPhase === 'review' ? rec.state.voice : null;
	const recording = recPhase === 'recording' || recPhase === 'paused';
	const { restore: restoreVoice } = rec;

	const current: ComposerDraft = {
		content: text,
		images,
		gif: gif?.gif ?? null,
		poll,
		voice: reviewVoice,
		as: postingAs
	};
	const latest = useRef(current);
	latest.current = current;
	/** the profile a recorded voice note's staged upload belongs to */
	const uploadedAs = useRef<string | null>(null);
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
		if (draft.as) setPicked(draft.as);
		if (draft.voice) {
			// its staged upload is the profile's it was written as
			uploadedAs.current = draft.as ?? null;
			restoreVoice(draft.voice);
		}
	}, [composer, restoreVoice]);

	useEffect(() => {
		restore();
		// the app may be killed in the background without unmounting anything
		const sub = AppState.addEventListener('change', (state) => state !== 'active' && persist());
		return () => {
			sub.remove();
			persist();
		};
	}, [restore, persist, userId]);

	// a voice note is uploaded as the profile that posts it: another one starts over
	const reviewUri = reviewVoice?.uri;
	useEffect(() => {
		if (!reviewVoice) return;
		if (uploadedAs.current !== postingAs) reviewVoice.upload = null;
		uploadedAs.current = postingAs;
		startVoiceUpload(reviewVoice.uri, { ...auth, as: postingAs });
	}, [reviewUri, postingAs]);

	// saved as it's typed
	useEffect(() => {
		if (!loaded.current) return;
		const timer = setTimeout(persist, SAVE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [text, images, gif, poll, reviewVoice, postingAs, persist]);

	// closing while recording: stop into review first, so the recording is whole in the draft
	const allowLeave = usePreventRemove(recording, ({ repeat }) => {
		rec.stop().then(() => {
			allowLeave();
			repeat();
		});
	});

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
	const hasVoice = !!reviewVoice || (recording && rec.state.started);
	const canSend =
		!busy &&
		recPhase !== 'requesting' &&
		text.length <= maxLength &&
		(text.trim().length > 0 ||
			(hasMedia && !poll) ||
			(hasVoice && !hasMedia && !poll) ||
			(editing && !!target)) &&
		(!poll || poll.options.filter((o) => o.trim()).length >= (limits.pollOptionsMin ?? 2));

	async function submit() {
		setError(null);
		if (editing) {
			setBusy(true);
			try {
				const post = await api<Post>(`posts/${params.edit}`, {
					method: 'PATCH',
					as: contextAs,
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
		// still recording: what's recorded so far is the note
		const voice = recording ? await rec.take() : reviewVoice;
		if (voice && (hasMedia || poll)) return setError(VOICE_ONLY);
		// the saved draft is exactly what's sent, and stays until the post lands
		const draft: ComposerDraft = { ...current, voice, error: null };
		submitted.current = true;
		const savedAt = await saveDraft(owner.current, composer, draft);
		// sent in the background (src/lib/posting.ts): the composer closes at once
		// the composer closes: the recording now belongs to the post on its way
		rec.reset();
		startPost({
			composer,
			owner: owner.current,
			draft,
			savedAt,
			token: auth.token,
			as: postingAs,
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
						{target.content
							? `: ${target.content.slice(0, 140)}`
							: target.audio
							? `: ${voicePreview(target.audio.duration_ms)}`
							: ''}
					</Txt>
				) : null}
				{postingAs && !editing ? (
					<Txt size={14} muted>
						Posting as{' '}
						<Txt size={14} bold>
							@{postingAs}
						</Txt>
					</Txt>
				) : null}
				<View style={{ flexDirection: 'row', gap: 10 }}>
					{profiles.length > 1 && !editing ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Choose who posts"
							onPress={async () => {
								const username = await pickProfile({
									title: 'Posting as',
									profiles,
									current: postingAs ?? me.user.username
								});
								if (username) setPicked(username === me.user.username ? null : username);
							}}
							style={{ alignSelf: 'flex-start' }}
						>
							<Avatar user={poster ?? me.user} size={45} />
							<View
								style={{
									position: 'absolute',
									right: -3,
									bottom: -3,
									borderRadius: 9,
									backgroundColor: colors.background,
									borderWidth: 1,
									borderColor: colors.line
								}}
							>
								<ChevronDown size={14} color={colors.accent} />
							</View>
						</Pressable>
					) : (
						<Avatar user={me.user} size={45} />
					)}
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
				<ComposerRecorder rec={rec} />
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
							if (recPhase !== 'idle') return setError(VOICE_ONLY);
							const picked = await pickImages(maxImages - images.length);
							setImages((now) => [...now, ...picked].slice(0, maxImages));
						}}
					>
						<ImagePlus size={22} color={iconColor} />
					</IconButton>
					<IconButton
						label="Take a photo"
						onPress={async () => {
							if (gif) return setError('A post can have a GIF or images, not both.');
							if (recPhase !== 'idle') return setError(VOICE_ONLY);
							if (images.length >= maxImages)
								return setError(`You can attach at most ${maxImages} images.`);
							const photo = await takePhoto();
							if (photo) setImages((now) => [...now, photo].slice(0, maxImages));
						}}
					>
						<Camera size={22} color={iconColor} />
					</IconButton>
					{instance?.gifs ? (
						<IconButton
							label="Add a GIF"
							onPress={() => {
								if (images.length) return setError('A post can have a GIF or images, not both.');
								if (recPhase !== 'idle') return setError(VOICE_ONLY);
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
						onPress={() => {
							if (recPhase !== 'idle') return setError(VOICE_ONLY);
							setPoll(poll ?? { options: ['', ''], minutes: 1440 });
						}}
					>
						<ChartNoAxesColumn size={22} color={iconColor} />
					</IconButton>
					{instance?.voice_notes ? (
						<IconButton
							label="Record a voice note"
							onPress={() => {
								if (recPhase !== 'idle') return;
								if (hasMedia || poll) return setError(VOICE_ONLY);
								setError(null);
								rec.startLocked();
							}}
						>
							<Mic size={22} color={recPhase === 'idle' ? iconColor : colors.muted} />
						</IconButton>
					) : null}
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
