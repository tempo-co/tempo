// Pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';

import {
  type DroppedEntry,
  FolderReadError,
  droppedFiles,
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
    'february.sta',
    'january.sta',
  ]);
});

test('an empty folder gives no files', async () => {
  expect(await filesInFolders([folder('empty', [])])).toEqual([]);
});

const failing: DroppedEntry = {
  isFile: true,
  isDirectory: false,
  name: 'unreadable.xml',
  file: (_resolve, reject) => reject(new Error('synthetic')),
};

/** A drop as the browser hands it over: each item gives its file and, for the walker, its entry. */
const transfer = (items: Array<{file: File | null; entry: DroppedEntry | null}>) =>
  ({
    items: items.map(({file: itemFile, entry}) => ({
      kind: 'file',
      getAsFile: () => itemFile,
      webkitGetAsEntry: () => entry,
    })),
    files: items.flatMap(({file: itemFile}) => (itemFile ? [itemFile] : [])),
  }) as unknown as DataTransfer;

test("a drop of files and a folder gives the files and the folder's files", async () => {
  const plain = new File(['synthetic'], 'loose.csv');
  const files = await droppedFiles(
    transfer([
      {file: plain, entry: file('loose.csv')},
      {file: null, entry: folder('statements', [file('march.xml')])},
    ]),
  );
  expect(files.map(({name}) => name)).toEqual(['loose.csv', 'march.xml']);
});

test('a folder that cannot be read fails the whole drop, its plain files included', async () => {
  const plain = new File(['synthetic'], 'loose.csv');
  await expect(
    droppedFiles(
      transfer([
        {file: plain, entry: file('loose.csv')},
        {file: null, entry: folder('statements', [failing])},
      ]),
    ),
  ).rejects.toBeInstanceOf(FolderReadError);
});

test('a drop without readable entries, as a test makes one, gives its files', async () => {
  const plain = new File(['synthetic'], 'loose.csv');
  expect(await droppedFiles(transfer([{file: plain, entry: null}]))).toEqual([plain]);
  expect(await droppedFiles({items: [], files: [plain]} as unknown as DataTransfer)).toEqual([
    plain,
  ]);
});

test('a folder with more entries than can be looked through is refused', async () => {
  const many = Array.from({length: 2001}, (_, index) => folder(`empty-${index}`, []));
  await expect(filesInFolders([folder('huge', many)])).rejects.toBeInstanceOf(FolderReadError);
});
