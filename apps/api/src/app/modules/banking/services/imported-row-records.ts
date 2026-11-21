import {Injectable} from '@nestjs/common';
import type {EntityManager} from 'typeorm';

import type {Account} from '@modules/account/account.entity';

import type {BankAccount} from '../bank-account.entity';
import type {BankConnection} from '../bank-connection.entity';
import type {BankTransaction} from '../bank-transaction.entity';
import type {OwnerEdits} from './bank-transaction-persistence.service';

/** An imported row sync could not settle alone, and the synced rows it may be. */
export type ImportedRowQuestion = {imported: BankTransaction; candidateIds: string[]};

/** An imported row sync removed from a day it is final for, with the owner's edits it had. */
export type RemovedImportedRow = {row: BankTransaction; ownerEdits: OwnerEdits | null};

/** A closing balance a statement stated for an account: the signed decimal as of the end of `date`. */
export type StatementClosingBalance = {date: string; amount: string};

/**
 * What file import records about the rows it added (its import records, doubtful and never-sent rows), kept true by
 * banking's writes. File import implements it and registers it (`ImportedRowRecordsRegistry`); every call runs in the
 * caller's transaction, through `manager`.
 */
export interface ImportedRowRecords {
	/** Of these imported rows, the ones an owner's answer keeps: a resolution `new` points at them. */
	findKeptByOwner(manager: EntityManager, transactionIds: readonly string[]): Promise<Set<string>>;
	/** Sync took these imported rows of the account over: their open questions go. */
	recordTakenOver(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
		transactionIds: readonly string[],
	): Promise<void>;
	/**
	 * Asks the owner about each imported row on its own import, or adds the candidates to the row's open question.
	 * Returns how many rows were newly asked about.
	 */
	askAbout(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
		questions: readonly ImportedRowQuestion[],
	): Promise<number>;
	/**
	 * Sync is about to delete these imported rows of the account: each is kept on its import as removed by sync, with
	 * its edits, its open questions go and answered ones stop pointing at it.
	 */
	recordRemovedBySync(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
		removed: readonly RemovedImportedRow[],
	): Promise<void>;
	/** The newest closing balance an import not undone recorded for the account, the newest import's on a tie. */
	findNewestClosingBalance(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
	): Promise<StatementClosingBalance | null>;
	/** The accounts with a closing balance recorded by an import under the owner's connection. */
	findAccountsWithClosingBalances(
		manager: EntityManager,
		ownerId: Account['id'],
		connectionId: BankConnection['id'],
	): Promise<BankAccount['id'][]>;
	/** The owner's imports under one connection move to another, as the accounts they wrote to did. */
	moveToConnection(
		manager: EntityManager,
		ownerId: Account['id'],
		from: BankConnection['id'],
		to: BankConnection['id'],
	): Promise<void>;
}

/** Holds the registered `ImportedRowRecords`, so banking keeps file import's records true without depending on it. */
@Injectable()
export class ImportedRowRecordsRegistry {
	private registered: ImportedRowRecords | null = null;

	register(records: ImportedRowRecords): void {
		this.registered = records;
	}

	get records(): ImportedRowRecords {
		if (!this.registered) throw new Error('No imported row records are registered.');
		return this.registered;
	}
}
