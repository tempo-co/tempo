import {isCancelledError, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  BankConnection,
  BankImportAccountQuestion,
  BankImportErrorCode,
  BankImportLayoutProposal,
  BankImportPreview,
  BankImportSummary,
  ConfirmBankImportLayoutProposalRequest,
} from '@tempo/contracts';
import {type SetStateAction, useCallback, useRef, useState} from 'react';
import {toast} from 'sonner';

import {useUpdateBankAccount} from '@/features/accounts/api/use-bank-account-settings';
import {bankConnectionsQueryOptions} from '@/features/banking/api/use-get-all-bank-connections';
import {accountName} from '@/features/banking/utils/bank-account-name';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {HttpError, NetworkError, SessionChangedError, wasToasted} from '@/utils/api';

import {bankImportsQueryOptions} from '../api/use-bank-imports';
import {useImportFiles} from '../api/use-import-files';
import {useConfirmLayout, useProposeLayout, useRejectLayout} from '../api/use-layout-proposals';
import {usePreviewFiles} from '../api/use-preview-files';
import {importedAccountIds, typedAlias} from '../utils/found-accounts';
import {summaryTitle} from '../utils/import-format';
import {type PickedBankId, likelyPickerCountry} from '../utils/picked-bank';
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
  /** Which bank the file is from, before choosing it. */
  | {kind: 'bank'}
  /** Another country for the bank picker. */
  | {kind: 'bankCountry'}
  | {kind: 'choose'; files: File[]; failure: ImportFailure | null}
  /** Reading the drop: which accounts it goes to, with nothing imported yet. */
  | {kind: 'reading'; files: File[]}
  /** "Check what we found": the accounts the drop goes to, before one Import imports it as previewed. */
  | {
      kind: 'found';
      files: File[];
      accountChoices?: Record<string, string>;
      /** The bank picked when it was read, which its import sends. */
      bankId: PickedBankId;
      preview: BankImportPreview;
      /** The names typed, kept when the import failed and can be tried again. */
      names?: readonly string[];
      /** Why the last try at importing it failed, when it can be tried again as it is. */
      failure?: ImportFailure;
    }
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
  | {kind: 'undo'; summary: BankImportSummary}
  /** "Tell us your bank" after a file Tempo cannot read; `back` is the refusal it came from. */
  | {kind: 'tell'; back: Extract<ImportStep, {kind: 'choose'}>}
  | {kind: 'told'};

/** A fresh start: the bank picker. */
const START: ImportStep = {kind: 'bank'};
/** Choosing files again, for the bank already picked. */
const FRESH: ImportStep = {kind: 'choose', files: [], failure: null};

/** Steps a drop on the page does not interrupt. */
export const BUSY: readonly ImportStep['kind'][] = ['reading', 'importing', 'proposing'];

/**
 * A step Import a file opens at again rather than starting fresh: an import still running, a refusal that kept its
 * files to try again, such as after closing the sheet while columns were worked out, or Check what we found after its
 * import failed.
 */
export const isUnsettled = (step: ImportStep) =>
  BUSY.includes(step.kind) ||
  (step.kind === 'choose' && step.failure !== null && step.files.length > 0) ||
  (step.kind === 'found' && step.failure !== undefined);

