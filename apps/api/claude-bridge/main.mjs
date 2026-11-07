import {startBridge} from './bridge.mjs';

const {TEMPO_CLAUDE_BRIDGE_SOCKET: socketPath, TEMPO_CLAUDE_BRIDGE_CLIENT_UID: clientUid} = process.env;
const bridge = await startBridge({socketPath, clientUid: clientUid === undefined ? undefined : Number(clientUid)});
console.log('Claude subscription bridge listening.');

for (const signal of ['SIGTERM', 'SIGINT']) {
	process.once(signal, async () => {
		await bridge.close();
		process.exit(0);
	});
}
