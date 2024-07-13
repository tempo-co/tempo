import {useMemo} from 'react';

import {DynamicBankIcon} from '@/components/shared/dynamic-bank-icon';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Bank} from '@/types/bank';

type BankListProps = {
  setOpen: (open: boolean) => void;
  setSelectedBank: (bank: Bank | null) => void;
};

export function BankList({setOpen, setSelectedBank}: BankListProps) {
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
              onSelect={() => {
                setSelectedBank(bank);
                setOpen(false);
              }}
            >
              <div className='p-[0.35rem] bg-muted mr-2 rounded-md'>
                <DynamicBankIcon bank={bank} className='w-4 fill-foreground' />
              </div>
              {bank}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
