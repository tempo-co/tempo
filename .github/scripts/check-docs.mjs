#!/usr/bin/env node
// Checks the living docs against the repository: every backticked path and every
// `npm run` script they name must exist, and every doc must stay within its word budget.
// Plain Node, no dependencies. Settings live in check-docs.json next to this file.
//
// - Path rule: a code span with no whitespace that contains `/` or ends in a configured
//   extension must name a tracked file or directory, relative to the repository root, the
//   doc's directory or the doc's app (the nearest directory above it with a package.json).
//   Placeholders (`<`), globs (`*`), elisions (`...`, `…`) and URLs are skipped, and so are
//   paths outside the repository: absolute (`/`), home (`~`) or variable (`$`) paths,
//   scoped npm packages (`@scope/name`) and `NAME=value` assignments. Paths that exist only
//   after a build or outside git are listed in `allowMissing` with a reason.
// - Script rule: `npm run X` and `npm --prefix <dir> run X`, in code spans and fenced
//   blocks, need script X in <dir>/package.json (root-relative, else doc-relative), or
//   without a prefix in the doc's app package.json.
// - Budget rule: words as `wc -w` counts them; first matching `budgets` entry, else
//   `defaultBudget`. A file may exceed it only through an `overrides` entry with a reason.
//
// Usage: node .github/scripts/check-docs.mjs [--config <file>]
// Run from anywhere inside the git checkout; only tracked files count as existing.

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const posix = path.posix;

// `**/` matches any number of directories (including none), `*` anything but `/`.
export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      if (i === glob.length - 2 && source.endsWith('/')) {
        // A trailing `/**` also matches the directory itself.
        source = `${source.slice(0, -1)}(?:/.*)?`;
        i += 1;
      } else if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const matchesAny = (file, globs = []) => globs.some((glob) => globToRegExp(glob).test(file));

// Same rule as `wc -w`: words are runs of non-whitespace.
export function countWords(text) {
  return text.split(/[ \t\n\v\f\r]+/).filter(Boolean).length;
}

export function validateConfig(config) {
  const errors = [];
  if (!Array.isArray(config.docs) || config.docs.length === 0) {
    errors.push('`docs` must list the globs of the living docs');
  }
  if (!Number.isInteger(config.defaultBudget) || config.defaultBudget <= 0) {
    errors.push('`defaultBudget` must be a positive integer');
  }
  for (const [index, budget] of (config.budgets ?? []).entries()) {
    if (typeof budget.pattern !== 'string' || !Number.isInteger(budget.words)) {
      errors.push(`budgets[${index}] needs a string \`pattern\` and an integer \`words\``);
    }
  }
  for (const [file, override] of Object.entries(config.overrides ?? {})) {
    if (!Number.isInteger(override?.words)) {
      errors.push(`override for ${file} needs an integer \`words\``);
    }
    if (typeof override?.reason !== 'string' || override.reason.trim() === '') {
      errors.push(`override for ${file} needs a one-line \`reason\``);
    }
  }
  for (const [index, entry] of (config.allowMissing ?? []).entries()) {
    if (!Array.isArray(entry?.paths) || entry.paths.length === 0) {
      errors.push(`allowMissing[${index}] needs a list of \`paths\` globs`);
    }
    if (entry?.docs !== undefined && !Array.isArray(entry.docs)) {
      errors.push(`allowMissing[${index}].docs must be a list of globs`);
    }
    if (typeof entry?.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(`allowMissing[${index}] needs a one-line \`reason\``);
    }
  }
  return errors;
}

// The budget table applies first match wins; overrides replace it for one file.
export function baseBudget(file, config) {
  const rule = (config.budgets ?? []).find((budget) => globToRegExp(budget.pattern).test(file));
  return rule ? rule.words : config.defaultBudget;
}

// A token is skipped when it is a placeholder, a glob, an elision or a URL.
export function isSkippedToken(token) {
  return (
    /\s/.test(token) ||
    token.includes('<') ||
    token.includes('*') ||
    token.includes('...') ||
    token.includes('…') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(token)
  );
}

// Paths that cannot be in the repository, and names that only look like paths.
export function isOutsideRepo(token) {
  return (
    /^[/~$]/.test(token) ||
    /^@[\w.-]+\/[\w.-]+$/.test(token) ||
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
  );
}

export function isPathToken(token, extensions) {
  if (isSkippedToken(token) || isOutsideRepo(token)) return false;
  if (token.includes('/')) return true;
  return extensions.some((extension) => token.endsWith(extension) && token !== extension);
}

// Each code span on a line, with fenced blocks reported separately (they hold commands,
// not path references).
export function* codeSegments(text) {
  const lines = text.split('\n');
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // A closing fence is the fence character alone (at least as many), with no info string.
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = null;
      } else {
        yield {kind: 'block', text: line, line: lineNumber};
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const spans = /(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
    for (const match of line.matchAll(spans)) {
      yield {kind: 'span', text: match[2].trim(), line: lineNumber};
    }
  }
}

