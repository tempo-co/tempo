import * as reactQuery from '@tanstack/react-query';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {runInThisContext} from 'node:vm';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import ts from 'typescript';

type ModuleExports = Record<string, unknown>;

/**
 * Runs real `src` hooks against a real QueryClient with chosen modules (usually `@/utils/api`)
 * replaced, for cache behavior the public API cannot seed.
 */
export function createHookHarness(stubs: Record<string, unknown>) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
  const require = createRequire(resolve('package.json'));
  const modules = new Map<string, {exports: ModuleExports}>();

  function load(path: string): ModuleExports {
    const filename = resolve(path);
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    const module = {exports: {}};
    modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    const localRequire = (name: string): unknown => {
      if (name in stubs) return stubs[name];
      if (name === '@tanstack/react-query') return reactQuery;
      if (name.startsWith('@/')) return load(resolve('src', `${name.slice(2)}.ts`));
      if (name.startsWith('.')) return load(resolve(filename, '..', `${name}.ts`));
      return require(name);
    };
    const execute = runInThisContext(`(function(require, module, exports) {${code}\n})`, {
      filename,
    }) as (
      require: typeof localRequire,
      module: {exports: ModuleExports},
      exports: ModuleExports,
    ) => void;
    execute(localRequire, module, module.exports);
    return module.exports;
  }

  /** Renders the hook once inside the client's provider and returns its result. */
  function renderHook<T>(path: string, exportName: string): T {
    let result: T;
    const useHook = load(path)[exportName] as () => T;
    function Harness() {
      result = useHook();
      return null;
    }
    renderToString(createElement(QueryClientProvider, {client}, createElement(Harness)));
    return result!;
  }

  return {client, renderHook};
}
