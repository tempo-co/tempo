import {CheckIcon, ClipboardIcon} from 'lucide-react';
import * as React from 'react';

import {cn} from '@/utils/cn';

import {Button} from '../ui/button';

type CopyToClipboardButton = {
  value: string;
};

export function CopyToClipboardButton({value}: CopyToClipboardButton) {
  const [hasCopied, setHasCopied] = React.useState(false);

  React.useEffect(() => {
    setTimeout(() => {
      setHasCopied(false);
    }, 2000);
  }, [hasCopied]);

  const handleCopyToClipboard = (value: string) => {
    void navigator.clipboard.writeText(value);
    setHasCopied(true);
  };

  return (
    <Button
      size='icon'
      variant='outline'
      className={cn(
        'relative z-10 h-6 w-6 text-foreground hover:bg-accent [&_svg]:h-3 [&_svg]:w-3',
      )}
      onClick={() => {
        handleCopyToClipboard(value);
      }}
    >
      <span className='sr-only'>Copy</span>
      {hasCopied ? <CheckIcon className='text-success' /> : <ClipboardIcon />}
    </Button>
  );
}
