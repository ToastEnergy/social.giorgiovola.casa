<script lang="ts">
	import '@fontsource-variable/manrope';
	import '../app.css';
	import { onMount } from 'svelte';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import Rail from '#lib/components/Rail.svelte';
	import TopBar from '#lib/components/TopBar.svelte';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import MobileHeader from '#lib/components/MobileHeader.svelte';
	import type { LayoutData } from './$types';
	import { user, isMobile, notisCount, messagesCount } from '#lib/store.js';
	import { navigating, page } from '$app/state';
	import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
	import ImageViewer from '#lib/components/ImageViewer.svelte';
	import PhotoEditor from '#lib/components/PhotoEditor.svelte';
	import ProfileCard from '#lib/components/ProfileCard.svelte';
	import ShareDialog from '#lib/components/ShareDialog.svelte';
	import ComposeSheet from '#lib/components/ComposeSheet.svelte';
	// side effect import: starts listening for the browser's install prompt for the /install page
	import '#lib/install.svelte.js';
	import { PUBLIC_URL } from '$app/env/public';
	import { getAvatar } from '#lib/utils.js';
	import { connectRealtime, disconnectRealtime, onRealtime } from '#lib/realtime.js';
	import { syncPush } from '#lib/push.js';
	import { syncTimeCookies } from '#lib/time.svelte.js';
	import { watchKeyboard } from '#lib/keyboard.svelte.js';

	export let data: LayoutData;

	// an open chat fills the screen: narrow screens drop the header for it (its back arrow shows
	// the unread count instead). the layout is legacy syntax, where `$:` doesn't re-run on a
	// navigation (`page` isn't a local variable), so these are called from the template
	const isChat = (id: string | null) =>
		id === '/messages/[username]' || id === '/messages/groups/[id]';
	// the messages index is wide too: conversation list beside an empty chat
	const isWide = (id: string | null) => isChat(id) || id === '/messages';
	// no panel on mouse devices: the page is made of black blocks of its own (home: composer and
	// timeline; an open post: the post, the reply composer and the replies), stacked in a column
	// as tall as the panel would be so the last block can fill the rest
	const isSplit = (id: string | null) => id === '/' || id === '/@[username]/[post]';
	// sizes of the centred group on mouse devices (app.css)
	const frame = (id: string | null) => `frame frame-sidebar ${isWide(id) ? 'frame-wide' : ''}`;
	$user = data.user;
	$notisCount = data.notisCount;
	$messagesCount = data.messagesCount;

	// social cards can't show SVGs: use the first other image of a post, else the generated card
	const postCard = (post: { images?: string[] }) => {
		const image = post.images?.find((i) => !i.endsWith('.svg'));
		return image ? (PUBLIC_URL || page.url.origin) + image : publicUrl() + '/image.png';
	};
	// image-only posts have no text to quote
	const postText = (post: { content: string; images?: string[] }) =>
		post.content || (post.images?.length ? '[image]' : '');

	// adapter-node no longer rewrites the request URL to the public origin (SvelteKit 3 dropped
	// ORIGIN), so build absolute share URLs from PUBLIC_URL like the canonical link does
	const publicUrl = () => `${PUBLIC_URL || page.url.origin}${page.url.pathname}${page.url.search}`;

	// the stream is tied to the active profile (unread count), so reconnect when it changes
	let mounted = false;
	$: userId = data.user?.id ?? null;
	$: if (mounted) {
		userId;
		connectRealtime();
	}

	// push subscriptions belong to a session: bind this browser's one to the profile now in use
	$: if (mounted && userId !== null) syncPush().catch(() => {});

	// unread count on the installed app's icon
	$: if (mounted && 'setAppBadge' in navigator) {
		if ($notisCount + $messagesCount > 0)
			navigator.setAppBadge($notisCount + $messagesCount).catch(() => {});
		else navigator.clearAppBadge().catch(() => {});
	}

	// unread count in the tab title too. pages set their own <title> (Svelte writes
	// document.title), so the prefix is re-applied whenever the title changes
	const titleCount = /^\(\d+\+?\) /;
	const applyTitleCount = (count: number) => {
		const base = document.title.replace(titleCount, '');
		const title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
		// guard: setting the title fires the observer below again
		if (document.title !== title) document.title = title;
	};
	$: if (mounted) applyTitleCount($notisCount + $messagesCount);

	onMount(() => {
		const titleObserver = new MutationObserver(() => applyTitleCount($notisCount + $messagesCount));
		titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
		return () => titleObserver.disconnect();
	});

	onMount(() => {
		mounted = true;
		syncTimeCookies(data.time);
		const offNotifications = onRealtime('notifications', ({ count }) => ($notisCount = count));
		const offMessages = onRealtime(
			'messages_unread',
			({ count, reactions }) => ($messagesCount = count + (reactions ?? 0))
		);
		return () => {
			offNotifications();
			offMessages();
			disconnectRealtime();
		};
	});

	onMount(watchKeyboard);

	onMount(async () => {
		if ('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0) {
			$isMobile = true;
		}

		const editing = () => {
			const el = document.activeElement;
			return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea'));
		};

		document.documentElement.style.setProperty('--fh', `${window.innerHeight}px`);
		window.addEventListener('resize', () => {
			// the on-screen keyboard shrinks the window too: resizing what --fh caps (a long post)
			// would move the field being typed in back under the keyboard
			if (editing()) return;
			document.documentElement.style.setProperty('--fh', `${window.innerHeight}px`);
		});

		// some browsers (Firefox on Android) don't bring the focused field back into view once
		// the keyboard has opened
		const viewport = window.visualViewport;
		viewport?.addEventListener('resize', () => {
			const el = document.activeElement;
			if (!editing() || !(el instanceof HTMLElement)) return;
			// the reply bar and the full screen composer fit themselves to what's visible: scrolling
			// them as well moves the visual viewport again (iOS), and they jump while typing
			if (el.closest('[data-keyboard-fit]')) return;
			requestAnimationFrame(() => {
				const rect = el.getBoundingClientRect();
				const bottom = viewport.offsetTop + viewport.height;
				if (rect.bottom > bottom || rect.top < viewport.offsetTop)
					el.scrollIntoView({ block: 'nearest' });
			});
		});
	});
