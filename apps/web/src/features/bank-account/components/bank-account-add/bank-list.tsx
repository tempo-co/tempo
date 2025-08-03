import {Check} from 'lucide-react';
import {useMemo} from 'react';

import {BankIcon} from '@/components/shared/bank-icon';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Bank} from '@/types/bank';
import {cn} from '@/utils/cn';

type BankListProps = {
  setOpen: (open: boolean) => void;
  setSelectedBank: (bank: Bank | null) => void;
  selectedBank: Bank | null;
};

export function BankList({setOpen, setSelectedBank, selectedBank}: BankListProps) {
  const placeholder = useMemo(() => `Search ${Object.values(Bank).length} supported banks...`, []);

  return (
    <Command>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>No supported banks found.</CommandEmpty>
        <CommandGroup>
          {Object.values(Bank).map((bank) => (
            <CommandItem
              key={bank}
              value={bank}
              className='flex items-center justify-between'
              onSelect={() => {
                setSelectedBank(bank);
                setOpen(false);
              }}
            >
              <div className='flex items-center'>
                <div className='mr-3 rounded-md bg-muted p-[0.35rem]'>
                  <BankIcon bank={bank} className='w-4' />
                </div>
                {bank}
              </div>
              <Check
                className={cn('ml-2 h-4 w-4', selectedBank === bank ? 'opacity-100' : 'opacity-0')}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
