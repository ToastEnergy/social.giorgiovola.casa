<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import type { SwitcherAccount, SwitcherProfile } from '#lib/types.js';
	import { user } from '#lib/store.js';
	import { getAvatar } from '#lib/utils.js';
	import UnreadBadges from './UnreadBadges.svelte';
	import { switchTo } from '#lib/accounts.js';

	type Props = {
		/** avatar size in px */
		size?: number;
		/** open the menu above (the bottom bar), against the closest positioned ancestor */
		up?: boolean;
		/** open the menu above the button, for a button at the bottom of the sidebar */
		above?: boolean;
		/** a wide badge with the name and username next to the avatar */
		badge?: boolean;
	};
	let { size = 50, up = false, above = false, badge = false }: Props = $props();

	const menuPlace = $derived(
		// against the rail's badge + search wrapper, so it opens under the search box
		badge
			? 'top-[calc(100%+10px)] left-0 w-full'
			: up
			? 'right-2.5 bottom-[calc(100%+10px)] w-71'
			: above
			? 'bottom-[calc(100%+10px)] left-0 w-71'
			: 'top-[calc(100%+10px)] right-0 w-71'
	);

	const dotClass = $derived(
		`absolute top-0 right-0 ${
			size < 40 ? 'size-3' : 'size-4'
		} rounded-full border-2 border-background bg-accent`
	);
	const linkClass = 'rounded-sm p-1.5 text-[0.9em] hover:bg-white/5 hover:no-underline';

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

	const isActiveAccount = (a: SwitcherAccount) => a.active || a.identities.some((i) => i.active);
	const profilesOf = (a: SwitcherAccount): SwitcherProfile[] => [a, ...a.identities];
	const label = (p: SwitcherProfile) => `${p.name} (@${p.username})`;
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

{#if $user}
	<div class="{up || badge ? '' : 'relative'} {badge ? 'w-full' : ''}" bind:this={root}>
		<button
			class="relative flex cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent {badge
				? 'w-full items-center gap-2.5 rounded-[15px] bg-black p-2.5 text-left hover:bg-white/5'
				: 'rounded-full'}"
			aria-haspopup="menu"
			aria-expanded={open}
			title="Switch account"
			onclick={() => (open = !open)}
		>
			<span class="relative flex shrink-0">
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
				class="absolute {menuPlace} flex max-h-[calc(var(--fh,100vh)-86px)] max-w-[calc(100vw-26px)] flex-col gap-1 overflow-y-auto rounded-md border border-accent bg-background/95 p-1.5"
				role="menu"
			>
				<a
					class="flex items-center gap-2.5 rounded-sm p-1.5 hover:bg-white/5 hover:no-underline"
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

				{#each accounts() as account (account.id)}
					{#if !isActiveAccount(account) || profilesOf(account).some((p) => !p.active)}
						<div class="flex flex-col border-t border-line pt-1">
							<p class="truncate px-1.5 py-0.5 text-[0.75em] text-muted">
								{isActiveAccount(account) ? 'Switch profile' : 'Signed in as @' + account.username}
							</p>
							{#each profilesOf(account) as profile (profile.id)}
								{#if !profile.active}
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
								{/if}
							{/each}
						</div>
					{/if}
				{/each}

				<!-- moderation and settings are in the sidebar on mouse devices -->
				<div class="flex flex-col border-t border-line pt-1">
					{#if page.data.role && page.data.role !== 'user'}
						<a class="{linkClass} not-pointer-coarse:hidden" href="/admin" role="menuitem"
							>Moderation</a
						>
					{/if}
					<a class={linkClass} href="/accounts" role="menuitem">+ New identity / manage</a>
					<a class="{linkClass} not-pointer-coarse:hidden" href="/settings" role="menuitem"
						>Settings</a
					>
					<a class={linkClass} href="/install" role="menuitem">Install app</a>
					<a class={linkClass} href="/login" role="menuitem">+ Sign in to another account</a>
					<a class="{linkClass} text-danger" href="/logout" role="menuitem">Log out</a>
				</div>
			</div>
		{/if}
	</div>
{/if}
