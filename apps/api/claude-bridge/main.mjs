import {startBridge} from './bridge.mjs';

const {TEMPO_CLAUDE_BRIDGE_SOCKET: socketPath, TEMPO_CLAUDE_BRIDGE_CLIENT_UID: clientUid} = process.env;
// Digits only, as the CI check reads it from the unit; anything else reaches startBridge as NaN and is refused.
const bridge = await startBridge({
	socketPath,
	clientUid: clientUid === undefined ? undefined : /^[0-9]+$/.test(clientUid) ? Number(clientUid) : Number.NaN,
});
console.log('Claude subscription bridge listening.');

for (const signal of ['SIGTERM', 'SIGINT']) {
	process.once(signal, async () => {
		await bridge.close();
		process.exit(0);
	});
}
