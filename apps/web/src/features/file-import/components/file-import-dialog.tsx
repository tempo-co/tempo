import {useQuery} from '@tanstack/react-query';
import type {BankImportSummary} from '@tempo/contracts';
import {ArrowLeft, Columns3, FileX, RotateCw} from 'lucide-react';
import {type ReactNode, type RefObject, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {describeFailure, failedAtLabel} from '@/components/shared/load-failure';
import {PendingLabel} from '@/components/shared/pending-label';
import {Alert, AlertAction, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogCornerClose,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {ScrollArea} from '@/components/ui/scroll-area';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {HttpError, NetworkError, wasToasted} from '@/utils/api';
import {cn} from '@/utils/cn';

import {bankImportsQueryOptions} from '../api/use-bank-imports';
import {plural, summaryTitle} from '../utils/import-format';
import {type ImportFailure, accountQuestionKey} from '../utils/refusal-copy';
import {AccountQuestions} from './account-questions';
import {DoubtfulRowsReview} from './doubtful-rows-review';
import {FileChoice, FileList} from './file-choice';
import {ImportSummaryBody} from './import-summary';
import {LayoutPreview} from './layout-preview';
import {
  ACCOUNT_QUESTION_TITLE,
  type FileImportController,
  IMPORT_FAILED_TITLE,
  type ImportStep,
} from './use-file-import';
import {useUndoImport} from './use-undo-import';

const FOOTER =
  'flex shrink-0 flex-col gap-2 border-t px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:flex-row md:items-center md:justify-end md:px-6 md:pb-4';

/**
 * Importing statement files, in one dialog (a bottom sheet on phones) from choosing files to the summary, the
 * account question and the rows to check. Closing it never cancels an import.
 */
export function FileImportDialog({
  controller,
  returnFocus,
}: {
  controller: FileImportController;
  /** The Import a file button: focus goes back there whichever way the dialog was opened. */
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const {open, setOpen, step, setStep, run, propose} = controller;
  const isMobile = useIsMobile();
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

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogContent
        data-testid='bank-import-dialog'
        className='flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 md:max-h-[86dvh] md:max-w-lg [&>button:last-child]:hidden'
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current?.isConnected) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        {/* Centred on the title's row; a phone sheet closes by its handle like the others. */}
        {!isMobile && <ResponsiveDialogCornerClose label='Close' />}
        {step.kind === 'choose' ? (
          <ChooseStep
            step={step}
            onFiles={(files) => void run(files)}
            onMapColumns={(failure) => void propose(step.files, failure)}
          />
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
                <p role='status' className='flex items-center text-sm text-muted-foreground'>
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
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** One step of the dialog: its header, a body that scrolls on its own, and a footer that stays in reach. */
function Frame({
  title,
  description,
  onBack,
  body,
  footer,
}: {
  title: string;
  /** Shown under the title; without it, assistive technology still hears what the dialog is for. */
  description?: string;
  onBack?: () => void;
  body: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <ResponsiveDialogHeader className='shrink-0 grid-cols-[minmax(0,1fr)] px-4 pt-3 pb-4 text-start md:px-6'>
        <div className='flex min-h-11 items-center gap-1 md:pr-10'>
          {onBack && (
            <Button
              variant='ghost'
              size='icon'
              aria-label='Back to the summary'
              className='-ml-2 size-11'
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
          )}
          <ResponsiveDialogTitle className='min-w-0 wrap-anywhere'>{title}</ResponsiveDialogTitle>
        </div>
        <ResponsiveDialogDescription className={description ? 'pt-1' : 'sr-only'}>
          {description ?? 'Statement files from your bank, imported into your accounts.'}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {body && (
        <ScrollArea
          type='auto'
          data-testid='bank-import-dialog-body'
          className='grid min-h-0 grid-rows-[minmax(0,1fr)] [&_[data-radix-scroll-area-viewport]>div]:block! [&>[data-radix-scroll-area-viewport]]:min-h-0 [&>[data-radix-scroll-area-viewport]]:overscroll-contain'
        >
          {/* Without a footer, the body keeps clear of a phone's home indicator itself. */}
          <div
            className={cn(
              'px-4 md:px-6 md:pb-6',
              footer ? 'pb-4' : 'pb-[calc(1rem+env(safe-area-inset-bottom))]',
            )}
          >
            {body}
          </div>
        </ScrollArea>
      )}
      {footer && <div className={FOOTER}>{footer}</div>}
    </>
  );
}

function ChooseStep({
  step,
  onFiles,
  onMapColumns,
}: {
  step: Extract<ImportStep, {kind: 'choose'}>;
  onFiles: (files: File[]) => void;
  onMapColumns: (
    failure: Extract<ImportStep, {kind: 'choose'}>['failure'] & {kind: 'refused'},
  ) => void;
}) {
  const {failure, files} = step;
  const mappable = failure?.kind === 'refused' && failure.mapFile !== null ? failure : null;
  return (
    <Frame
      title='Import a file'
      body={
        <div className='grid grid-cols-1 gap-4'>
          {files.length > 0 && <FileList files={files} />}
          <FileChoice onFiles={onFiles} />
          {/* Why the last drop was not imported, at the end under Supported files. */}
          {failure && <FailureAlert failure={failure} onRetry={() => onFiles(files)} />}
        </div>
      }
      // Files kept after a lost connection or a busy bank go again as they are; a file in no layout Tempo knows
      // has its columns worked out first.
      footer={
        mappable && files.length > 0 ? (
          <Button onClick={() => onMapColumns(mappable)}>Work out the columns</Button>
        ) : (
          files.length > 0 && <Button onClick={() => onFiles(files)}>Import</Button>
        )
      }
    />
  );
}

/** Refusals that offer to work out a file's columns, rather than report a try at it that failed. */
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
  const [failedAt, setFailedAt] = useState(() => Date.now());
  useEffect(() => setFailedAt(Date.now()), [failure]);

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
            {`${cause.code} · ${failedAtLabel(failedAt)}`}
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
  const [bankName, setBankName] = useState(proposal.bankName ?? '');
  const [currency, setCurrency] = useState(proposal.defaultCurrency);
  const [pending, setPending] = useState(false);
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
        description: 'Please try again in a moment.',
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
          bankName={bankName}
          bankError={bankError}
          onBankName={(value) => {
            setBankName(value);
            setBankError(null);
          }}
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
