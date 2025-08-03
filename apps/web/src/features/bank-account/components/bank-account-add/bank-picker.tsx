import {VisuallyHidden} from '@radix-ui/react-visually-hidden';
import {ChevronDown} from 'lucide-react';
import {useState} from 'react';

import {BankIcon} from '@/components/shared/bank-icon';
import {Button} from '@/components/ui/button';
import {DrawerTitle} from '@/components/ui/drawer';
import {
  ResponsivePicker,
  ResponsivePickerContent,
  ResponsivePickerTrigger,
} from '@/components/ui/responsive-picker';
import {Bank} from '@/types/bank';
import {cn} from '@/utils/cn';

import {BankList} from './bank-list';

type BankPickerProps = {
  onChange: (bank: Bank) => void;
  isPending?: boolean;
  error?: boolean;
};

export function BankPicker({onChange, isPending, error}: BankPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);

  const handleSetSelectedBank = (bank: Bank | null) => {
    setSelectedBank(bank);
    if (bank) {
      onChange(bank);
    }
    setOpen(false);
  };

  return (
    <ResponsivePicker open={open} onOpenChange={setOpen}>
      <VisuallyHidden>
        <DrawerTitle>Select a bank</DrawerTitle>
      </VisuallyHidden>
      <ResponsivePickerTrigger asChild>
        <Button
          variant='outline'
          disabled={isPending}
          className={cn('justify-start px-3', error && 'border-destructive')}
        >
          <div className='flex w-full items-center justify-between'>
            {selectedBank ? (
              <div className='flex items-center'>
                <div className='mr-3 hidden rounded-md bg-muted p-[0.35rem] md:flex'>
                  <BankIcon bank={selectedBank} className='w-4' />
                </div>
                <BankIcon bank={selectedBank} className='mr-2 block w-4 md:hidden' />
                <p>{selectedBank}</p>
              </div>
            ) : (
              <p className='text-muted-foreground'>Select a bank</p>
            )}
            <ChevronDown className='ml-2 hidden h-4 w-4 shrink-0 text-muted-foreground md:block' />
          </div>
        </Button>
      </ResponsivePickerTrigger>
      <ResponsivePickerContent className='w-[--radix-popover-trigger-width] p-0' align='start'>
        <div className='mt-4 border-t md:mt-0 md:border-t-0'>
          <BankList
            setSelectedBank={handleSetSelectedBank}
            selectedBank={selectedBank}
            setOpen={setOpen}
          />
        </div>
      </ResponsivePickerContent>
    </ResponsivePicker>
  );
}
