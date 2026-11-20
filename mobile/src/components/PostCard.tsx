import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import {
	Bot,
	Ellipsis,
	Flag,
	Heart,
	Link as LinkIcon,
	MessageCircle,
	Pencil,
	Pin,
	Quote,
	Repeat2,
	Send,
	Share2,
	Trash2,
	Users
} from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useActingAs, withAs } from '@/lib/actAs';
import { count, fullDate, isRatio, ratioPercent, timeAgo } from '@/lib/format';
import { deletePost, postUrl, reactAs, setPin, toggleLike, toggleRegiorg, vote } from '@/lib/posts';
import { useKnownProfiles } from '@/lib/profilesStore';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Poll, Post } from '@/lib/types';
import { useDoubleTapLike } from './DoubleTapLike';
import { GifMedia, ImageGrid, LinkPreviewCard, QuoteCard } from './media';
import { confirm, showMenu, toast } from './overlays';
import { RichText } from './RichText';
import { Avatar, IconButton, Txt } from './ui';
import { VoiceNotePlayer } from './voice';

function PollCard({ poll, onVote }: { poll: Poll; onVote: (option: number) => void }) {
	const total = poll.votes.reduce((a, b) => a + b, 0);
	const showResults = poll.closed || poll.voted !== null;
	return (
		<View style={{ gap: 5 }}>
			{poll.options.map((option, index) => {
				const share = total ? Math.round((poll.votes[index] / total) * 100) : 0;
				const mine = poll.voted === index;
				return (
					<Pressable
						key={index}
						disabled={poll.closed}
						onPress={() => onVote(index)}
						accessibilityLabel={`Vote for ${option}`}
						style={{
							borderWidth: 1,
							borderColor: mine ? colors.accent : colors.line,
							borderRadius: 5,
							overflow: 'hidden'
						}}
					>
						{showResults ? (
							<View
								style={{
									position: 'absolute',
									top: 0,
									bottom: 0,
									left: 0,
									width: `${share}%`,
									backgroundColor: mine ? 'rgba(121,154,116,0.35)' : 'rgba(255,255,255,0.08)'
								}}
							/>
						) : null}
						<View style={{ flexDirection: 'row', padding: 8, gap: 10 }}>
							<Txt size={14} bold={mine} style={{ flex: 1 }}>
								{option}
							</Txt>
							{showResults ? (
								<Txt size={14} muted>
									{share}%
								</Txt>
							) : null}
						</View>
					</Pressable>
				);
			})}
			<Txt size={13} muted>
				{count(total)} {total === 1 ? 'vote' : 'votes'} ·{' '}
				{poll.closed ? 'Final results' : `Ends ${fullDate(poll.ends_at)}`}
			</Txt>
		</View>
	);
}

type Props = {
	post: Post;
	/** the open post of its own screen: larger, with the full date, not tappable */
	detail?: boolean;
	/** don't say who it replies to (the thread above already shows it) */
	hideReplyTo?: boolean;
};

