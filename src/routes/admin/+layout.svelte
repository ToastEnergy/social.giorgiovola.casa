<script lang="ts">
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';

	let { data, children }: LayoutProps = $props();

	const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

	const tabs = $derived([
		{ href: '/admin', label: 'Reports', count: data.overview.open_reports },
		{ href: '/admin/users', label: 'Accounts', count: 0 },
		{ href: '/admin/log', label: 'Log', count: 0 },
		...(data.role === 'admin'
			? [
					{ href: '/admin/invites', label: 'Invites', count: 0 },
					{ href: '/admin/settings', label: 'Settings', count: 0 }
			  ]
			: [])
	]);

	// the reports tab is the panel's root, the others own everything under them
	const isCurrent = (href: string) =>
		href === '/admin'
			? page.url.pathname === '/admin'
			: page.url.pathname === href || page.url.pathname.startsWith(href + '/');

	const stats = $derived([
		{
			label: 'Open reports',
			value: data.overview.open_reports,
			href: '/admin',
			alert: data.overview.open_reports > 0
		},
		{ label: 'Banned', value: data.overview.banned, href: '/admin/users?filter=banned' },
		{ label: 'Muted', value: data.overview.muted, href: '/admin/users?filter=muted' },
		{ label: 'New this week', value: data.overview.new_accounts, href: '/admin/users' }
	]);

	let nav = $state<HTMLElement>();

	// on a narrow screen the active tab may start out of view: bring it in, without scrolling the page
	$effect(() => {
		void page.url.pathname;
		const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
		if (active && nav) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
	});

	const tabClass = (active: boolean) =>
		`flex shrink-0 grow items-center justify-center gap-[5px] border-b-2 px-2.5 py-2.5 text-foreground hover:no-underline ${
			active ? 'border-accent font-bold' : 'border-transparent opacity-60 hover:opacity-100'
		}`;
</script>

<div class="mb-5 flex items-baseline justify-between gap-2.5">
	<h1>Moderation</h1>
	<span class="text-[0.85em] text-muted">You are {data.role === 'admin' ? 'an admin' : 'a mod'}</span>
</div>

<div class="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
	{#each stats as s (s.label)}
		<a
			class="flex flex-col rounded-[10px] border p-2.5 text-foreground hover:bg-white/5 hover:no-underline {s.alert
				? 'border-danger'
				: 'border-line'}"
			href={s.href}
		>
			<span class="text-[1.5em] leading-tight font-extrabold {s.alert ? 'text-danger' : ''}"
				>{nf.format(s.value)}</span
			>
			<span class="text-[0.8em] text-muted">{s.label}</span>
		</a>
	{/each}
</div>

<nav
	class="mb-5 flex overflow-x-auto [scrollbar-width:none]"
	aria-label="Moderation sections"
	bind:this={nav}
>
	{#each tabs as tab (tab.href)}
		{@const active = isCurrent(tab.href)}
		<a class={tabClass(active)} href={tab.href} aria-current={active ? 'page' : undefined}>
			{tab.label}
			{#if tab.count > 0}
				<span
					class="rounded-full bg-danger px-[7px] text-[0.75em] leading-[18px] font-bold text-background"
					>{tab.count > 99 ? '99+' : tab.count}</span
				>
			{/if}
		</a>
	{/each}
</nav>

{@render children()}
