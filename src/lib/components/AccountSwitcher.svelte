<script lang="ts">
	import LogIn from '@lucide/svelte/icons/log-in';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import Download from '@lucide/svelte/icons/download';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import type { SwitcherAccount, SwitcherProfile } from '#lib/types.js';
	import { user } from '#lib/store.js';
	import { getAvatar } from '#lib/utils.js';
	import UnreadBadges from './UnreadBadges.svelte';
	import { previousProfile, rememberProfile, switchTo } from '#lib/accounts.js';

	type Props = {
		/** avatar size in px */
		size?: number;
		/** open the menu above (the bottom bar), against the closest positioned ancestor */
		up?: boolean;
		/** open the menu above the button, for a button at the bottom of the sidebar */
		above?: boolean;
		/** a wide badge with the name and username next to the avatar */
		badge?: boolean;
		/** open the menu below, aligned to the button's left edge (top left of the screen) */
		start?: boolean;
		/** a double tap switches straight to the profile used before (the touch bottom bar) */
		doubleTap?: boolean;
	};
	let {
		size = 50,
		up = false,
		above = false,
		badge = false,
		start = false,
		doubleTap = false
	}: Props = $props();

	const menuPlace = $derived(
		// against the rail's badge + search wrapper, so it opens under the search box
		badge
			? 'top-[calc(100%+10px)] left-0 w-full'
			: up
			? 'right-2.5 bottom-[calc(100%+10px)] w-71'
			: above
			? 'bottom-[calc(100%+10px)] left-0 w-71'
			: start
			? 'top-[calc(100%+10px)] left-0 w-71'
			: 'top-[calc(100%+10px)] right-0 w-71'
	);

	const dotClass = $derived(
		`absolute top-0 right-0 ${
			size < 40 ? 'size-3' : 'size-4'
		} rounded-full border-2 border-background bg-accent`
	);
	const actionClass =
		'flex items-center gap-2 rounded-sm p-1.5 text-[0.9em] text-foreground hover:bg-white/5 hover:no-underline';
	const iconClass =
		'flex size-9 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-white/5 hover:no-underline';

	let open = $state(false);
	let root: HTMLElement | undefined = $state();
	let switching = $state(false);

	async function switchProfile(username: string) {
		switching = true;
		try {
			await switchTo(username, page.url.pathname);
		} catch (e) {
			switching = false;
			alert(e instanceof Error ? e.message : "Couldn't switch profile");
		}
	}

	const accounts = () => (page.data.accounts ?? []) as SwitcherAccount[];
	const otherUnread = () =>
		accounts()
			.flatMap(profilesOf)
			.filter((p) => !p.active)
			.reduce((n, p) => n + p.unread + p.unreadMessages + p.unreadReactions, 0);

	beforeNavigate(() => (open = false));

	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') open = false;
	}

	// the menu scrolls within the room left between where it opens and the window's edge (10px
	// margin): a fixed cap can't know that, under the rail's badge and search it starts far down
	function fit(menu: HTMLElement) {
		const size = () => {
			menu.style.maxHeight = '';
			const rect = menu.getBoundingClientRect();
			const room = up || above ? rect.bottom - 10 : window.innerHeight - rect.top - 10;
			menu.style.maxHeight = `${Math.max(room, 120)}px`;
		};
		size();
		window.addEventListener('resize', size);
		return { destroy: () => window.removeEventListener('resize', size) };
	}

	const isActiveAccount = (a: SwitcherAccount) => a.active || a.identities.some((i) => i.active);
	const profilesOf = (a: SwitcherAccount): SwitcherProfile[] => [a, ...a.identities];
	const label = (p: SwitcherProfile) => `${p.name} (@${p.username})`;

	// every profile there is to switch to, grouped by the account it belongs to
	const others = () => accounts().flatMap((a) => profilesOf(a).filter((p) => !p.active));
	const groups = () =>
		accounts()
			.map((account) => ({ account, profiles: profilesOf(account).filter((p) => !p.active) }))
			.filter((g) => g.profiles.length > 0);

	// followed on every load, so a login or a switch in another tab counts as well
	$effect(() => {
		if ($user) rememberProfile($user.username);
	});

	// the profile a double tap goes to: the one used before, or else the first other one
	const quickSwitch = $derived(
		doubleTap
			? previousProfile(
					accounts()
						.flatMap(profilesOf)
						.filter((p) => !p.active)
						.map((p) => p.username)
			  )
			: undefined
	);

	// with somewhere to switch to, a first tap waits this long for a second before opening the menu
	const DOUBLE_TAP_MS = 250;
	let tapTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(tapTimer));

	function onTap() {
		if (switching) return;
		if (open || !quickSwitch) {
			open = !open;
			return;
		}
		if (tapTimer) {
			clearTimeout(tapTimer);
			tapTimer = undefined;
			switchProfile(quickSwitch);
			return;
		}
		tapTimer = setTimeout(() => {
			tapTimer = undefined;
			open = true;
		}, DOUBLE_TAP_MS);
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

{#if $user}
	<div class="{up || badge ? '' : 'relative'} {badge ? 'w-full' : ''}" bind:this={root}>
		<button
			class="relative flex cursor-pointer touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent {badge
				? 'w-full items-center gap-2.5 rounded-[15px] bg-black p-2.5 text-left hover:bg-white/5'
				: 'rounded-full'}"
			aria-haspopup="menu"
			aria-expanded={open}
			title={quickSwitch ? `Switch account (double tap: @${quickSwitch})` : 'Switch account'}
			aria-label={otherUnread() > 0
				? 'Profile menu (unread on your other profiles)'
				: 'Profile menu'}
			onclick={onTap}
		>
			<span class="relative flex shrink-0 {switching ? 'opacity-50' : ''}">
				<img
					class="max-w-none rounded-full object-cover"
					style:width="{size}px"
					style:height="{size}px"
					src={getAvatar($user, size)}
					alt={$user.username + "'s avatar"}
					height={size}
					width={size}
				/>
				{#if otherUnread() > 0}
					<!-- prettier-ignore -->
					<span class={dotClass} title="Unread notifications or messages on your other profiles"></span>
				{/if}
			</span>
			{#if badge}
				<span class="flex min-w-0 flex-col">
					<b class="truncate text-foreground">{$user.name}</b>
					<span class="truncate text-[0.85em] opacity-70">@{$user.username}</span>
				</span>
				<Ellipsis class="ml-auto shrink-0 text-muted" size={20} />
			{/if}
		</button>

		{#if open}
			<div
				use:fit
				class="absolute {menuPlace} flex max-w-[calc(100vw-26px)] flex-col overflow-y-auto rounded-md border border-accent bg-background/95 p-1.5"
				role="menu"
			>
				<!-- the current profile and the actions stay on top, so a long list of profiles can't push
				     them out of reach: only the list in the middle scrolls -->
				<div class="flex shrink-0 items-center gap-1">
					<a
						class="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm p-1.5 hover:bg-white/5 hover:no-underline"
						href={'/@' + $user.username}
						role="menuitem"
					>
						<img
							class="size-10 max-w-none shrink-0 rounded-full object-cover"
							src={getAvatar($user, 40)}
							alt=""
							width="40"
							height="40"
						/>
						<div class="flex min-w-0 flex-1 flex-col text-left">
							<b class="truncate text-foreground">{$user.name}</b>
							<span class="truncate text-[0.8em] text-muted"
								>@{$user.username}{$user.owner_id ? ' · identity' : ''}</span
							>
						</div>
					</a>
					<!-- settings and moderation are in the sidebar on mouse devices -->
					{#if page.data.role && page.data.role !== 'user'}
						<a
							class="{iconClass} not-pointer-coarse:hidden"
							href="/admin"
							role="menuitem"
							title="Moderation"
							aria-label="Moderation"><Shield size={20} /></a
						>
					{/if}
					<a
						class="{iconClass} not-pointer-coarse:hidden"
						href="/settings"
						role="menuitem"
						title="Settings"
						aria-label="Settings"><Settings size={20} /></a
					>
				</div>

				<div class="grid shrink-0 grid-cols-2 gap-1 border-t border-line pt-1 mt-1">
					<a class={actionClass} href="/settings/accounts" role="menuitem"
						><UsersRound size={16} class="shrink-0 text-muted" />Identities</a
					>
					<a class={actionClass} href="/install" role="menuitem"
						><Download size={16} class="shrink-0 text-muted" />Install app</a
					>
				</div>

				{#if others().length > 0}
					<div class="mt-1 flex min-h-0 flex-col border-t border-line pt-1">
						<div class="min-h-12 flex-1 overflow-y-auto overscroll-contain">
							{#each groups() as group (group.account.id)}
								<p class="truncate px-1.5 py-0.5 text-[0.75em] text-muted">
									{isActiveAccount(group.account)
										? 'Switch profile'
										: 'Signed in as @' + group.account.username}
								</p>
								{#each group.profiles as profile (profile.id)}
									<button
										class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-[5px] outline-none hover:bg-white/5 focus-visible:bg-white/5"
										type="button"
										role="menuitem"
										title={label(profile)}
										disabled={switching}
										onclick={() => switchProfile(profile.username)}
									>
										<img
											class="size-7 max-w-none shrink-0 rounded-full object-cover"
											src={getAvatar(profile, 28)}
											alt=""
											width="28"
											height="28"
										/>
										<span class="flex min-w-0 flex-1 flex-col text-left">
											<span class="truncate text-[0.9em] text-foreground">{profile.name}</span>
											<span class="truncate text-[0.8em] text-muted"
												>@{profile.username}{profile.sharedBy ? ' · shared' : ''}</span
											>
										</span>
										<UnreadBadges
											notifications={profile.unread}
											messages={profile.unreadMessages + profile.unreadReactions}
										/>
									</button>
								{/each}
							{/each}
						</div>
					</div>
				{/if}

				<div class="mt-1 flex shrink-0 gap-1 border-t border-line pt-1">
					<a class="{actionClass} flex-1" href="/login" role="menuitem"
						><UserPlus size={16} class="shrink-0 text-muted" />Add account</a
					>
					<a class="{actionClass} text-danger" href="/logout" role="menuitem"
						><LogOut size={16} class="shrink-0" />Log out</a
					>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- signed out: a login icon where the profile would be, with its name in the rail (badge) -->
	<a
		class="flex shrink-0 items-center text-foreground hover:text-accent hover:no-underline {badge
			? 'gap-2.5 self-start font-bold'
			: 'justify-center'}"
		style:width={badge ? undefined : `${size}px`}
		style:height="{size}px"
		href="/login"
		title="Log in"
		aria-label="Log in"
	>
		<LogIn size={Math.round(size * 0.6)} />
		{#if badge}Login{/if}
	</a>
{/if}
