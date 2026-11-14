import {useQuery} from '@tanstack/react-query';
import type {
  BankImportAccountQuestion,
  BankImportErrorCode,
  BankImportLayoutProposal,
  BankImportSummary,
  ConfirmBankImportLayoutProposalRequest,
} from '@tempo/contracts';
import {useCallback, useRef, useState} from 'react';
import {toast} from 'sonner';

import {HttpError, NetworkError, SessionChangedError} from '@/utils/api';

import {bankImportsQueryOptions} from '../api/use-bank-imports';
import {useImportFiles} from '../api/use-import-files';
import {useConfirmLayout, useProposeLayout, useRejectLayout} from '../api/use-layout-proposals';
import {summaryTitle} from '../utils/import-format';
import {
  type ImportFailure,
  LAYOUT_DISCARDED_COPY,
  describeRefusal,
  refuseBySize,
  toBankImportError,
} from '../utils/refusal-copy';

type Refused = Extract<ImportFailure, {kind: 'refused'}>;

/** Where the import dialog is. The files stay in memory until a drop is imported or other files are chosen. */
export type ImportStep =
  | {kind: 'choose'; files: File[]; failure: ImportFailure | null}
  | {kind: 'importing'; files: File[]}
  | {
      kind: 'question';
      files: File[];
      code: BankImportErrorCode;
      questions: BankImportAccountQuestion[];
    }
  /** Working out the columns of `file` (1-based) of the kept drop; Cancel goes back to `failure`. */
  | {kind: 'proposing'; files: File[]; file: number; failure: Refused}
  /** The owner checks the proposal against their own rows before it is saved. */
  | {
      kind: 'preview';
      files: File[];
      file: number;
      failure: Refused;
      proposal: BankImportLayoutProposal;
    }
  | {kind: 'summary'; summary: BankImportSummary}
  /** `count` is how many rows there were to check when the review opened; answered rows stay listed. */
  | {kind: 'review'; summary: BankImportSummary; count: number}
  | {kind: 'undo'; summary: BankImportSummary};

const FRESH: ImportStep = {kind: 'choose', files: [], failure: null};

/** Steps a drop on the page does not interrupt. */
export const BUSY: readonly ImportStep['kind'][] = ['importing', 'proposing'];

export const ACCOUNT_QUESTION_TITLE = 'Which account is this?';
export const IMPORT_FAILED_TITLE = "Couldn't import these files";

function toFailure(
  error: unknown,
  files: readonly File[],
  options: {mapper: boolean; file?: number},
): ImportFailure {
  if (error instanceof HttpError && !(error instanceof NetworkError)) {
    const refusal = toBankImportError(error.status, error.body);
    if (refusal)
      return describeRefusal(
        // A proposal's refusals name the one file it was sent; the drop names it by its position.
        options.file === undefined ? refusal : {...refusal, file: options.file},
        files.map((file) => file.name),
        options,
      );
  }
  return {kind: 'failed', error, toasted: error instanceof HttpError && error.toasted};
}

/**
 * The import dialog's state, owned by the page so that an import keeps going when the dialog closes; its outcome
 * then arrives as a toast. The dialog never closes on its own.
 */
