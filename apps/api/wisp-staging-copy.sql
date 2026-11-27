-- Cuts a restored production database down to one account: the owner-only copy staging restores.
--
--   SELECT set_config('staging_copy.owner_account_id', '<account uuid>', false);  -- then run this file
--
-- Every table needs a rule, and a table without one fails the run before anything changes:
--   owned   a row belongs to one account; `keep` is true for the owner's rows
--   shared  no account owns the row; `keep` is true for rows the owner's rows use
--   global  reference data no account owns, kept whole
-- After deleting every row whose `keep` is not true, the run checks that exactly the owner's account remains and that
-- no owned or shared row fails its rule. Any failure raises, and the whole run rolls back. In `keep`, `t` is the row
-- and `$1` the owner's account id. Rules run in order, so a rule may rely on tables cut before it.
DO $staging_copy$
DECLARE
    owner_id uuid := nullif(current_setting('staging_copy.owner_account_id', true), '')::uuid;
    rule record;
    unruled text;
    left_over bigint;
BEGIN
    IF owner_id IS NULL THEN
        RAISE EXCEPTION 'staging_copy.owner_account_id is not set';
    END IF;

    CREATE TEMP TABLE staging_copy_rules (
        position serial,
        table_name text PRIMARY KEY,
        kind text NOT NULL CHECK (kind IN ('owned', 'shared', 'global')),
        keep text CHECK ((kind = 'global') = (keep IS NULL))
    ) ON COMMIT DROP;
    INSERT INTO staging_copy_rules (table_name, kind, keep) VALUES
        ('accounts', 'owned', 't."id" = $1'),
        ('personal_access_tokens', 'owned', 't."accountId" = $1'),
        ('push_preferences', 'owned', 't."accountId" = $1'),
        ('push_subscriptions', 'owned', 't."accountId" = $1'),
        ('recurring_continuation_unlinks', 'owned', 't."accountId" = $1'),
        ('recurring_series_hides', 'owned', 't."accountId" = $1'),
        ('recurring_snapshots', 'owned', 't."accountId" = $1'),
        ('bank_import_layouts', 'owned', 't."accountId" = $1'),
        ('bank_import_layout_proposals', 'owned', 't."accountId" = $1'),
        ('bank_import_layout_misses', 'owned', 't."accountId" = $1'),
        ('bank_requests', 'owned', 't."accountId" = $1'),
        ('merchants', 'owned', 't."accountId" = $1'),
        ('bank_connections', 'owned', 't."accountId" = $1'),
        ('bank_sync_runs', 'owned',
            'EXISTS (SELECT 1 FROM bank_connections c WHERE c."id" = t."bankConnectionId" AND c."accountId" = $1)'),
        ('bank_accounts', 'owned',
            'EXISTS (SELECT 1 FROM bank_connections c WHERE c."id" = t."bankConnectionId" AND c."accountId" = $1)'),
        ('bank_account_balances', 'owned',
            'EXISTS (SELECT 1 FROM bank_accounts a JOIN bank_connections c ON c."id" = a."bankConnectionId"
                WHERE a."id" = t."bankAccountId" AND c."accountId" = $1)'),
        ('bank_imports', 'owned',
            't."accountId" = $1 AND EXISTS (SELECT 1 FROM bank_connections c WHERE c."id" = t."bankConnectionId" AND c."accountId" = $1)'),
        ('bank_transactions', 'owned',
            'EXISTS (SELECT 1 FROM bank_accounts a JOIN bank_connections c ON c."id" = a."bankConnectionId"
                WHERE a."id" = t."bankAccountId" AND c."accountId" = $1)'),
        ('bank_import_doubtful_rows', 'owned',
            'EXISTS (SELECT 1 FROM bank_imports i WHERE i."id" = t."importId" AND i."accountId" = $1)
                AND EXISTS (SELECT 1 FROM bank_accounts a JOIN bank_connections c ON c."id" = a."bankConnectionId"
                    WHERE a."id" = t."bankAccountId" AND c."accountId" = $1)'),
        -- Written by triggers on bank_transactions, so it is cut after them.
        ('bank_history_changes', 'owned', 't."accountId" = $1'),
        ('merchant_logos', 'shared', 'EXISTS (SELECT 1 FROM merchants m WHERE m."logoId" = t."id")'),
        ('bank_transaction_fx_rates', 'global', NULL),
        ('migrations', 'global', NULL),
        ('typeorm_metadata', 'global', NULL);

    SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO unruled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'm', 'f')
        AND NOT c.relispartition
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND n.nspname NOT LIKE 'pg_temp_%'
        AND n.nspname NOT LIKE 'pg_toast_temp_%'
        AND NOT (n.nspname = 'public' AND c.relname IN (SELECT table_name FROM staging_copy_rules));
    IF unruled IS NOT NULL THEN
        RAISE EXCEPTION 'no staging copy rule for: %', unruled;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE "id" = owner_id) THEN
        RAISE EXCEPTION 'owner account % not found', owner_id;
    END IF;

    -- A rule may name a table the restored schema does not have yet (the backup can predate the running API's migrations).
    FOR rule IN
        SELECT r.* FROM staging_copy_rules r
        WHERE r.kind <> 'global' AND to_regclass(format('public.%I', r.table_name)) IS NOT NULL
        ORDER BY r.position
    LOOP
        EXECUTE format('DELETE FROM public.%I t WHERE (%s) IS NOT TRUE', rule.table_name, rule.keep) USING owner_id;
    END LOOP;

    IF (SELECT count(*) FROM accounts) <> 1 OR NOT EXISTS (SELECT 1 FROM accounts WHERE "id" = owner_id) THEN
        RAISE EXCEPTION 'the copy does not hold exactly the owner account';
    END IF;
    FOR rule IN
        SELECT r.* FROM staging_copy_rules r
        WHERE r.kind <> 'global' AND to_regclass(format('public.%I', r.table_name)) IS NOT NULL
        ORDER BY r.position
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I t WHERE (%s) IS NOT TRUE', rule.table_name, rule.keep)
        INTO left_over USING owner_id;
        IF left_over <> 0 THEN
            RAISE EXCEPTION '% rows of % fail their staging copy rule', left_over, rule.table_name;
        END IF;
    END LOOP;
END
$staging_copy$;
