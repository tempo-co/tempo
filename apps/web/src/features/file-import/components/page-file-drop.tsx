import {FileUp} from 'lucide-react';
import {type Ref, useEffect, useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {cn} from '@/utils/cn';

import {dragHasFiles, useCanDropFiles} from './drop-files';
import {IMPORT_TILE} from './file-choice';

/** The page's Import a file button: an outline button beside Connect a bank. */
export function ImportFileButton({
  ref,
  onClick,
  className,
}: {
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      ref={ref}
      variant='outline'
      onClick={onClick}
      data-testid='import-file-button'
      className={cn(
        'max-md:h-auto max-md:min-h-11 max-md:max-w-full max-md:whitespace-normal',
        className,
      )}
    >
      <FileUp />
      Import a file
    </Button>
  );
}

/**
 * Files dragged anywhere over the page: while `enabled` (a fine pointer, the import dialog closed) an overlay
 * covers the page column and a drop imports them. A drop that misses never opens the file in the tab instead.
 */
export function PageFileDrop({
  enabled,
  onFiles,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const canDrop = useCanDropFiles();
  const active = enabled && canDrop;
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const latestOnFiles = useRef(onFiles);
  useEffect(() => {
    latestOnFiles.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setDragging(false);
    };
    const onEnter = (event: DragEvent) => {
      if (!active || !dragHasFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!active || !dragHasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = active ? 'copy' : 'none';
    };
    const onDrop = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      reset();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (active && files.length > 0) latestOnFiles.current(files);
    };
    if (!active) reset();
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [active]);

  if (!dragging) return null;
  return (
    <div
      data-testid='bank-import-page-drop'
      className='pointer-events-none absolute inset-0 z-30 rounded-card border-2 border-dashed border-ring bg-background/95'
    >
      <div className='sticky top-1/3 grid justify-items-center gap-3 py-16 text-center'>
        <span aria-hidden='true' className={IMPORT_TILE}>
          <FileUp strokeWidth={2} />
        </span>
        <p className='text-sm font-medium'>Drop to import</p>
      </div>
    </div>
  );
}
