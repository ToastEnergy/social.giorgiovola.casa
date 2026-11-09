<script lang="ts">
	import type { PageProps } from './$types';
	import Passkeys from '#lib/components/settings/Passkeys.svelte';
	import Sessions from '#lib/components/settings/Sessions.svelte';
	import SignIn from '#lib/components/settings/SignIn.svelte';

	let { data }: PageProps = $props();
</script>

<SignIn account={data.account} email={data.email} identity={data.identity} />
<Passkeys
	account={data.account}
	passkeys={data.passkeys}
	max={data.maxPasskeys}
	rpID={data.rpID}
	userHandle={data.userHandle}
/>
<Sessions account={data.account} sessions={data.sessions} />
