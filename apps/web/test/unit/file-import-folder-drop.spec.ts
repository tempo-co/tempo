// Pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';

import {
  type DroppedEntry,
  filesInFolders,
} from '../../src/features/file-import/utils/dropped-files';

const file = (name: string): DroppedEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (resolve) => resolve(new File(['synthetic'], name)),
});

/** A folder whose reader hands its entries out two at a time, as browsers batch them. */
const folder = (name: string, children: DroppedEntry[]): DroppedEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let read = 0;
    return {
      readEntries: (resolve) => {
        resolve(children.slice(read, read + 2));
        read += 2;
      },
    };
  },
});

test('a dropped folder gives the files inside it, at any depth, without hidden files', async () => {
  const files = await filesInFolders([
    folder('statements', [
      file('march.xml'),
      file('.DS_Store'),
      folder('older', [file('january.sta'), file('february.sta')]),
      file('april.xml'),
      folder('.cache', [file('hidden.csv')]),
    ]),
  ]);
  expect(files.map(({name}) => name)).toEqual([
    'april.xml',
    'march.xml',
    'january.sta',
    'february.sta',
  ]);
});

test('an empty folder gives no files', async () => {
  expect(await filesInFolders([folder('empty', [])])).toEqual([]);
});
