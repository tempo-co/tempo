import {FileUp} from 'lucide-react';
import {useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {cn} from '@/utils/cn';

import {droppedFiles} from '../utils/dropped-files';
import {fileNameTail, formatFileSize} from '../utils/import-format';
import {dragHasFiles, useCanDropFiles} from './drop-files';
import {SupportedFiles} from './supported-files';

/** The 36px Clay tile the import surfaces lead with. */
export const IMPORT_TILE =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-transaction-tile-edge bg-transaction-tile-field text-transaction-tile-ink [&_svg]:size-4';

/**
 * Choosing statement files: a drop area with a Choose files button on desktop, the button alone on phones and
 * touch screens. Any file can be chosen, since banks name their exports with odd extensions.
 */
export function FileChoice({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const canDrop = useCanDropFiles();
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every child, so the area counts how deep the drag is.
  const depth = useRef(0);

  const chooseButton = (
    <Button
      type='button'
      variant='outline'
      disabled={disabled}
      onClick={() => input.current?.click()}
      className={cn(!canDrop && 'w-full')}
    >
      Choose files
    </Button>
  );

  return (
    <div className='grid grid-cols-1 gap-3'>
      <input
        ref={input}
        type='file'
        multiple
        hidden
        data-testid='bank-import-file-input'
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so choosing the same file again still counts as a choice.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      {canDrop ? (
        <div
          data-testid='bank-import-drop-area'
          data-over={over || undefined}
          onDragEnter={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            depth.current += 1;
            setOver(true);
          }}
          onDragOver={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setOver(false);
          }}
          onDrop={(event) => {
            if (!dragHasFiles(event)) return;
            event.preventDefault();
            depth.current = 0;
            setOver(false);
            if (disabled) return;
            void droppedFiles(event.dataTransfer).then((files) => {
              if (files.length > 0) onFiles(files);
            });
          }}
          className={cn(
            'grid min-h-40 place-content-center justify-items-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors',
            over && 'border-ring bg-accent',
          )}
        >
          <span aria-hidden='true' className={IMPORT_TILE}>
            <FileUp strokeWidth={2} />
          </span>
          <p className='text-sm font-medium'>Drop statement files here</p>
          <p className='text-sm text-muted-foreground'>or</p>
          {chooseButton}
        </div>
      ) : (
        chooseButton
      )}
      <div className='flex flex-wrap items-center justify-between gap-x-3'>
        <p className='text-sm text-pretty text-muted-foreground'>
          Statement files from your bank, several at once or in a zip.
        </p>
        <SupportedFiles />
      </div>
    </div>
  );
}

/** The chosen files: each name cut short in the middle, so the endings that tell them apart stay, and its size. */
export function FileList({files}: {files: readonly File[]}) {
  return (
    <ul aria-label='Chosen files' className='divide-y rounded-md border'>
      {files.map((file, index) => {
        const {head, tail} = fileNameTail(file.name);
        return (
          <li
            key={`${index}:${file.name}`}
            className='flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm'
          >
            <span title={file.name} className='flex min-w-0'>
              <span className='truncate'>{head}</span>
              <span className='shrink-0 whitespace-pre'>{tail}</span>
            </span>
            <span className='shrink-0 numeric text-xs text-muted-foreground'>
              {formatFileSize(file.size)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
