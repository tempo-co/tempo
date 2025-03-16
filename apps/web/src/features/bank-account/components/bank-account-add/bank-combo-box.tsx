import {VisuallyHidden} from '@radix-ui/react-visually-hidden';
import {ChevronDown} from 'lucide-react';
import {useState} from 'react';

import {DynamicBankIcon} from '@/components/shared/dynamic-bank-icon';
import {Button} from '@/components/ui/button';
import {Drawer, DrawerContent, DrawerTitle, DrawerTrigger} from '@/components/ui/drawer';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useMediaQuery} from '@/hooks/use-media-query';
import {Bank} from '@/types/bank';
import {cn} from '@/utils/cn';

import {BankList} from './bank-list';

type BankComboBoxProps = {
  onChange: (bank: Bank) => void;
  isPending?: boolean;
  error?: boolean;
};

export function BankComboBox({onChange, isPending, error}: BankComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const handleSetSelectedBank = (bank: Bank | null) => {
    setSelectedBank(bank);
    if (bank) {
      onChange(bank);
    }
  };

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            disabled={isPending}
            className={cn('justify-start px-3', error && 'border-destructive')}
          >
            <div className='flex w-full items-center justify-between'>
              {selectedBank ? (
                <div className='flex items-center'>
                  <div className='mr-2 rounded-md bg-muted p-[0.35rem]'>
                    <DynamicBankIcon bank={selectedBank} className='w-4' />
                  </div>
                  <p>{selectedBank}</p>
                </div>
              ) : (
                <p>Select a bank</p>
              )}
              <ChevronDown className='h-4 w-4 text-muted-foreground' />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[--radix-popover-trigger-width] p-0' align='start'>
          <BankList setOpen={setOpen} setSelectedBank={handleSetSelectedBank} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <VisuallyHidden>
        <DrawerTitle>Select a bank</DrawerTitle>
      </VisuallyHidden>
      <DrawerTrigger asChild>
        <Button variant='outline' disabled={isPending} className='justify-start'>
          {selectedBank ? (
            <>
              <DynamicBankIcon bank={selectedBank} className='mr-2 w-4' />
              {selectedBank}
            </>
          ) : (
            <>Select a bank</>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className='mt-4 border-t'>
          <BankList setOpen={setOpen} setSelectedBank={handleSetSelectedBank} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
