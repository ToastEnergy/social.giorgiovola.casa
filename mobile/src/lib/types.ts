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

/** an uploaded image's size in pixels, as stored, so it can be laid out before it loads */
export type ImageSize = { width: number; height: number };

export type QuotedPost = {
	id: number;
	user: User;
	content: string;
	images: string[];
	/** the size of each image, in the order of `images`; null or missing for older uploads */
	image_sizes?: ImageSize[] | null;
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
	/** the size of each image, in the order of `images`; null or missing for older uploads */
	image_sizes?: ImageSize[] | null;
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
	/** null when for good (or not banned) */
	banned_until?: string | null;
	muted_until?: string | null;
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
	| 'quote'
	| 'invites';

export type NotificationGroup = {
	key: string;
	type: NotificationType;
	senders: (User & { id: number })[];
	count: number;
	unread: number;
	post: { id: number; content: string } | null;
	/** invites: how many the sender (an admin) gave, null for the other types */
	invites?: number | null;
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
	/** staff only: reports waiting for them (null for everyone else, missing on older servers) */
	open_reports?: number | null;
	/** the account's invites (null for bots, missing on servers from before invites) */
	invites?: InviteBalance | null;
};

export type LoginResult = { token: string; expires_at: string; me: Me };

export type GifConfig = { provider: 'klipy'; app_key: string; content_filter: string };

export type Instance = {
	api_version: number;
	version: string;
	motd: string;
	registration_open: boolean;
	/** everything but signing in needs the token (images too) */
	members_only?: boolean;
	/** false only before the instance's first account; missing on servers from before invites */
	invite_required?: boolean;
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
	/** the size of each image, in the order of `images`; null or missing for older uploads */
	image_sizes?: ImageSize[] | null;
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

export type Role = 'user' | 'mod' | 'admin';

/** The state every account row and case page shows (GET /admin/users). */
export type AccountState = User & {
	role: Role;
	banned_at: string | null;
	ban_reason: string | null;
	banned_until?: string | null;
	muted_at: string | null;
	mute_reason: string | null;
	muted_until?: string | null;
	created_at: string;
	identities: (User & { bot: boolean; members: string[] })[];
	shared_with: (User & { owner_username: string })[];
	self: boolean;
	can_moderate: boolean;
	can_manage: boolean;
};

/** GET /admin/users */
export type AdminUser = AccountState & { open_reports?: number };

/** GET /admin/users/:username: a case page */
export type AdminAccount = AccountState & {
	email: string | null;
	/** the identity that was asked for, when it isn't the account itself */
	via: string | null;
	stats: {
		posts: number;
		followers: number;
		open_reports: number;
		reports: number;
		reports_made: number;
		log_entries: number;
	};
	/** missing on servers from before invites */
	invites?: InviteBalance & { used: number; invited_by: User | null };
};

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

/** An invite code as GET /me/invites and GET /admin/invites list it. */
export type Invite = {
	id: number;
	code: string;
	/** the link to share; absolute, but resolved against the server in case it isn't */
	url: string;
	note: string;
	status: InviteStatus;
	by_staff: boolean;
	created_at: string;
	expires_at: string | null;
	used_at: string | null;
	used_by: User | null;
	/** only in the admin list */
	inviter?: User | null;
};

/** How many invites an account holds (codes out included), has out as codes, and can still give. */
export type InviteBalance = { invites: number; pending: number; available: number };

/** GET /admin/invites/summary */
export type InviteSummary = {
	held: number;
	available: number;
	pending: number;
	pending_staff: number;
	used: number;
	accounts: (User & InviteBalance)[];
};

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/** GET /admin/reports */
export type Report = {
	id: number;
	kind: 'post' | 'profile';
	category: string;
	details: string;
	status: ReportStatus;
	created_at: string;
	resolved_at: string | null;
	resolution_note: string | null;
	resolved_by: string | null;
	reporter: User;
	target: User;
	post: {
		id: number | null;
		content: string;
		images: string[];
		deleted: boolean;
		edited: boolean;
	} | null;
	account: { username: string; role: Role; banned: boolean; muted: boolean };
	related_open: number;
	can_moderate: boolean;
};

/** GET /admin/log */
export type LogEntry = {
	id: number;
	action: string;
	actor: string | null;
	target: string | null;
	target_profile: User | null;
	reason: string | null;
	expires_at: string | null;
	details: Record<string, unknown> | null;
	created_at: string;
	system: boolean;
};

/** GET /admin/overview */
export type Overview = {
	open_reports: number;
	accounts: number;
	new_accounts: number;
	banned: number;
	muted: number;
	staff: number;
	posts_today: number;
	actions_week: number;
};

/** GET /admin/groups/:id */
export type AdminGroup = {
	id: number;
	name: string;
	owner: string | null;
	members: User[];
	messages: number;
	created_at: string;
};