export const ACCOUNT_QUESTION_TITLE = 'Which account is this?';
export const FOUND_TITLE = 'Check what we found';
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
 * The import's state, owned by the shell so that an import keeps going when the Add data sheet closes; its outcome
 * then arrives as a toast. A drop is read first ("Check what we found") and imported on the owner's word. An opening
 * `startsFirstRun` says is one stays a first run until it closes (`firstRun`), and its import closes the sheet on its
 * own once Home has the accounts to show; otherwise the sheet never closes by itself. `onShow` hears every opening at
 * a step of the import (a toast's View, a drop), for a sheet that also shows other steps.
 */
export function useFileImport({
  onShow,
  startsFirstRun,
}: {onShow?: () => void; startsFirstRun?: () => boolean} = {}) {
  const queryClient = useQueryClient();
  const [open, setOpenState] = useState(false);
  const [step, setStepState] = useState<ImportStep>(START);
  // The step as last set, before React renders it, so a drop sees an import that has only just started.
  const stepRef = useRef<ImportStep>(START);
  const setStep = useCallback((next: SetStateAction<ImportStep>) => {
    stepRef.current = typeof next === 'function' ? next(stepRef.current) : next;
    setStepState(stepRef.current);
  }, []);
  const openRef = useRef(false);
  const [firstRun, setFirstRunState] = useState(false);
  const firstRunRef = useRef(false);
  // The picked bank goes with every upload and proposal of the drop; the ref is what a request in flight reads.
  const [bankId, setBankIdState] = useState<PickedBankId>(null);
  const bankRef = useRef<PickedBankId>(null);
  // The picker's country: the likely one until the owner chooses, which stays while the sheet closes and opens.
  const {currentAccount} = useCurrentAccount({skipFetch: true});
  const [chosenCountry, setPickerCountry] = useState<string | null>(null);
  const pickerCountry = chosenCountry ?? likelyPickerCountry(currentAccount?.timeZone);
  const setBankId = useCallback((next: PickedBankId) => {
    bankRef.current = next;
    setBankIdState(next);
  }, []);
  const {importFiles} = useImportFiles();
  const {previewFiles} = usePreviewFiles();
  const {updateBankAccount} = useUpdateBankAccount();
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

  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !openRef.current) {
        firstRunRef.current = startsFirstRun?.() ?? false;
        setFirstRunState(firstRunRef.current);
      }
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
    },
    [setStep, startsFirstRun],
  );

  const show = useCallback(
    (next: ImportStep) => {
      onShow?.();
      setStep(next);
      setOpen(true);
    },
    [onShow, setOpen, setStep],
  );

  /** A toast's action: its step, unless another drop is being read or imported, which the sheet then shows. */
  const reopen = useCallback(
    (next: ImportStep) =>
      BUSY.includes(stepRef.current.kind) ? show(stepRef.current) : show(next),
    [show],
  );

  const showFailure = useCallback(
    (failure: Exclude<ImportFailure, {kind: 'question'}>, files: File[]) => {
      // Files worth sending again, or whose columns can be worked out, stay chosen; for any other refused file
      // the owner chooses again.
      const keep = failure.kind === 'failed' || failure.retry || failure.mapFile !== null;
      setStep({kind: 'choose', files: keep ? files : [], failure});
      if (!openRef.current && !(failure.kind === 'failed' && failure.toasted))
        toast.error(failure.kind === 'refused' ? failure.title : IMPORT_FAILED_TITLE, {
          id: 'bank-import-failed',
        });
    },
    [setStep],
  );

  /** What the failed request of a drop means: a question to answer, or a refusal or failure shown on the files. */
  const showFailed = useCallback(
    (error: unknown, files: File[]) => {
      // A reply for a session this tab has left belongs to no one here.
      if (error instanceof SessionChangedError) {
        setBankId(null);
        return setStep(START);
      }
      const failure = toFailure(error, files, {mapper});
      if (failure.kind === 'question') {
        const question: ImportStep = {...failure, files};
        setStep(question);
        if (!openRef.current)
          toast.error(ACCOUNT_QUESTION_TITLE, {
            id: 'bank-import-question',
            action: {label: 'Choose', onClick: () => reopen(question)},
          });
        return;
      }
      showFailure(failure, files);
    },
    [mapper, reopen, setBankId, setStep, showFailure],
  );

  /** Check what we found again, under the bank it was read for. */
  const showFound = useCallback(
    (found: Extract<ImportStep, {kind: 'found'}>) => {
      if (BUSY.includes(stepRef.current.kind)) return show(stepRef.current);
      setBankId(found.bankId);
      show(found);
    },
    [setBankId, show],
  );

  /** Reads a drop without importing it, then shows what it found. */
  const run = useCallback(
    async (files: File[], accountChoices?: Record<string, string>) => {
      // A choice the API would refuse for its size is refused here, without uploading it.
      const tooLarge = refuseBySize(files);
      if (tooLarge) {
        const failure = describeRefusal(
          tooLarge,
          files.map((file) => file.name),
        );
        if (failure.kind === 'refused') return showFailure(failure, files);
      }
      setStep({kind: 'reading', files});
      try {
        const preview = await previewFiles({files, accountChoices, bankId: bankRef.current});
        const found = {
          kind: 'found',
          files,
          accountChoices,
          bankId: bankRef.current,
          preview,
        } satisfies ImportStep;
        setStep(found);
        if (!openRef.current)
          toast.info(FOUND_TITLE, {
            id: 'bank-import-found',
            action: {label: 'Check', onClick: () => showFound(found)},
          });
      } catch (error) {
        showFailed(error, files);
      }
    },
    [previewFiles, setStep, showFailed, showFailure, showFound],
  );

  /** The names typed in Check what we found, saved on the accounts the import wrote to; a failed one is told. */
  const nameAccounts = useCallback(
    async (found: BankImportPreview, names: readonly string[], summary: BankImportSummary) => {
      const accountIds = importedAccountIds(found.accounts, summary);
      const renames = found.accounts.flatMap((account, index) => {
        const alias = typedAlias(account, names[index] ?? '');
        const accountId = accountIds[index];
        return alias === undefined || !accountId ? [] : [{account, accountId, alias}];
      });
      if (renames.length === 0) return;
      let connections: BankConnection[] = [];
      try {
        connections = await queryClient.fetchQuery(bankConnectionsQueryOptions);
      } catch (error) {
        // A sign-out cancels the read, and its renames belong to no one here.
        if (isCancelledError(error) || error instanceof SessionChangedError) return;
        // Otherwise each rename below fails as an account it cannot find.
      }
      await Promise.all(
        renames.map(async ({account, accountId, alias}) => {
          const connection = connections.find(({bankAccounts}) =>
            bankAccounts.some(({id}) => id === accountId),
          );
          try {
            if (!connection) throw new Error('The account is not listed yet');
            await updateBankAccount({connectionId: connection.id, accountId, alias});
          } catch (error) {
            if (error instanceof SessionChangedError || wasToasted(error)) return;
            toast.error(`Couldn't rename ${accountName(account)}`, {
              description: 'The import is done. Rename the account on Accounts.',
              id: `bank-import-rename-${accountId}`,
            });
          }
        }),
      );
    },
    [queryClient, updateBankAccount],
  );

  /** Imports a drop as Check what we found showed it, naming its accounts as the owner typed. */
  const importFound = useCallback(
    async (found: Extract<ImportStep, {kind: 'found'}>, names: readonly string[]) => {
      const {files, accountChoices, bankId, preview} = found;
      setStep({kind: 'importing', files});
      try {
        const summary = await importFiles({files, accountChoices, bankId});
        await nameAccounts(preview, names, summary);
        // A first run closes on Home once it has the accounts to show; its summary stays a toast away.
        const firstRun = firstRunRef.current;
        if (firstRun)
          await queryClient.refetchQueries({queryKey: bankConnectionsQueryOptions.queryKey});
        setStep({kind: 'summary', summary});
        if (firstRun && openRef.current) setOpen(false);
        if (!openRef.current)
          toast.success(summaryTitle(summary), {
            id: `bank-import-${summary.id}`,
            action: {label: 'View', onClick: () => reopen({kind: 'summary', summary})},
          });
      } catch (error) {
        // A busy bank or a lost connection keeps Check what we found as the owner left it, to try again.
        const failure =
          error instanceof SessionChangedError ? null : toFailure(error, files, {mapper});
        if (failure?.kind === 'failed' || (failure?.kind === 'refused' && failure.retry)) {
          const kept = {...found, names, failure};
          setStep(kept);
          if (!openRef.current && !(failure.kind === 'failed' && failure.toasted))
            toast.error(failure.kind === 'refused' ? failure.title : IMPORT_FAILED_TITLE, {
              id: 'bank-import-failed',
              action: {label: 'Check', onClick: () => showFound(kept)},
            });
          return;
        }
        showFailed(error, files);
      }
    },
    [
      importFiles,
      mapper,
      nameAccounts,
      queryClient,
      reopen,
      setOpen,
      setStep,
      showFailed,
      showFound,
    ],
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
        const proposal = await proposeLayout({
          file: files[file - 1],
          bankId: bankRef.current,
          signal: controller.signal,
        });
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
    [mapper, proposeLayout, setStep],
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
  }, [setStep]);

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
    [confirmLayout, mapper, run, setStep],
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
    [rejectLayout, setStep],
  );

  /** The bank the file is from: its export steps and the file choice follow. */
  const pickBank = useCallback(
    (id: string) => {
      setBankId(id);
      setStep(FRESH);
    },
    [setBankId, setStep],
  );

  /** The Import a file button: a fresh start at the bank picker, unless the import is unsettled. */
  const openNew = useCallback(() => {
    if (!isUnsettled(stepRef.current)) {
      setBankId(null);
      setStep(START);
    }
    setOpen(true);
  }, [setBankId, setOpen, setStep]);

  /** Files dropped on the page start importing at once, unless an import is still running; no bank was picked. */
  const importDropped = useCallback(
    (files: File[]) => {
      onShow?.();
      setOpen(true);
      if (BUSY.includes(stepRef.current.kind)) return;
      setBankId(null);
      void run(files);
    },
    [onShow, run, setBankId, setOpen],
  );

  return {
    open,
    firstRun,
    setOpen,
    step,
    setStep,
    bankId,
    pickBank,
    pickerCountry,
    setPickerCountry,
    show,
    run,
    importFound,
    openNew,
    importDropped,
    propose,
    cancelProposal,
    confirmProposal,
    rejectProposal,
  };
}

export type FileImportController = ReturnType<typeof useFileImport>;
