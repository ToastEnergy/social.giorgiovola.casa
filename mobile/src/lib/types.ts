// the objects of /api/v1 (see "Objects" in /api.txt). dates are ISO strings

export type User = { username: string; name: string; avatar: string | null };

export type Gif = {
	provider?: 'klipy';
	slug: string;
	title: string;
	video: string;
	poster: string;
	width: number;
	height: number;
};

export type QuotedPost = {
	id: number;
	user: User;
	content: string;
	images: string[];
	gif?: Gif | null;
	created_at: string;
	is_quote: boolean;
};

export type LinkPreview = {
	url: string;
	title: string;
	description: string | null;
	image: string | null;
	site_name: string;
};

export type Poll = {
	options: string[];
	votes: number[];
	ends_at: string;
	closed: boolean;
	voted: number | null;
};

export type Post = {
	id: number;
	user: User & { id: number; bot?: boolean; created_at: string };
	content: string;
	images: string[];
	gif: Gif | null;
	created_at: string;
	edited_at: string | null;
	likes: number;
	liked?: boolean;
	regiorgs: number;
	regiorged?: boolean;
	quotes: number;
	quote: QuotedPost | { deleted: true } | null;
	linked_post?: QuotedPost | null;
	link_preview?: LinkPreview | null;
	poll: Poll | null;
	replies_count: number;
	reply_to: { id: number; username: string; likes: number } | null;
	pinned?: boolean;
	timeline_pinned?: boolean;
	regiorged_by?: { username: string; name: string; others?: number } | null;
};

export type FollowedBy = { users: User[]; total: number };

export type Moderation = {
	banned: boolean;
	muted: boolean;
	ban_reason: string | null;
	mute_reason: string | null;
	identity: boolean;
};

export type Profile = User & {
	bot?: boolean;
	bio: string;
	website: string;
	created_at: string;
	followers: number;
	following: number;
	followed: boolean;
	followsYou: boolean;
	self: boolean;
	followedBy: FollowedBy;
	pinned_post_id: number | null;
	blocked: boolean;
	blocks_you: boolean;
	moderation: Moderation | null;
};

export type FollowEntry = User & {
	bio: string;
	followed: boolean;
	followsYou: boolean;
	self: boolean;
};

export type NotificationType =
	| 'like'
	| 'reply'
	| 'mention'
	| 'ratio'
	| 'ratioed_by_you'
	| 'follow'
	| 'regiorg'
	| 'quote';

export type NotificationGroup = {
	key: string;
	type: NotificationType;
	senders: (User & { id: number })[];
	count: number;
	unread: number;
	post: { id: number; content: string } | null;
	created_at: string;
	read_at: string | null;
};

export type Me = {
	user: User & {
		id: number;
		bio: string;
		website: string;
		email: string | null;
		bot: boolean;
		identity: boolean;
		created_at: string;
	};
	account: { id: number; username: string } | null;
	role: 'user' | 'mod' | 'admin';
	muted: boolean;
	mute_reason: string | null;
	unread: { notifications: number; messages: number; reactions: number };
	auth: 'token' | 'bot' | 'cookie';
};

export type LoginResult = { token: string; expires_at: string; me: Me };

export type GifConfig = { provider: 'klipy'; app_key: string; content_filter: string };

export type Instance = {
	api_version: number;
	version: string;
	motd: string;
	registration_open: boolean;
	limits: Record<string, number>;
	gifs: GifConfig | null;
};

export type MessageReplyTo = {
	id: number;
	sender: { username: string; name: string };
	content: string;
	images: number;
	gif: boolean;
};

export type Reaction = { emoji: string; username: string; name: string; avatar: string | null };

/** A direct message. */
export type Message = {
	id: number;
	sender: string;
	recipient: string;
	content: string;
	images: string[];
	gif: Gif | null;
	created_at: string;
	edited_at: string | null;
	reply_to: MessageReplyTo | null;
	reactions: Reaction[];
	linked_post: QuotedPost | null;
};

export type GroupMessageKind =
	| 'message'
	| 'created'
	| 'added'
	| 'removed'
	| 'left'
	| 'renamed'
	| 'owner';

export type GroupMessage = Omit<Message, 'sender' | 'recipient'> & {
	group_id: number;
	kind: GroupMessageKind;
	sender: User;
	target: User | null;
};

export type Group = {
	id: number;
	name: string;
	owner: string | null;
	members: User[];
	muted: boolean;
	first_unread_id: number | null;
};

type ConversationBase = {
	preview: string;
	mine: boolean;
	created_at: string;
	unread: number;
	unread_reactions?: number;
	reaction?: string | null;
	muted?: boolean;
};

export type DirectConversation = ConversationBase & { peer: User };

export type GroupSummary = { id: number; name: string; members: User[]; size: number };

export type GroupConversation = ConversationBase & {
	group: GroupSummary;
	event: boolean;
	sender: string | null;
};

export type ShareTarget = { kind: 'user'; peer: User } | { kind: 'group'; group: GroupSummary };

export type Page<T> = { items: T[]; next_cursor: string | null };

export type SwitcherProfile = User & {
	id: number;
	unread: number;
	unreadMessages: number;
	unreadReactions: number;
	active: boolean;
	sharedBy: string | null;
};

export type SwitcherAccount = SwitcherProfile & { identities: SwitcherProfile[] };

export type Session = {
	id: number;
	kind: 'cookie' | 'token' | 'personal';
	name: string | null;
	user_agent: string | null;
	created_at: string;
	expires_at: string | null;
	last_used_at: string | null;
	current: boolean;
};

export type Passkey = {
	id: string;
	name: string;
	backed_up: boolean;
	created_at: string;
	last_used_at: string | null;
};

export type Bot = User & {
	id: number;
	bio: string;
	website: string;
	created_at: string;
	last_used_at: string | null;
};

export type Identities = {
	max_identities: number;
	max_members: number;
	owned: (User & { created_at: string; members: User[] })[];
	shared_with_me: (User & { created_at: string; owner: string })[];
};

export type AdminUser = User & {
	role: 'user' | 'mod' | 'admin';
	banned_at: string | null;
	ban_reason: string | null;
	muted_at: string | null;
	mute_reason: string | null;
	created_at: string;
	identities: (User & { bot: boolean; members: string[] })[];
	shared_with: (User & { owner_username: string })[];
	self: boolean;
	can_moderate: boolean;
	can_manage: boolean;
};
