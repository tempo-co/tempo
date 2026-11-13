/** The parts of the browser's file system entries that reading a dropped folder needs. */
export type DroppedEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (resolve: (file: File) => void, reject: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      resolve: (entries: DroppedEntry[]) => void,
      reject: (error: unknown) => void,
    ) => void;
  };
};

/** More files than any drop may hold, so a huge folder stops being read early; the import refuses the rest. */
const MAX_FOLDER_FILES = 200;
/** Entries looked at before a folder counts as too big to read, however few of them are files. */
const MAX_FOLDER_ENTRIES = 2000;

/** A dropped folder that could not be read, or holds too much to look through. */
export class FolderReadError extends Error {
  constructor() {
    super('The dropped folder could not be read.');
    this.name = 'FolderReadError';
  }
}

/** Tells the owner a dropped folder was not read; the drop imports nothing. */
export function folderNotRead(notify: (title: string, options: {description: string}) => void) {
  notify("Couldn't read that folder", {
    description: 'Nothing was imported. Choose the files inside it instead.',
  });
}

/**
 * The files inside dropped folders, at any depth, in name order. A folder itself is not a file: uploading it fails
 * as if the connection were lost. Hidden files (a leading dot) are left out.
 */
export async function filesInFolders(folders: readonly DroppedEntry[]): Promise<File[]> {
  const files: File[] = [];
  let seen = 0;
  const visit = async (entry: DroppedEntry): Promise<void> => {
    if (files.length >= MAX_FOLDER_FILES || entry.name.startsWith('.')) return;
    seen += 1;
    if (seen > MAX_FOLDER_ENTRIES) throw new FolderReadError();
    if (entry.isFile && entry.file) {
      files.push(await new Promise<File>((resolve, reject) => entry.file!(resolve, reject)));
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      const children: DroppedEntry[] = [];
      // A reader hands out its entries in batches and ends with an empty one.
      for (;;) {
        const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        children.push(...batch);
      }
      children.sort((first, second) => first.name.localeCompare(second.name));
      for (const child of children) await visit(child);
    }
  };
  for (const folder of folders) await visit(folder);
  return files;
}

/**
 * The files of a drop, with each dropped folder replaced by the files inside it. The drop's items are only readable
 * while its event is being handled, so they are collected before the first await. A drop is all or nothing: when a
 * folder cannot be read the promise rejects with `FolderReadError` and no file of the drop is given.
 */
export function droppedFiles(dataTransfer: DataTransfer | null): Promise<File[]> {
  if (!dataTransfer) return Promise.resolve([]);
  const plain: File[] = [];
  const folders: DroppedEntry[] = [];
  const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === 'file');
  if (items.length === 0) return Promise.resolve(Array.from(dataTransfer.files));
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.() as DroppedEntry | null | undefined;
    if (entry?.isDirectory) folders.push(entry);
    else {
      const file = item.getAsFile();
      if (file) plain.push(file);
    }
  }
  if (folders.length === 0) return Promise.resolve(plain);
  return filesInFolders(folders).then(
    (inside) => [...plain, ...inside],
    () => {
      throw new FolderReadError();
    },
  );
}