</script>

<div class={frame(page.route.id)}>
	<Sidebar wide={isWide(page.route.id)} />
	<!-- the wide pages (messages) have the search and profile on top instead -->
	{#if !isWide(page.route.id)}
		<Rail />
	{/if}
	<TopBar wide={isWide(page.route.id)} />
	<!-- an open chat has its own input, with the bar joined under it (Chat) -->
	{#if !isChat(page.route.id)}
		<BottomNav />
	{/if}
	<ImageViewer />
	<ProfileCard />
	<ShareDialog />
	<ComposeSheet />
	<PhotoEditor />
</div>
<svelte:head>
	{#if page.route.id === '/@[username]/[post]' && !page.error}
		<!-- Primary Meta Tags -->
		<title>{`${page.data.post.user.name} : "${postText(page.data.post)}"`}</title>
		<meta name="title" content={`${page.data.post.user.name} on social.giorgiovola.casa`} />
		<meta name="description" content={postText(page.data.post)} />

		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="article" />
		<meta property="og:url" content={publicUrl()} />
		<meta
			property="og:title"
			content={`${page.data.post.user.name} : "${postText(page.data.post)}"`}
		/>
		<meta property="og:description" content={postText(page.data.post)} />
		<meta property="og:image" content={postCard(page.data.post)} />
		<meta property="og:profile:username" content={page.data.post.user.username} />
		<meta
			property="og:article:published_time"
			content={new Date(page.data.post.created_at).toISOString()}
		/>

		<!-- Twitter -->
		<meta property="twitter:card" content="summary_large_image" />
		<meta property="twitter:url" content={publicUrl()} />
		<meta
			property="twitter:title"
			content={`${page.data.post.user.name} on social.giorgiovola.casa`}
		/>
		<meta property="twitter:description" content={postText(page.data.post)} />
		<meta property="twitter:image" content={postCard(page.data.post)} />
	{:else if page.route.id === '/@[username]' && !page.error}
		<!-- Primary Meta Tags -->
		<title>{page.data.user.name} (@{page.data.user.username}) / social.giorgiovola.casa</title>
		<meta
			name="title"
			content={`${page.data.user.name} (@${page.data.user.username}) / social.giorgiovola.casa`}
		/>
		<meta
			name="description"
			content={page.data.bio || `Follow @${page.data.user.username} on social.giorgiovola.casa`}
		/>

		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="profile" />
		<meta property="og:url" content={publicUrl()} />
		<meta
			property="og:title"
			content={`${page.data.user.name} (@${page.data.user.username}) / social.giorgiovola.casa}`}
		/>
		<meta
			property="og:description"
			content={page.data.bio || `Follow @${page.data.user.username} on social.giorgiovola.casa`}
		/>
		<meta property="og:image" content={getAvatar(page.data.user, 500, true)} />
		<meta property="og:profile:username" content={page.data.user.username} />
		<meta property="og:profile:first_name" content={page.data.user.name} />
		<!-- Twitter -->
		<meta property="twitter:card" content="summary_large_image" />
		<meta property="twitter:url" content={publicUrl()} />
		<meta
			property="twitter:title"
			content={`${page.data.user.name} (@${page.data.user.username}) / social.giorgiovola.casa`}
		/>
		<meta
			property="twitter:description"
			content={page.data.bio || `Follow @${page.data.user.username} on social.giorgiovola.casa`}
		/>
		<meta property="twitter:image" content={`${getAvatar(page.data.user, 500, true)}`} />
	{:else}
		<!-- Primary Meta Tags -->
		<title>Social Giorgiovola Casa</title>
		<meta name="title" content="Social Giorgiovola Casa" />
		<meta
			name="description"
			content="Imagine a new way of thinking the social networking world. u got it? this isn't it, bye."
		/>
		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="website" />
		<meta property="og:url" content="https://social.giorgiovola.casa/" />
		<meta property="og:title" content="Social Giorgiovola Casa" />
		<meta
			property="og:description"
			content="Imagine a new way of thinking the social networking world. u got it? this isn't it, bye."
		/>
		<meta property="og:image" content="/OpenGraph.png" />

		<!-- Twitter -->
		<meta property="twitter:url" content="https://social.giorgiovola.casa/" />
		<meta property="twitter:title" content="Social Giorgiovola Casa" />
		<meta
			property="twitter:description"
			content="Imagine a new way of thinking the social networking world. u got it? this isn't it, bye."
		/>
		<meta property="twitter:image" content={`${PUBLIC_URL}/OpenGraph.png`} />
	{/if}
	<link rel="canonical" href={`${PUBLIC_URL}${page.url.pathname}`} />
</svelte:head>
<!-- devices with a mouse: the logo, sidebar, header and content form one centred group (the
	`frame` variables in app.css). the header and sidebar share the page background and the content
	sits on a darker, rounded panel. the window still scrolls (infinite lists watch it), so a fixed
	frame paints the background around the panel's edges and the content scrolls under it. the
	spread "shadow" is a mask in the page colour, not a visible shadow -->
<div class={frame(page.route.id)}>
	<!-- prettier-ignore -->
	<div
		aria-hidden="true"
		class="pointer-events-none fixed bottom-5 left-[calc(var(--left)+var(--side))] z-997 w-(--panel) rounded-[15px] shadow-[0_0_0_100vmax_var(--color-background)] pointer-coarse:hidden top-[calc(20px+var(--bar))] {isWide(page.route.id)
			? ''
			: 'max-nav:right-0 max-nav:bottom-0 max-nav:w-auto max-nav:rounded-r-none max-nav:rounded-bl-none'}"
	></div>
	<!-- the panel (mouse) or room for the bottom bar (touch). the wide pages (messages) have no panel
		on mouse devices: their blocks (messages/+layout) are the black, rounded surfaces -->
	<main
		class="relative mt-20 flex justify-center not-pointer-coarse:mb-5 not-pointer-coarse:ml-[calc(var(--left)+var(--side))] not-pointer-coarse:w-(--panel) pointer-coarse:mt-0 not-pointer-coarse:mt-[calc(20px+var(--bar))] {isWide(
			page.route.id
		)
			? ''
			: 'not-pointer-coarse:min-h-[calc(100dvh-40px-var(--bar))] not-pointer-coarse:rounded-[15px] max-nav:not-pointer-coarse:mb-0 max-nav:not-pointer-coarse:w-auto max-nav:not-pointer-coarse:min-h-[calc(100dvh-20px-var(--bar))] max-nav:not-pointer-coarse:rounded-r-none max-nav:not-pointer-coarse:rounded-bl-none'} {isWide(
			page.route.id
		) || isSplit(page.route.id)
			? ''
			: 'not-pointer-coarse:bg-black'} {isChat(page.route.id)
			? 'max-lg:mt-0 max-lg:not-pointer-coarse:mt-[calc(20px+var(--bar))]'
			: 'pointer-coarse:pb-(--bottom-bar)'}"
	>
		<!-- an open chat takes the full width, and sits beside the conversation list on wide screens
			(messages/+layout) -->
		<div
			class="w-full {isWide(page.route.id)
				? 'pointer-coarse:p-5 pointer-coarse:lg:max-w-260'
				: 'max-w-160 p-5 max-nav:max-w-none'} {isSplit(page.route.id)
				? 'not-pointer-coarse:flex not-pointer-coarse:flex-col not-pointer-coarse:p-0'
				: ''}"
		>
			<!-- touch devices: the logo and a search bar on top. messages have their own (the
				list's search, the chat's back arrow) -->
			{#if !isWide(page.route.id)}
				<MobileHeader />
			{/if}
			<slot />
		</div>
		{#if navigating.to}
			<LoadingOverlay />
		{/if}
	</main>
</div>
