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
  return (
    <Command>
      <CommandInput placeholder='Filter bank...' />
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
              <DynamicBankIcon bank={bank} className='w-4 mr-2' />
              {bank}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
