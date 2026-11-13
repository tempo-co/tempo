import type {
  BankImportAccountQuestion,
  BankImportErrorCode,
  BankImportSummary,
} from '@tempo/contracts';
import {useCallback, useRef, useState} from 'react';
import {toast} from 'sonner';

import {HttpError, NetworkError, SessionChangedError} from '@/utils/api';

import {useImportFiles} from '../api/use-import-files';
import {summaryTitle} from '../utils/import-format';
import {
  type ImportFailure,
  describeRefusal,
  refuseBySize,
  toBankImportError,
} from '../utils/refusal-copy';

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
  | {kind: 'summary'; summary: BankImportSummary}
  /** `count` is how many rows there were to check when the review opened; answered rows stay listed. */
  | {kind: 'review'; summary: BankImportSummary; count: number}
  | {kind: 'undo'; summary: BankImportSummary};

const FRESH: ImportStep = {kind: 'choose', files: [], failure: null};

export const ACCOUNT_QUESTION_TITLE = 'Which account is this?';
export const IMPORT_FAILED_TITLE = "Couldn't import these files";

function toFailure(error: unknown, files: readonly File[]): ImportFailure {
  if (error instanceof HttpError && !(error instanceof NetworkError)) {
    const refusal = toBankImportError(error.status, error.body);
    if (refusal)
      return describeRefusal(
        refusal,
        files.map((file) => file.name),
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

  const setOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
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
        // Files worth sending again stay chosen; a file the API refused is chosen again by the owner.
        const keep = failure.kind === 'failed' || failure.retry;
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
        const failure = toFailure(error, files);
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
    [importFiles, show],
  );

  /** The Import a file button: a fresh start, unless an import is still running. */
  const openNew = useCallback(() => {
    setStep((current) => (current.kind === 'importing' ? current : FRESH));
    setOpen(true);
  }, [setOpen]);

  /** Files dropped on the page start importing at once, unless an import is still running. */
  const importDropped = useCallback(
    (files: File[]) => {
      setOpen(true);
      if (step.kind !== 'importing') void run(files);
    },
    [run, setOpen, step.kind],
  );

  return {open, setOpen, step, setStep, show, run, openNew, importDropped};
}

export type FileImportController = ReturnType<typeof useFileImport>;
