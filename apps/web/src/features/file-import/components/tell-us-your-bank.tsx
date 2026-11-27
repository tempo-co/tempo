import {
  BANK_REQUEST_FILE_TYPES,
  BANK_REQUEST_MAX_NAME_LENGTH,
  type BankRequestFileType,
  bankNameSpelling,
} from '@tempo/contracts';
import {CircleCheck, CloudOff} from 'lucide-react';
import {useId, useState} from 'react';

import {PendingLabel} from '@/components/shared/pending-label';
import {StateMessage} from '@/components/shared/state-message';
import {StepFrame} from '@/components/shared/step-frame';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {wasToasted} from '@/utils/api';
import {browserRegion} from '@/utils/countries';

import {useBankRequest} from '../api/use-bank-request';
import {BANK_REQUEST_FILE_TYPE_LABELS} from '../utils/bank-request';
import {
  PICKER_COUNTRY_OPTIONS,
  type PickedBankId,
  isPickerCountry,
  pickedBank,
} from '../utils/picked-bank';

export const TELL_US_TITLE = 'Tell us your bank';

/**
 * The form's first values: the picked bank's name and country when the owner picked a listed bank, else no name and
 * the browser's region when the form lists it.
 */
function firstDraft(bankId: PickedBankId) {
  const bank = pickedBank(bankId);
  const country =
    bank?.country && isPickerCountry(bank.country) ? bank.country : browserRegion(isPickerCountry);
  return {
    bankName: bank?.name ?? '',
    country: country ?? '',
    fileTypes: [] as BankRequestFileType[],
  };
}

/**
 * "Tell us your bank", after a file Tempo cannot read: the bank's name, its country and the files it lets the owner
 * download. Nothing of the file goes with it, and the copy says no reply follows.
 */
export function TellUsYourBankStep({
  bankId,
  onBack,
  onSent,
}: {
  bankId: PickedBankId;
  /** Back to the refusal it came from. */
  onBack: () => void;
  onSent: () => void;
}) {
  const formId = useId();
  const ids = {name: useId(), country: useId(), files: useId()};
  const [draft, setDraft] = useState(() => firstDraft(bankId));
  const {sendBankRequest, isPending} = useBankRequest();
  // A failed send the api wrapper did not already report; the form stays filled for Send again.
  const [failed, setFailed] = useState(false);
  const bankName = bankNameSpelling(draft.bankName);
  const complete = bankName.length > 0 && draft.country.length > 0 && draft.fileTypes.length > 0;

  const send = async () => {
    setFailed(false);
    try {
      await sendBankRequest({bankName, country: draft.country, fileTypes: draft.fileTypes});
      onSent();
    } catch (error) {
      if (!wasToasted(error)) setFailed(true);
    }
  };

  return (
    <StepFrame
      testId='bank-import-dialog-body'
      title={TELL_US_TITLE}
      description="This bank's files can't be read yet. Tell us which bank it is: we use this to decide which banks to add next."
      onBack={isPending ? undefined : onBack}
      backLabel='Back to the file'
      body={
        <form
          id={formId}
          className='grid grid-cols-1 gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            if (complete && !isPending) void send();
          }}
        >
          <div className='grid gap-1.5'>
            <Label htmlFor={ids.name}>Bank name</Label>
            <Input
              id={ids.name}
              value={draft.bankName}
              maxLength={BANK_REQUEST_MAX_NAME_LENGTH}
              autoComplete='off'
              disabled={isPending}
              className='max-sm:h-11'
              onChange={(event) => setDraft({...draft, bankName: event.target.value})}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor={ids.country}>Country</Label>
            <Select
              value={draft.country}
              onValueChange={(country) => setDraft({...draft, country})}
              disabled={isPending}
            >
              <SelectTrigger id={ids.country} className='max-sm:h-11'>
                <SelectValue placeholder='Choose a country' />
              </SelectTrigger>
              <SelectContent>
                {PICKER_COUNTRY_OPTIONS.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <span id={ids.files} className='text-label'>
              Files it lets you download
            </span>
            <ToggleGroup
              type='multiple'
              variant='outline'
              size='sm'
              role='group'
              aria-labelledby={ids.files}
              disabled={isPending}
              value={draft.fileTypes}
              // Kept in the list's own order, whatever order they were pressed in.
              onValueChange={(values) =>
                setDraft({
                  ...draft,
                  fileTypes: BANK_REQUEST_FILE_TYPES.filter((type) => values.includes(type)),
                })
              }
              className='flex-wrap justify-start gap-2'
            >
              {BANK_REQUEST_FILE_TYPES.map((type) => (
                <ToggleGroupItem
                  key={type}
                  value={type}
                  className='data-[state=on]:bg-secondary max-sm:h-11 pointer-coarse:h-11'
                >
                  {BANK_REQUEST_FILE_TYPE_LABELS[type]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className='text-body-small text-muted-foreground'>
            Your file isn&apos;t sent, and we don&apos;t reply to these.
          </p>
          {failed && (
            <Alert role='alert' variant='destructive'>
              <CloudOff aria-hidden='true' />
              <AlertTitle>Couldn&apos;t send this</AlertTitle>
              <AlertDescription>Try again in a moment.</AlertDescription>
            </Alert>
          )}
        </form>
      }
      footer={
        <>
          <Button
            variant='outline'
            onClick={onBack}
            disabled={isPending}
            className='order-2 md:order-1'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            form={formId}
            disabled={isPending || !complete}
            className='order-1 md:order-2'
          >
            {isPending ? <PendingLabel>Sending…</PendingLabel> : 'Send'}
          </Button>
        </>
      }
    />
  );
}

/** The sent state: thanks, and plainly no reply. */
export function BankRequestSentStep({onDone}: {onDone: () => void}) {
  return (
    <StepFrame
      testId='bank-import-dialog-body'
      title={TELL_US_TITLE}
      srDescription='Your request was sent.'
      body={
        <div role='status'>
          <StateMessage
            size='section'
            icon={CircleCheck}
            title='Sent'
            description="Thanks. We read every request, but we don't reply."
          />
        </div>
      }
      footer={<Button onClick={onDone}>Done</Button>}
    />
  );
}
