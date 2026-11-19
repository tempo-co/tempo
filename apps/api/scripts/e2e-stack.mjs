// Runs a command (the E2E suite) against a fresh Compose stack owned by this checkout, then removes the stack.
// The project name comes from the checkout's path and Docker picks the host ports, so every worktree gets its own
// PostgreSQL, Redis and Mailpit.
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const apiDir = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const project = `tempo-api-test-${createHash('sha256').update(apiDir).digest('hex').slice(0, 8)}`;
const composeArgs = ['compose', '-p', project, '-f', 'docker-compose.test.yml', '--env-file', '.env.test'];

function compose(args, {capture = false} = {}) {
	const result = spawnSync('docker', [...composeArgs, ...args], {
		cwd: apiDir,
		encoding: 'utf8',
		stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
	});
	if (result.status !== 0) throw new Error(`docker compose -p ${project} ${args.join(' ')} failed`);
	return result.stdout;
}

function removeStack() {
	compose(['down', '-v', '--remove-orphans']);
}

/** The host port Docker published for a service's container port, e.g. `127.0.0.1:49153` → `49153`. */
function hostPort(service, containerPort) {
	return compose(['port', service, String(containerPort)], {capture: true})
		.trim()
		.split(':')
		.pop();
}

const [command, ...commandArgs] = process.argv.slice(2);
if (!command) throw new Error('Usage: node scripts/e2e-stack.mjs <command> [args...]');

// Ctrl-C reaches Docker and the command directly; wait for them to exit so the stack is still removed.
process.on('SIGINT', () => {});
console.log(`E2E stack: ${project}`);
removeStack();
let env;
try {
	compose(['up', '--wait']);
	const redisPort = hostPort('redis', 6379);
	env = {
		...process.env,
		DB_HOST: '127.0.0.1',
		DB_PORT: hostPort('postgres', 5432),
		REDIS_HOST: '127.0.0.1',
		REDIS_PORT: redisPort,
		REDIS_URL: `redis://127.0.0.1:${redisPort}`,
		EMAIL_HOST: '127.0.0.1',
		EMAIL_PORT: hostPort('mailpit', 1025),
		EMAIL_UI_PORT: hostPort('mailpit', 8025),
	};
} catch (error) {
	removeStack();
	throw error;
}

const child = spawn(command, commandArgs, {cwd: apiDir, env, stdio: 'inherit'});
process.on('SIGTERM', () => child.kill('SIGTERM'));
function finish(code) {
	removeStack();
	process.exit(code);
}
child.on('error', (error) => {
	console.error(error.message);
	finish(1);
});
child.on('exit', (code, signal) => finish(code ?? (signal ? 1 : 0)));