// `npm run X` and `npm --prefix <dir> run X` (other flags before `run` are allowed).
export function* npmScripts(text) {
  const command =
    /\bnpm((?:\s+(?:--prefix(?:=|\s+)\S+|-{1,2}[\w-]+(?:=\S+)?))*)\s+run(?:-script)?\s+([^\s`'"]+)/g;
  for (const match of text.matchAll(command)) {
    const prefix = /--prefix(?:=|\s+)(\S+)/.exec(match[1])?.[1];
    yield {prefix, script: match[2]};
  }
}

export function checkDocs({tracked, read, config}) {
  const problems = validateConfig(config).map((message) => ({file: 'config', line: 0, message}));
  if (problems.length > 0) return problems;

  const files = new Set(tracked);
  const directories = new Set(['.']);
  for (const file of tracked) {
    for (let dir = posix.dirname(file); dir !== '.'; dir = posix.dirname(dir)) {
      directories.add(dir);
    }
  }
  const exists = (candidate) => {
    const normal = posix.normalize(candidate).replace(/\/$/, '');
    if (normal.startsWith('../') || normal === '..') return false;
    return files.has(normal) || directories.has(normal);
  };
  const packageCache = new Map();
  const scriptsOf = (dir) => {
    const file = posix.join(dir, 'package.json');
    if (!files.has(file)) return null;
    if (!packageCache.has(file)) {
      packageCache.set(file, JSON.parse(read(file)).scripts ?? {});
    }
    return packageCache.get(file);
  };
  // The app a doc belongs to: the nearest directory at or above it with a package.json.
  const appDirOf = (docDir) => {
    for (let dir = docDir; ; dir = posix.dirname(dir)) {
      if (files.has(posix.join(dir, 'package.json'))) return dir;
      if (dir === '.') return null;
    }
  };

  const extensions = config.extensions ?? [];
  const allowMissing = (config.allowMissing ?? []).map((entry) => ({...entry, used: false}));
  const overrides = config.overrides ?? {};
  const docs = tracked.filter((file) => matchesAny(file, config.docs)).sort();

  for (const file of Object.keys(overrides)) {
    if (!docs.includes(file)) {
      problems.push({file: 'config', line: 0, message: `override for ${file}: not a living doc`});
    }
  }

  for (const doc of docs) {
    const text = read(doc);
    const docDir = posix.dirname(doc);
    const appDir = appDirOf(docDir);
    const report = (line, message) => problems.push({file: doc, line, message});

    const words = countWords(text);
    const budget = baseBudget(doc, config);
    const override = overrides[doc];
    if (override) {
      if (words <= budget) {
        report(1, `${words} words is within the ${budget}-word budget: remove its override`);
      } else if (words > override.words) {
        report(1, `${words} words is over its ${override.words}-word override`);
      }
    } else if (words > budget) {
      report(1, `${words} words is over its ${budget}-word budget`);
    }

    for (const segment of codeSegments(text)) {
      for (const {prefix, script} of npmScripts(segment.text)) {
        if (isSkippedToken(script) || script.includes('$')) continue;
        let dir = appDir;
        if (prefix !== undefined) {
          const fromRoot = posix.normalize(prefix);
          dir = scriptsOf(fromRoot) ? fromRoot : posix.normalize(posix.join(docDir, prefix));
        }
        const scripts = dir === null ? null : scriptsOf(dir);
        if (!scripts) {
          report(segment.line, `\`npm run ${script}\`: no package.json for ${prefix ?? doc}`);
        } else if (!Object.hasOwn(scripts, script)) {
          report(
            segment.line,
            `\`npm run ${script}\`: no such script in ${posix.join(dir, 'package.json')}`,
          );
        }
      }

      if (segment.kind !== 'span' || !isPathToken(segment.text, extensions)) continue;
      const token = segment.text;
      const bases = [...new Set(['.', docDir, appDir].filter((base) => base !== null))];
      const candidates = bases.map((base) => posix.join(base, token).replace(/\/$/, ''));
      if (candidates.some(exists)) continue;
      const allowed = allowMissing.find(
        (entry) =>
          (entry.docs === undefined || matchesAny(doc, entry.docs)) &&
          [token.replace(/\/$/, ''), ...candidates].some((candidate) =>
            matchesAny(candidate, entry.paths),
          ),
      );
      if (allowed) {
        allowed.used = true;
      } else {
        report(segment.line, `\`${token}\` does not exist`);
      }
    }
  }
  for (const [index, entry] of allowMissing.entries()) {
    if (!entry.used) {
      problems.push({
        file: 'config',
        line: 0,
        message: `allowMissing[${index}] (${entry.paths.join(', ')}) matches nothing: remove it`,
      });
    }
  }
  return problems;
}

function main(argv) {
  const configIndex = argv.indexOf('--config');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const configPath = configIndex >= 0 ? argv[configIndex + 1] : path.join(here, 'check-docs.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
  const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'})
    .split('\0')
    .filter(Boolean);
  const problems = checkDocs({
    tracked,
    read: (file) => readFileSync(path.join(root, file), 'utf8'),
    config,
  });
  const annotate = process.env.GITHUB_ACTIONS === 'true';
  // Workflow-command escaping, as the Actions toolkit does it.
  const escapeData = (value) =>
    String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  const escapeProperty = (value) => escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
  for (const {file, line, message} of problems) {
    console.error(
      annotate
        ? `::error file=${escapeProperty(file)},line=${line}::${escapeData(message)}`
        : `${file}:${line}: ${message}`,
    );
  }
  if (problems.length > 0) {
    console.error(`check-docs: ${problems.length} problem(s)`);
    process.exitCode = 1;
  } else {
    console.log('check-docs: living docs match the repository and their budgets');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
