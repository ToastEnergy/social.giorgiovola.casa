import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Switch, View } from 'react-native';
import { Button, ErrorBanner, Field, Notice, Txt } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
	expiresIn,
	isInviteCode,
	normalizeInviteCode,
	serverOfInviteLink,
	usernameOf,
	type InviteCheck
} from '@/lib/invites';
import { DEFAULT_SERVER, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Instance, LoginResult } from '@/lib/types';
import { CLIENT_NAME } from './login';

type Inviter = NonNullable<InviteCheck['inviter']>;

/**
 * The inviter's picture. avatar_url loads without a token, even on a members-only instance; older
 * servers only have the usual avatar paths.
 */
const inviterAvatar = (server: string, inviter: Inviter) =>
	inviter.avatar_url ??
	(inviter.avatar
		? /^https?:\/\//.test(inviter.avatar)
			? inviter.avatar
			: server + inviter.avatar
		: `${server}/avatar/${inviter.username}.png?size=150`);

export default function Register() {
	// invite: opened from a link (social://register?invite=…&server=…)
	const params = useLocalSearchParams<{ server?: string; invite?: string }>();
	const session = useSession();
	const [server, setServer] = useState(params.server || DEFAULT_SERVER);
	const [instance, setInstance] = useState<Instance | null>(null);
	const [code, setCode] = useState(params.invite ?? '');
	// a working code from a link is filled in: the field only shows to change it
	const [editingCode, setEditingCode] = useState(!params.invite);
	const [invite, setInvite] = useState<InviteCheck | null>(null);
	// the link's own code, to say the link (not a typo) is what stopped working
	const linkCode = useRef(params.invite ? normalizeInviteCode(params.invite) : null);
	const [checking, setChecking] = useState(false);
	const [codeError, setCodeError] = useState<string | null>(null);
	const [followInviter, setFollowInviter] = useState(true);
	const [form, setForm] = useState({ email: '', name: '', username: '', password: '' });
	// the username follows the name until it is edited by hand
	const [usernameEdited, setUsernameEdited] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const set = (key: keyof typeof form) => (value: string) =>
		setForm((f) => ({ ...f, [key]: value }));

	useEffect(() => {
		setInstance(null);
		api<Instance>('instance', { server, token: null })
			.then(setInstance)
			.catch((e) => setError(errorMessage(e)));
	}, [server]);

	const inviteRequired = instance?.invite_required !== false;
	const normalized = normalizeInviteCode(code);

	// checks a complete code (wrong ones count against a rate limit, so not every keystroke)
	useEffect(() => {
		setInvite(null);
		setCodeError(null);
		if (!inviteRequired || !isInviteCode(normalized)) {
			setChecking(false);
			return;
		}
		setChecking(true);
		let current = true;
		const timer = setTimeout(() => {
			api<InviteCheck>(`invites/${encodeURIComponent(normalized)}`, { server, token: null })
				.then((found) => current && setInvite(found))
				.catch((e) => {
					if (!current) return;
					setCodeError(
						e instanceof ApiError && e.status === 404
							? normalized === linkCode.current
								? "This invite link doesn't work anymore: it may have been used, revoked or expired. Ask for a new one."
								: "This code doesn't work: it may be mistyped, used, revoked or expired."
							: errorMessage(e)
					);
					// the link's code failed: show it, so another one can be entered
					setEditingCode(true);
				})
				.finally(() => current && setChecking(false));
		}, 300);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [server, normalized, inviteRequired]);

	function codeChanged(value: string) {
		setCode(value);
		// a whole link pasted: sign up on the instance it is from
		const linkServer = serverOfInviteLink(value);
		if (linkServer && linkServer !== server) setServer(linkServer);
	}

	function nameChanged(value: string) {
		set('name')(value);
		if (!usernameEdited) set('username')(usernameOf(value, instance?.limits.username ?? 32));
	}

	function usernameChanged(value: string) {
		setUsernameEdited(value !== '');
		set('username')(value.toLowerCase());
	}

	async function submit() {
		setBusy(true);
		setError(null);
		const inviteCode = inviteRequired ? invite?.code ?? normalized : '';
		const inviter = invite?.inviter;
		try {
			const result = await api<LoginResult>('auth/register', {
				method: 'POST',
				server,
				token: null,
				// servers from before invites read the code as their signup password
				body: {
					...form,
					invite_code: inviteCode,
					signup_password: inviteCode,
					client_name: CLIENT_NAME
				}
			});
			// signed up already: a failed follow shouldn't stop them here
			if (inviter && followInviter)
				await api(`users/${encodeURIComponent(inviter.username)}/follow`, {
					method: 'PUT',
					server,
					token: result.token
				}).catch(() => null);
			await session.signIn(server, result);
			if (router.canDismiss()) router.dismissAll();
			router.replace('/');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	const limits = instance?.limits;
	const host = server.replace(/^https?:\/\//, '');
	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ padding: 20, gap: 20 }}
			>
				{instance && !instance.registration_open ? (
					<Notice>Registration is closed on {host}.</Notice>
				) : null}
				<ErrorBanner message={error} />

				{instance && !inviteRequired ? (
					<Notice>This is the first account on {host}, so no invite is needed.</Notice>
				) : invite?.inviter ? (
					<InviterCard
						inviter={invite.inviter}
						avatar={inviterAvatar(server, invite.inviter)}
						expiresAt={invite.expires_at}
						onChangeCode={
							editingCode
								? undefined
								: () => {
										setEditingCode(true);
										setCode('');
								  }
						}
					/>
				) : invite ? (
					<Notice>
						You&apos;ve been invited to join {host}.
						{invite.expires_at ? ` This invite expires ${expiresIn(invite.expires_at)}.` : ''}
					</Notice>
				) : editingCode && !code ? (
					<Notice>
						Joining {host} is by invitation. Paste the invite link or code someone there sent you,
						or ask a member for one.
					</Notice>
				) : null}

				{inviteRequired && editingCode ? (
					<Field
						label="Invite code or link"
						hint={
							checking
								? 'Checking…'
								: codeError ??
								  (invite ? 'This invite works.' : '12 letters and numbers, from the invite link.')
						}
						value={code}
						onChangeText={codeChanged}
						autoCapitalize="none"
						autoCorrect={false}
					/>
				) : null}
				<Field
					label="Email"
					value={form.email}
					onChangeText={set('email')}
					keyboardType="email-address"
					autoCapitalize="none"
					autoComplete="email"
					textContentType="emailAddress"
				/>
				<Field
					label="Name"
					hint="Shown on your profile and posts. You can change it later."
					value={form.name}
					onChangeText={nameChanged}
					autoCapitalize="words"
					autoComplete="name"
					textContentType="name"
					maxLength={limits?.name}
				/>
				<Field
					label="Username"
					hint={`${
						form.username ? `Your profile will be @${form.username}. ` : ''
					}Lowercase letters, numbers and _.`}
					value={form.username}
					onChangeText={usernameChanged}
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="username-new"
					textContentType="username"
					maxLength={limits?.username}
				/>
				<Field
					label="Password"
					hint={`At least ${
						limits?.passwordMin ?? 8
					} characters. You can add a passkey in settings afterwards.`}
					value={form.password}
					onChangeText={set('password')}
					secureTextEntry
					autoComplete="new-password"
					textContentType="newPassword"
				/>
				{invite?.inviter ? (
					<Pressable
						onPress={() => setFollowInviter((f) => !f)}
						accessibilityRole="switch"
						accessibilityState={{ checked: followInviter }}
						style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
					>
						<Txt size={14} style={{ flex: 1 }}>
							Follow {invite.inviter.name}
						</Txt>
						<Switch
							value={followInviter}
							onValueChange={setFollowInviter}
							trackColor={{ true: colors.accent, false: colors.line }}
						/>
					</Pressable>
				) : null}
				<Button
					variant="primary"
					size="lg"
					label="Create account"
					onPress={submit}
					loading={busy}
					disabled={inviteRequired && checking}
				/>
				<Pressable
					onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
					style={{ alignItems: 'center' }}
				>
					<Txt size={14} muted>
						Already have an account? <Txt accent>Log in</Txt>
					</Txt>
				</Pressable>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}

function InviterCard({
	inviter,
	avatar,
	expiresAt,
	onChangeCode
}: {
	inviter: Inviter;
	avatar: string;
	expiresAt: string | null;
	/** shown when the code came from a link, to type another one */
	onChangeCode?: () => void;
}) {
	return (
		<View
			style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 10, gap: 10 }}
			accessibilityLiveRegion="polite"
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
				<Image
					source={{ uri: avatar }}
					style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#222' }}
					contentFit="cover"
					transition={100}
					accessibilityLabel={`${inviter.name}'s avatar`}
				/>
				<View style={{ flex: 1 }}>
					<Txt size={13} muted>
						You&apos;ve been invited by
					</Txt>
					<Txt numberOfLines={1}>
						<Txt bold>{inviter.name}</Txt> <Txt muted>@{inviter.username}</Txt>
					</Txt>
				</View>
			</View>
			{inviter.bio ? (
				<Txt size={14} numberOfLines={3}>
					{inviter.bio}
				</Txt>
			) : null}
			{expiresAt || onChangeCode ? (
				<Txt size={13} muted>
					{expiresAt ? `This invite expires ${expiresIn(expiresAt)}. ` : ''}
					{onChangeCode ? (
						<Txt size={13} accent onPress={onChangeCode}>
							Use a different code
						</Txt>
					) : null}
				</Txt>
			) : null}
		</View>
	);
}