export const PostCard = memo(function PostCard({ post, detail, hideReplyTo }: Props) {
	const { me } = useSession();
	const as = useActingAs();
	const profiles = useKnownProfiles();
	// in the context of another profile the post is that profile's to edit and delete
	const mine = (as ?? me?.user.username) === post.user.username;
	const staff = !!me && me.role !== 'user';
	const ratio = isRatio(post);
	const iconColor = colors.muted;
	const openProfile = () => router.push(withAs(`/user/${post.user.username}`, as));
	// double tap to like, like the web app; a single tap waits out the double tap window
	const doubleTap = useDoubleTapLike(post, !!me, as);

	// long press on like or regiorgio: act as any profile of the account (only with several)
	const pickReactor = (kind: 'like' | 'regiorg') =>
		profiles.length > 1 && me
			? () => reactAs(post, kind, profiles, as ?? me.user.username, me.user.username)
			: undefined;

	const regiorgMenu = () =>
		showMenu([
			{
				label: post.regiorged ? 'Undo regiorgio' : 'Regiorgio',
				icon: <Repeat2 size={18} color={colors.foreground} />,
				onPress: () => toggleRegiorg(post, as)
			},
			{
				label: 'Quote',
				icon: <Quote size={18} color={colors.foreground} />,
				onPress: () => router.push(withAs(`/compose?quote=${post.id}`, as))
			},
			(post.regiorgs > 0 || post.quotes > 0) && {
				label: 'Regiorgios and quotes',
				icon: <Users size={18} color={colors.foreground} />,
				onPress: () => router.push(withAs(`/post/${post.id}/people?tab=regiorgs`, as))
			}
		]);

	const shareMenu = () =>
		showMenu([
			{
				label: 'Send via message',
				icon: <Send size={18} color={colors.foreground} />,
				onPress: () => router.push(`/share?post=${post.id}&username=${post.user.username}`)
			},
			{
				label: 'Copy link',
				icon: <LinkIcon size={18} color={colors.foreground} />,
				onPress: async () => {
					await Clipboard.setStringAsync(postUrl(post));
					toast('Link copied');
				}
			},
			{
				label: 'Share…',
				icon: <Share2 size={18} color={colors.foreground} />,
				onPress: () => Share.share({ message: postUrl(post) }).catch(() => {})
			}
		]);

	const moreMenu = () =>
		showMenu([
			{
				label: 'Users who liked',
				icon: <Heart size={18} color={colors.foreground} />,
				onPress: () => router.push(withAs(`/post/${post.id}/people?tab=likes`, as))
			},
			mine && {
				label: 'Edit',
				icon: <Pencil size={18} color={colors.foreground} />,
				onPress: () => router.push(withAs(`/compose?edit=${post.id}`, as))
			},
			mine &&
				!post.reply_to && {
					label: post.pinned ? 'Unpin from profile' : 'Pin to profile',
					icon: <Pin size={18} color={colors.foreground} />,
					onPress: () => setPin(post, 'pin', !post.pinned, as)
				},
			staff &&
				!post.reply_to && {
					label: post.timeline_pinned ? 'Unpin from timeline' : 'Pin to timeline',
					icon: <Pin size={18} color={colors.foreground} />,
					onPress: () => setPin(post, 'timeline-pin', !post.timeline_pinned, as)
				},
			!mine &&
				!!me &&
				me.auth !== 'bot' && {
					label: 'Report post',
					icon: <Flag size={18} color={colors.foreground} />,
					onPress: () => router.push(`/report?post=${post.id}&username=${post.user.username}`)
				},
			(mine || staff) && {
				label: 'Delete post',
				danger: true,
				icon: <Trash2 size={18} color={colors.danger} />,
				onPress: async () => {
					if (
						await confirm(
							'Delete post?',
							'Its replies are deleted with it. This can’t be undone.',
							'Delete',
							true
						)
					)
						deletePost(post, as);
				}
			}
		]);

	const body = (
		<View style={{ gap: 8 }}>
			{post.content ? (
				<RichText content={post.content} size={detail ? 18 : 16} selectable={detail} />
			) : null}
			{post.audio ? (
				<VoiceNotePlayer
					note={post.audio}
					track={{ title: post.user.name, user: post.user, href: `/post/${post.id}` }}
				/>
			) : null}
			{/* in a list a photo is part of the post and opens it; the viewer is for the open post */}
			<ImageGrid
				images={post.images}
				sizes={post.image_sizes}
				height={detail ? 500 : 400}
				viewable={!!detail}
				// photos are where a double tap is most expected
				onTap={doubleTap.tap}
			/>
			{post.gif ? <GifMedia gif={post.gif} /> : null}
			{post.poll ? <PollCard poll={post.poll} onVote={(option) => vote(post, option, as)} /> : null}
			{post.quote ? <QuoteCard quote={post.quote} viewable={!!detail} /> : null}
			{!post.quote && post.linked_post ? (
				<QuoteCard quote={post.linked_post} viewable={!!detail} />
			) : null}
			{post.link_preview ? <LinkPreviewCard preview={post.link_preview} /> : null}
		</View>
	);

	const actions = (
		<View
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				marginTop: 10,
				paddingRight: 10
			}}
		>
			<IconButton
				label="Reply"
				onPress={() => router.push(withAs(`/compose?reply=${post.id}`, as))}
			>
				<MessageCircle size={18} color={iconColor} />
				<Txt size={14} muted>
					{count(post.replies_count)}
				</Txt>
			</IconButton>
			<IconButton
				label="Regiorgio or quote"
				onPress={regiorgMenu}
				onLongPress={pickReactor('regiorg')}
			>
				<Repeat2 size={20} color={post.regiorged ? colors.accent : iconColor} />
				<Txt size={14} muted accent={post.regiorged}>
					{count(post.regiorgs + post.quotes)}
				</Txt>
			</IconButton>
			<IconButton
				label={post.liked ? 'Unlike' : 'Like'}
				onPress={() => toggleLike(post, as)}
				onLongPress={
					pickReactor('like') ??
					(() => router.push(withAs(`/post/${post.id}/people?tab=likes`, as)))
				}
			>
				<Heart
					size={18}
					color={post.liked ? colors.danger : iconColor}
					fill={post.liked ? colors.danger : 'transparent'}
				/>
				<Txt size={14} muted>
					{count(post.likes)}
				</Txt>
				{ratio ? (
					<Txt size={12} bold style={{ color: colors.danger }}>
						RATIO {ratioPercent(post)}%
					</Txt>
				) : null}
			</IconButton>
			<IconButton label="Share post" onPress={shareMenu}>
				<Share2 size={18} color={iconColor} />
			</IconButton>
			<IconButton label="Post options" onPress={moreMenu}>
				<Ellipsis size={18} color={iconColor} />
			</IconButton>
		</View>
	);

	const badges = (
		<>
			{post.user.bot ? <Bot size={14} color={colors.muted} /> : null}
			{post.pinned || post.timeline_pinned ? <Pin size={13} color={colors.accent} /> : null}
		</>
	);

	const banner = post.regiorged_by ? (
		<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
			<Repeat2 size={14} color={colors.muted} />
			<Txt size={13} muted numberOfLines={1} style={{ flex: 1 }}>
				{post.regiorged_by.name}
				{post.regiorged_by.others
					? ` and ${count(post.regiorged_by.others)} ${
							post.regiorged_by.others === 1 ? 'other' : 'others'
					  }`
					: ''}{' '}
				regiorged
			</Txt>
		</View>
	) : null;

	const replyTo =
		post.reply_to && !hideReplyTo ? (
			<Txt size={13} muted>
				Replying to{' '}
				<Txt
					size={13}
					accent
					onPress={() => router.push(withAs(`/post/${post.reply_to?.id}`, as))}
					suppressHighlighting
				>
					@{post.reply_to.username}
				</Txt>
			</Txt>
		) : null;

	if (detail)
		return (
			// not a button: a single tap on the open post does nothing, a double tap likes it
			<Pressable
				ref={doubleTap.ref}
				accessible={false}
				onPress={(e) => doubleTap.tap(e)}
				style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: colors.line }}
			>
				{doubleTap.hearts}
				{banner}
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
					<Avatar user={post.user} size={50} link />
					<Pressable style={{ flex: 1 }} onPress={openProfile}>
						<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
							<Txt bold numberOfLines={1} style={{ flexShrink: 1 }}>
								{post.user.name}
							</Txt>
							{badges}
						</View>
						<Txt size={14} dim={0.7}>
							@{post.user.username}
						</Txt>
					</Pressable>
				</View>
				{replyTo}
				{body}
				<Txt size={13} muted style={{ marginTop: 10 }}>
					{fullDate(post.created_at)}
					{post.edited_at ? ` · edited ${fullDate(post.edited_at)}` : ''}
				</Txt>
				{actions}
			</Pressable>
		);

	return (
		<Pressable
			ref={doubleTap.ref}
			onPress={(e) => doubleTap.tap(e, () => router.push(withAs(`/post/${post.id}`, as)))}
			style={({ pressed }) => ({
				paddingVertical: 12,
				paddingHorizontal: 20,
				backgroundColor: pressed ? colors.hover : 'transparent'
			})}
		>
			{doubleTap.hearts}
			{banner}
			<View style={{ flexDirection: 'row', gap: 10 }}>
				<Avatar user={post.user} size={45} link />
				<View style={{ flex: 1 }}>
					<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
						{/* the name and @username open the profile, like the avatar; the rest the post */}
						<Txt
							bold
							numberOfLines={1}
							style={{ flexShrink: 1 }}
							onPress={openProfile}
							suppressHighlighting
						>
							{post.user.name}
						</Txt>
						{badges}
						<Txt
							size={14}
							muted
							numberOfLines={1}
							style={{ flexShrink: 2 }}
							onPress={openProfile}
							suppressHighlighting
						>
							@{post.user.username}
						</Txt>
						<Txt size={13} muted>
							· {timeAgo(post.created_at)}
							{post.edited_at ? ' · edited' : ''}
						</Txt>
					</View>
					{replyTo}
					<View style={{ marginTop: 4 }}>{body}</View>
					{actions}
				</View>
			</View>
		</Pressable>
	);
});
