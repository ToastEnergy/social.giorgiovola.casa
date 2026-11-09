/**
 * The state of the realtime stream, for the status pill (ConnectionStatus.svelte).
 *
 * - `connecting`: opening for the first time, nothing was missed yet
 * - `open`: live
 * - `reconnecting`: the stream dropped and is being opened again; events are being missed
 * - `offline`: the browser says there's no network; reconnects as soon as it's back
 * - `refreshing`: back up, the open page is reloading what was missed
 */
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'refreshing';

export const connection = $state<{ state: ConnectionState }>({ state: 'connecting' });
