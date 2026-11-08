import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddPushNotifications20261108120000 implements MigrationInterface {
	name = 'AddPushNotifications20261108120000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('accounts'))) return;
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "push_subscriptions" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"endpoint" varchar(2048) NOT NULL,
			"p256dh" varchar(128) NOT NULL,
			"auth" varchar(64) NOT NULL,
			"sessionId" varchar(128) NOT NULL,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			"updatedAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_push_subscriptions" PRIMARY KEY ("id"),
			CONSTRAINT "fk_push_subscriptions_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_subscriptions_endpoint" ON "push_subscriptions" ("endpoint")',
		);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_account" ON "push_subscriptions" ("accountId")',
		);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_session" ON "push_subscriptions" ("sessionId")',
		);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "push_preferences" (
			"accountId" uuid NOT NULL,
			"bankConnections" boolean NOT NULL DEFAULT true,
			"recurringBills" boolean NOT NULL DEFAULT true,
			CONSTRAINT "pk_push_preferences" PRIMARY KEY ("accountId"),
			CONSTRAINT "fk_push_preferences_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "recurring_bill_alerts" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"seriesKey" varchar(32) NOT NULL,
			"flag" varchar(32) NOT NULL,
			"period" date NOT NULL,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_recurring_bill_alerts" PRIMARY KEY ("id"),
			CONSTRAINT "uq_recurring_bill_alerts_period" UNIQUE ("accountId", "seriesKey", "flag", "period"),
			CONSTRAINT "fk_recurring_bill_alerts_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE IF EXISTS "recurring_bill_alerts"');
		await queryRunner.query('DROP TABLE IF EXISTS "push_preferences"');
		await queryRunner.query('DROP TABLE IF EXISTS "push_subscriptions"');
	}
}
