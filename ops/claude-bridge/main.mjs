import {startBridge} from './bridge.mjs';

const bridge = await startBridge({socketPath: process.env.TEMPO_CLAUDE_BRIDGE_SOCKET});
console.log('Claude subscription bridge listening.');

for (const signal of ['SIGTERM', 'SIGINT']) {
	process.once(signal, async () => {
		await bridge.close();
		process.exit(0);
	});
}
