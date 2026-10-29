import {Check, Copy} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';

type CopyFieldProps = {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
  /** Shown when the clipboard refuses the write. */
  errorMessage: string;
};

/** A read-only value with a Copy button inside the field's border; focusing the field selects it. */
export function CopyField({id, label, value, copyLabel, errorMessage}: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyError(false);
      // Confirm briefly, then return to the action so it never looks stuck.
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>{label}</Label>
      <div className='flex h-11 border bg-background max-sm:h-12'>
        <input
          id={id}
          readOnly
          value={value}
          spellCheck={false}
          autoComplete='off'
          onFocus={(event) => event.currentTarget.select()}
          className='min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ellipsis text-foreground outline-none selection:bg-primary selection:text-primary-foreground'
        />
        <Button
          variant='ghost'
          onClick={() => void copy()}
          className='h-full shrink-0 border-l px-3'
        >
          {copied ? (
            <Check className='size-4 text-success' aria-hidden='true' />
          ) : (
            <Copy className='size-4' aria-hidden='true' />
          )}
          {copied ? 'Copied' : copyLabel}
        </Button>
      </div>
      {copyError && (
        <p role='alert' className='text-sm text-destructive'>
          {errorMessage}
        </p>
      )}
    </div>
  );
}