export function useFileImport() {
  const [open, setOpenState] = useState(false);
  const [step, setStep] = useState<ImportStep>(FRESH);
  const openRef = useRef(false);
  const {importFiles} = useImportFiles();
  const {proposeLayout} = useProposeLayout();
  const {confirmLayout} = useConfirmLayout();
  const {rejectLayout} = useRejectLayout();
  const {data: mapper = false} = useQuery({
    ...bankImportsQueryOptions,
    enabled: false,
    select: (list) => list.mapper,
  });
  // The wait for a proposal, which Cancel or closing the dialog ends.
  const proposing = useRef<AbortController | null>(null);

  const setOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
    // Closing the dialog stops waiting for columns; the files stay chosen.
    if (!next && proposing.current) {
      proposing.current.abort();
      proposing.current = null;
      setStep((current) =>
        current.kind === 'proposing'
          ? {kind: 'choose', files: current.files, failure: current.failure}
          : current,
      );
    }
  }, []);

  const show = useCallback(
    (next: ImportStep) => {
      setStep(next);
      setOpen(true);
    },
    [setOpen],
  );

  const run = useCallback(
    async (files: File[], accountChoices?: Record<string, string>) => {
      const showFailure = (failure: Exclude<ImportFailure, {kind: 'question'}>) => {
        // Files worth sending again, or whose columns can be worked out, stay chosen; for any other refused file
        // the owner chooses again.
        const keep = failure.kind === 'failed' || failure.retry || failure.mapFile !== null;
        setStep({kind: 'choose', files: keep ? files : [], failure});
        if (!openRef.current && !(failure.kind === 'failed' && failure.toasted))
          toast.error(failure.kind === 'refused' ? failure.title : IMPORT_FAILED_TITLE, {
            id: 'bank-import-failed',
          });
      };
      // A choice the API would refuse for its size is refused here, without uploading it.
      const tooLarge = refuseBySize(files);
      if (tooLarge) {
        const failure = describeRefusal(
          tooLarge,
          files.map((file) => file.name),
        );
        if (failure.kind === 'refused') return showFailure(failure);
      }
      setStep({kind: 'importing', files});
      try {
        const summary = await importFiles({files, accountChoices});
        setStep({kind: 'summary', summary});
        if (!openRef.current)
          toast.success(summaryTitle(summary), {
            id: `bank-import-${summary.id}`,
            action: {label: 'View', onClick: () => show({kind: 'summary', summary})},
          });
      } catch (error) {
        // A reply for a session this tab has left belongs to no one here.
        if (error instanceof SessionChangedError) return setStep(FRESH);
        const failure = toFailure(error, files, {mapper});
        if (failure.kind === 'question') {
          const question: ImportStep = {...failure, files};
          setStep(question);
          if (!openRef.current)
            toast.error(ACCOUNT_QUESTION_TITLE, {
              id: 'bank-import-question',
              action: {label: 'Choose', onClick: () => show(question)},
            });
          return;
        }
        showFailure(failure);
      }
    },
    [importFiles, mapper, show],
  );

  /** Works out the columns of the refused file `failure` offers, then previews them. */
  const propose = useCallback(
    async (files: File[], failure: Refused) => {
      const file = failure.mapFile;
      if (file === null) return;
      const controller = new AbortController();
      proposing.current = controller;
      setStep({kind: 'proposing', files, file, failure});
      try {
        const proposal = await proposeLayout({file: files[file - 1], signal: controller.signal});
        if (controller.signal.aborted) return;
        setStep({kind: 'preview', files, file, failure, proposal});
      } catch (error) {
        if (controller.signal.aborted || error instanceof SessionChangedError) return;
        const next = toFailure(error, files, {mapper, file});
        if (next.kind === 'question') return;
        // A refused proposal keeps the files only when trying again could help, as after a failed try.
        const keep = next.kind === 'failed' || next.mapFile !== null;
        setStep({kind: 'choose', files: keep ? files : [], failure: next});
      } finally {
        if (proposing.current === controller) proposing.current = null;
      }
    },
    [mapper, proposeLayout],
  );

  /** Stops waiting for a proposal: back to the refusal, with the files still chosen. */
  const cancelProposal = useCallback(() => {
    proposing.current?.abort();
    proposing.current = null;
    setStep((current) =>
      current.kind === 'proposing'
        ? {kind: 'choose', files: current.files, failure: current.failure}
        : current,
    );
  }, []);

  /**
   * Saves the previewed layout, then sends the same drop again: it now reads like any known layout. A refusal of
   * the confirmation goes back to choosing; any other failure is thrown for the preview to report.
   */
  const confirmProposal = useCallback(
    async (
      step: Extract<ImportStep, {kind: 'preview'}>,
      request: ConfirmBankImportLayoutProposalRequest,
    ) => {
      try {
        await confirmLayout({proposalId: step.proposal.id, ...request});
      } catch (error) {
        const failure = toFailure(error, step.files, {mapper, file: step.file});
        if (failure.kind !== 'refused') throw error;
        setStep({kind: 'choose', files: failure.mapFile !== null ? step.files : [], failure});
        return;
      }
      await run(step.files);
    },
    [confirmLayout, mapper, run],
  );

  /** Not right: the proposal is discarded and nothing is imported. */
  const rejectProposal = useCallback(
    (step: Extract<ImportStep, {kind: 'preview'}>) => {
      // The proposal expires on its own within the hour, so a failed discard changes nothing for the owner.
      void rejectLayout(step.proposal.id).catch(() => undefined);
      setStep({
        kind: 'choose',
        files: [],
        failure: {
          kind: 'refused',
          code: 'layout_unknown',
          ...LAYOUT_DISCARDED_COPY,
          retry: false,
          mapFile: null,
        },
      });
    },
    [rejectLayout],
  );

  /**
   * The Import a file button: a fresh start, unless an import is still running or a refusal kept its files to try
   * again, such as after closing the dialog while columns were worked out.
   */
  const openNew = useCallback(() => {
    setStep((current) =>
      BUSY.includes(current.kind) ||
      (current.kind === 'choose' && current.failure !== null && current.files.length > 0)
        ? current
        : FRESH,
    );
    setOpen(true);
  }, [setOpen]);

  /** Files dropped on the page start importing at once, unless an import is still running. */
  const importDropped = useCallback(
    (files: File[]) => {
      setOpen(true);
      if (!BUSY.includes(step.kind)) void run(files);
    },
    [run, setOpen, step.kind],
  );

  return {
    open,
    setOpen,
    step,
    setStep,
    show,
    run,
    openNew,
    importDropped,
    propose,
    cancelProposal,
    confirmProposal,
    rejectProposal,
  };
}

export type FileImportController = ReturnType<typeof useFileImport>;
