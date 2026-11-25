// Fails at once when node_modules differs from package-lock.json, so a stale checkout stops before the E2E
// stack starts or the contracts build runs. Every locked package counts, including transitive ones; an optional
// package that npm skipped on this platform is left out, and the linked contracts package is rebuilt instead.
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(resolve(apiDir, path), 'utf8'));

const stale = Object.entries(readJson('package-lock.json').packages).filter(([path, entry]) => {
	if (!path || entry.link) return false;
	try {
		return readJson(`${path}/package.json`).version !== entry.version;
	} catch {
		return !entry.optional;
	}
});
if (stale.length > 0) {
	const names = stale.map(([path]) => path.replace(/^.*node_modules\//, ''));
	const listed = names.slice(0, 10).join(', ') + (names.length > 10 ? ` and ${names.length - 10} more` : '');
	console.error(`Installed packages differ from package-lock.json (${listed}). Run npm ci in apps/api.`);
	process.exit(1);
}
