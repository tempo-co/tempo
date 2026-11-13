import {Injectable, OnModuleInit} from '@nestjs/common';
import {DataSource, MigrationInterface} from 'typeorm';

import {AddBankHistoryChanges20261113170000} from './migrations/20261113170000-add-bank-history-changes';

/**
 * Migrations that install what synchronize cannot create from entities (tables without an entity, functions and
 * triggers). Each must be safe to run again: a synchronized schema runs them after every synchronize.
 */
export const SCHEMA_EXTRA_MIGRATIONS: ReadonlyArray<new () => MigrationInterface> = [
	AddBankHistoryChanges20261113170000,
];

/** Installs the schema extras; call it after every `synchronize`. */
export async function installSchemaExtras(dataSource: DataSource): Promise<void> {
	const queryRunner = dataSource.createQueryRunner();
	try {
		for (const Migration of SCHEMA_EXTRA_MIGRATIONS) await new Migration().up(queryRunner);
	} finally {
		await queryRunner.release();
	}
}

/** Gives a schema synchronized at boot (tests, development) the functions and triggers production's migrations install. */
@Injectable()
export class SynchronizedSchemaExtras implements OnModuleInit {
	constructor(private readonly dataSource: DataSource) {}

	async onModuleInit(): Promise<void> {
		if (this.dataSource.options.synchronize) await installSchemaExtras(this.dataSource);
	}
}
