import {useQuery} from '@tanstack/react-query';
import type {BankImportSummary} from '@tempo/contracts';
import {Columns3, FileX, RotateCw} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {FailedAt, describeFailure, failureKey} from '@/components/shared/load-failure';
import {PendingLabel} from '@/components/shared/pending-label';
import {StepFrame} from '@/components/shared/step-frame';
import {Alert, AlertAction, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {CountryStep} from '@/features/banking/components/picker-parts';
import {HttpError, NetworkError, wasToasted} from '@/utils/api';

import {useBankImportBanks} from '../api/use-bank-import-banks';
import {bankImportsQueryOptions} from '../api/use-bank-imports';
import {plural, summaryTitle} from '../utils/import-format';
import {OTHER_BANK, guessedBankChoice} from '../utils/layout-mapping';
import {PICKER_COUNTRY_OPTIONS, type PickedBankId} from '../utils/picked-bank';
import {type ImportFailure, accountQuestionKey} from '../utils/refusal-copy';
import {AccountQuestions} from './account-questions';
import {BankExportSteps, BankPicker} from './bank-picker';
import {DoubtfulRowsReview} from './doubtful-rows-review';
import {FileChoice, FileList} from './file-choice';
import {ImportSummaryBody} from './import-summary';
import {LayoutPreview} from './layout-preview';
import {BankRequestSentStep, TellUsYourBankStep} from './tell-us-your-bank';
import {
  ACCOUNT_QUESTION_TITLE,
  type FileImportController,
  IMPORT_FAILED_TITLE,
  type ImportStep,
} from './use-file-import';
import {useUndoImport} from './use-undo-import';

/**
 * Importing statement files, as steps of the Add data sheet: from picking the bank and choosing files to the summary,
 * the account question and the rows to check. `onBack` leads from the bank picker back to what the sheet offered
 * first.
 */
export function FileImportSteps({
  controller,
  onBack,
}: {
  controller: FileImportController;
  onBack?: () => void;
}) {
  const {step, setStep, setOpen, run, propose, bankId, pickBank, pickerCountry, setPickerCountry} =
    controller;
  // The list holds the latest of a shown import, such as its counts after rows were checked elsewhere.
  const {data: imports} = useQuery({
    ...bankImportsQueryOptions,
    enabled: false,
    select: (list) => list.imports,
  });
  const shown =
    'summary' in step
      ? (imports?.find((summary) => summary.id === step.summary.id) ?? step.summary)
      : null;

  // Kept files stay until they are settled or the sheet closes. Without them the bank can change; with no bank picked
  // (a page drop), a fresh choice goes back to what the sheet offered first.
  const noFiles = step.kind === 'choose' && step.files.length === 0;
  const fresh = noFiles && step.failure === null;
  const toPicker = () => setStep({kind: 'bank'});

  return step.kind === 'bank' ? (
    <Frame
      title='Which bank is the file from?'
      onBack={onBack}
      backLabel='Back to Add data'
      scroll={false}
      body={
        <BankPicker
          country={pickerCountry}
          onChangeCountry={() => setStep({kind: 'bankCountry'})}
          onPick={pickBank}
        />
      }
    />
  ) : step.kind === 'bankCountry' ? (
    <Frame
      title='Choose a country'
      onBack={toPicker}
      scroll={false}
      body={
        <div className='flex min-h-0 flex-col max-md:h-[min(68dvh,--spacing(128))] md:flex-1'>
          <CountryStep
            countries={PICKER_COUNTRY_OPTIONS}
            selected={pickerCountry}
            onSelect={(code) => {
              setPickerCountry(code);
              toPicker();
            }}
          />
        </div>
      }
    />
  ) : step.kind === 'choose' ? (
    <ChooseStep
      step={step}
      bankId={bankId}
      onBack={bankId ? (noFiles ? toPicker : undefined) : fresh ? onBack : undefined}
      onChangeBank={noFiles ? toPicker : undefined}
      onFiles={(files) => void run(files)}
      onMapColumns={(failure) => void propose(step.files, failure)}
      onTellUs={() => setStep({kind: 'tell', back: step})}
    />
  ) : step.kind === 'tell' ? (
    <TellUsYourBankStep
      bankId={bankId}
      onBack={() => setStep(step.back)}
      onSent={() => setStep({kind: 'told'})}
    />
  ) : step.kind === 'told' ? (
    <BankRequestSentStep onDone={() => setOpen(false)} />
  ) : step.kind === 'importing' ? (
    <Frame
      title='Import a file'
      body={<FileList files={step.files} />}
      footer={
        <Button disabled>
          <PendingLabel>Importing…</PendingLabel>
        </Button>
      }
    />
  ) : step.kind === 'proposing' ? (
    <Frame
      title='Import a file'
      body={
        <div className='grid grid-cols-1 gap-4'>
          {/* A flex row keeps the spinner on the text's line. */}
          <p role='status' className='flex items-center text-body-small text-muted-foreground'>
            <PendingLabel>Working out the columns…</PendingLabel>
          </p>
          <FileList files={[step.files[step.file - 1]]} />
        </div>
      }
      footer={
        <Button variant='outline' onClick={controller.cancelProposal}>
          Cancel
        </Button>
      }
    />
  ) : step.kind === 'preview' ? (
    <PreviewStep
      key={step.proposal.id}
      step={step}
      onConfirm={(request) => controller.confirmProposal(step, request)}
      onReject={() => controller.rejectProposal(step)}
    />
  ) : step.kind === 'question' ? (
    <QuestionStep
      key={step.questions.map(accountQuestionKey).join('|')}
      step={step}
      onCancel={() => setStep({kind: 'choose', files: [], failure: null})}
      onImport={(choices) => void run(step.files, choices)}
    />
  ) : step.kind === 'summary' ? (
    <SummaryStep summary={shown!} onStep={setStep} onClose={() => setOpen(false)} />
  ) : step.kind === 'review' ? (
    <Frame
      title={`Check ${plural(step.count, 'transaction')}`}
      onBack={() => setStep({kind: 'summary', summary: shown!})}
      body={
        <DoubtfulRowsReview
          summary={shown!}
          onSummary={(summary) => setStep({...step, summary})}
          onDone={(summary) => setStep({kind: 'summary', summary})}
        />
      }
    />
  ) : (
    <UndoStep
      summary={shown!}
      onCancel={() => setStep({kind: 'summary', summary: shown!})}
      onUndone={() => setOpen(false)}
    />
  );
}

/** One step of the import; the import specs read its body's scroll position by its test id. */
function Frame({backLabel = 'Back to the summary', ...props}: Parameters<typeof StepFrame>[0]) {
  return (
    <StepFrame
      testId='bank-import-dialog-body'
      srDescription='Statement files from your bank, imported into your accounts.'
      backLabel={backLabel}
      {...props}
    />
  );
}

function ChooseStep({
  step,
  bankId,
  onBack,
  onChangeBank,
  onFiles,
  onMapColumns,
  onTellUs,
}: {
  step: Extract<ImportStep, {kind: 'choose'}>;
  bankId: PickedBankId;
  onBack?: () => void;
  onChangeBank?: () => void;
  onFiles: (files: File[]) => void;
  onMapColumns: (
    failure: Extract<ImportStep, {kind: 'choose'}>['failure'] & {kind: 'refused'},
  ) => void;
  onTellUs: () => void;
}) {
  const {failure, files} = step;
  const mappable = failure?.kind === 'refused' && failure.mapFile !== null ? failure : null;
  const tellUs = failure?.kind === 'refused' && cannotReadLayout(failure);
  return (
    <Frame
      title='Import a file'
      onBack={onBack}
      backLabel={bankId ? 'Back to the banks' : 'Back to Add data'}
      body={
        <div className='grid grid-cols-1 gap-4'>
          {bankId && <BankExportSteps bankId={bankId} onChange={onChangeBank} />}
          {files.length > 0 && <FileList files={files} />}
          <FileChoice onFiles={onFiles} />
          {/* Why the last drop was not imported, at the end under Supported files. */}
          {failure && <FailureAlert failure={failure} onRetry={() => onFiles(files)} />}
        </div>
      }
      // Files kept after a lost connection or a busy bank go again as they are; a file in no layout Tempo knows
      // has its columns worked out first. A file Tempo cannot read at all offers to tell us the bank.
      footer={
        mappable && files.length > 0 ? (
          <Button onClick={() => onMapColumns(mappable)}>Work out the columns</Button>
        ) : files.length > 0 ? (
          <Button onClick={() => onFiles(files)}>Import</Button>
        ) : (
          tellUs && (
            <Button variant='outline' onClick={onTellUs}>
              Tell us your bank
            </Button>
          )
        )
      }
    />
  );
}

/**
 * A refusal that means Tempo cannot read the bank's layout: its columns could not be worked out, the owner said the
 * worked-out ones were not right, or they cannot be worked out on this deployment.
 */
const cannotReadLayout = (failure: Extract<ImportFailure, {kind: 'refused'}>) =>
  failure.code === 'layout_not_mappable' ||
  (failure.code === 'layout_unknown' && failure.mapFile === null);

/** Refusals that offer to work out a file's columns, rather than report a try at it that failed. */
const NO_BANKS: readonly string[] = [];

const offersColumns = (failure: Extract<ImportFailure, {kind: 'refused'}>) =>
  failure.mapFile !== null && failure.code !== 'mapper_unavailable';

/**
 * Why a drop or a try at working out its columns was not imported. A refusal says what to do next, which is the
 * footer's action when there is one; a failed request offers Try again.
 */
function FailureAlert({failure, onRetry}: {failure: ImportFailure; onRetry: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  // Below the chosen files the alert can start out of view; it is what the owner reads next. Only the body's own
  // scroller moves, never the page or a phone sheet still sliding in.
  useEffect(() => {
    const alert = ref.current;
    const viewport = alert?.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (!alert || !viewport) return;
    const [box, view] = [alert.getBoundingClientRect(), viewport.getBoundingClientRect()];
    // Its end into view, but never its start out of it.
    const by = Math.min(box.bottom - view.bottom, box.top - view.top);
    if (by > 0) viewport.scrollTop += by;
  }, [failure]);

  if (failure.kind === 'refused') {
    const offer = offersColumns(failure);
    const Icon = offer ? Columns3 : FileX;
    return (
      <Alert ref={ref} role='alert' variant={offer ? 'default' : 'destructive'}>
        <Icon aria-hidden='true' />
        <AlertTitle>{failure.title}</AlertTitle>
        <AlertDescription>{failure.description}</AlertDescription>
      </Alert>
    );
  }
  // A question is a step of its own; a failure the api wrapper toasted was already told.
  if (failure.kind === 'question' || failure.toasted) return null;
  const cause = describeFailure(failure.error);
  const Icon = cause.icon;
  return (
    <Alert ref={ref} role='alert' variant='destructive'>
      <Icon aria-hidden='true' />
      <AlertTitle>{cause.offline ? "You're offline" : IMPORT_FAILED_TITLE}</AlertTitle>
      <AlertDescription>
        {cause.description}
        {cause.code && (
          <span className='mt-1 block font-mono text-label break-all'>
            {cause.code} · <FailedAt key={failureKey(failure)} />
          </span>
        )}
      </AlertDescription>
      <AlertAction>
        <Button variant='outline' size='sm' onClick={onRetry}>
          <RotateCw aria-hidden='true' />
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

function PreviewStep({
  step,
  onConfirm,
  onReject,
}: {
  step: Extract<ImportStep, {kind: 'preview'}>;
  onConfirm: (request: {bankName: string; currency?: string}) => Promise<void>;
  onReject: () => void;
}) {
  const {proposal} = step;
  const [pending, setPending] = useState(false);
  // Read while the owner chooses; once confirming, the proposal is saved and its list is not read again.
  const bankList = useBankImportBanks(proposal.id, {enabled: !pending});
  const banks = bankList.data ?? NO_BANKS;
  // Until the owner picks, the choice follows Tempo's guess as the list of banks arrives.
  const [pickedBank, setPickedBank] = useState<string | null>(null);
  const bankChoice = pickedBank ?? guessedBankChoice(proposal.bankName, banks);
  const [otherBankName, setOtherBankName] = useState(proposal.bankName ?? '');
  // Nothing is chosen until the owner's banks have loaded.
  const bankName = !bankList.isSuccess
    ? ''
    : bankChoice === OTHER_BANK
      ? otherBankName
      : bankChoice;
  const [currency, setCurrency] = useState(proposal.defaultCurrency);
  // Why the API refused the name, such as a bank whose own files Tempo reads; cleared as the name changes.
  const [bankError, setBankError] = useState<string | null>(null);
  const name = bankName.trim();

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm({bankName: name, ...(proposal.currencyNeeded ? {currency} : {})});
    } catch (error) {
      setPending(false);
      if (wasToasted(error)) return;
      if (error instanceof HttpError && !(error instanceof NetworkError) && error.status === 400) {
        setBankError(error.message);
        return;
      }
      toast.error("Couldn't save this layout", {
        description: 'Try again in a moment.',
        id: 'bank-import-layout-confirm-failed',
      });
    }
  };

  return (
    <Frame
      title='Check the columns'
      description='These are the first and last transactions of your file, as Tempo would import them.'
      body={
        <LayoutPreview
          proposal={proposal}
          banks={
            bankList.isSuccess
              ? banks
              : bankList.isError
                ? {error: bankList.error, retry: bankList.refetch}
                : 'pending'
          }
          bankChoice={bankChoice}
          onBankChoice={(value) => {
            setPickedBank(value);
            setBankError(null);
          }}
          otherBankName={otherBankName}
          onOtherBankName={(value) => {
            setOtherBankName(value);
            setBankError(null);
          }}
          bankError={bankError}
          currency={currency}
          onCurrency={setCurrency}
          disabled={pending}
        />
      }
      footer={
        <>
          <Button
            variant='outline'
            onClick={onReject}
            disabled={pending}
            className='order-2 md:order-1'
          >
            Not right
          </Button>
          <Button
            disabled={pending || name.length === 0}
            onClick={() => void confirm()}
            className='order-1 md:order-2'
          >
            {pending ? <PendingLabel>Importing…</PendingLabel> : 'Looks right'}
          </Button>
        </>
      }
    />
  );
}

function QuestionStep({
  step,
  onCancel,
  onImport,
}: {
  step: Extract<ImportStep, {kind: 'question'}>;
  onCancel: () => void;
  onImport: (choices: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const complete = step.questions.every((question) => answers[accountQuestionKey(question)]);
  return (
    <Frame
      title={ACCOUNT_QUESTION_TITLE}
      body={
        <AccountQuestions
          code={step.code}
          questions={step.questions}
          answers={answers}
          onAnswer={(key, value) => setAnswers((current) => ({...current, [key]: value}))}
        />
      }
      footer={
        <>
          <Button variant='outline' onClick={onCancel} className='order-2 md:order-1'>
            Cancel
          </Button>
          <Button
            disabled={!complete}
            onClick={() => onImport(answers)}
            className='order-1 md:order-2'
          >
            Import
          </Button>
        </>
      }
    />
  );
}

function SummaryStep({
  summary,
  onStep,
  onClose,
}: {
  summary: BankImportSummary;
  onStep: (step: ImportStep) => void;
  onClose: () => void;
}) {
  const review = summary.rowsDoubtful > 0 && !summary.undoneAt;
  return (
    <Frame
      title={summaryTitle(summary)}
      body={<ImportSummaryBody summary={summary} />}
      footer={
        <>
          {!summary.undoneAt && (
            <Button
              variant='ghost'
              onClick={() => onStep({kind: 'undo', summary})}
              className='order-3 md:order-1 md:mr-auto md:-ml-4'
            >
              Undo import
            </Button>
          )}
          <Button
            variant={review ? 'outline' : 'default'}
            onClick={onClose}
            className='order-2 md:order-2'
          >
            Done
          </Button>
          {review && (
            <Button
              onClick={() => onStep({kind: 'review', summary, count: summary.rowsDoubtful})}
              className='order-1 md:order-3'
            >
              Review {plural(summary.rowsDoubtful, 'row')}
            </Button>
          )}
        </>
      }
    />
  );
}

function UndoStep({
  summary,
  onCancel,
  onUndone,
}: {
  summary: BankImportSummary;
  onCancel: () => void;
  onUndone: () => void;
}) {
  const {undo, describe, isPending} = useUndoImport();
  return (
    <Frame
      title='Undo this import?'
      description={describe(summary)}
      body={null}
      footer={
        <>
          <Button
            variant='outline'
            onClick={onCancel}
            disabled={isPending}
            className='order-2 md:order-1'
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            disabled={isPending}
            onClick={() => void undo(summary).then((undone) => undone && onUndone())}
            className='order-1 md:order-2'
          >
            {isPending ? <PendingLabel>Undoing…</PendingLabel> : 'Undo import'}
          </Button>
        </>
      }
    />
  );
}
