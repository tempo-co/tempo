// The import controller's contract for drops on the page: no page, so this uses Playwright's own `test`.
import {expect, test} from '@playwright/test';

import {createHookHarness} from '../utils/hook-harness';

type Controller = {importDropped: (files: File[]) => void};

test('two drops before the page renders read one of them, the first', () => {
  const reads: string[][] = [];
  class HttpError extends Error {}
  const {renderHook} = createHookHarness({
    '@/utils/api': {
      api: {get: () => new Promise(() => undefined)},
      HttpError,
      NetworkError: class extends HttpError {},
      SessionChangedError: class extends Error {},
      isAuthError: () => false,
    },
    '../api/use-import-files': {
      useImportFiles: () => ({importFiles: () => new Promise(() => undefined)}),
    },
    '../api/use-preview-files': {
      usePreviewFiles: () => ({
        previewFiles: ({files}: {files: File[]}) => {
          reads.push(files.map(({name}) => name));
          return new Promise(() => undefined);
        },
      }),
    },
    '../api/use-layout-proposals': {
      useProposeLayout: () => ({proposeLayout: () => new Promise(() => undefined)}),
      useConfirmLayout: () => ({confirmLayout: () => new Promise(() => undefined)}),
      useRejectLayout: () => ({rejectLayout: () => new Promise(() => undefined)}),
    },
    sonner: {toast: {success: () => undefined, error: () => undefined}},
  });
  const controller = renderHook<Controller>(
    'src/features/file-import/components/use-file-import.ts',
    'useFileImport',
  );

  // Both drops arrive before the page shows the first one's import.
  controller.importDropped([new File(['synthetic'], 'first.xml')]);
  controller.importDropped([new File(['synthetic'], 'second.xml')]);

  expect(reads).toEqual([['first.xml']]);
});
