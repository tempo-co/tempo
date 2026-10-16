export const EMAIL_QUEUE = 'email';
export const SEND_EMAIL_JOB = 'send-email-job';

export const BANK_TRANSACTION_CATEGORIZATION_QUEUE = 'bank-transaction-categorization';
export const CATEGORIZE_BANK_TRANSACTIONS_JOB = 'categorize-bank-transactions';
export const BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE = 50;
export const APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB = 'apply-manual-category-to-merchant';
export const RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB = 'reconcile-bank-transaction-categorization';
export const BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID = 'bank-transaction-categorization-reconciler';

export const BANK_CONNECTION_SYNC_QUEUE = 'bank-connection-sync';
export const DISPATCH_BANK_CONNECTION_SYNCS_JOB = 'dispatch-bank-connection-syncs';
export const SYNC_BANK_CONNECTION_JOB = 'sync-bank-connection';
export const BANK_CONNECTION_SYNC_SCHEDULER_ID = 'bank-connection-sync-dispatcher';

export const BANK_CONNECTION_ALERT_QUEUE = 'bank-connection-alerts';
export const SCAN_BANK_CONNECTION_ALERTS_JOB = 'scan-bank-connection-alerts';
export const BANK_CONNECTION_ALERT_SCHEDULER_ID = 'bank-connection-alert-scanner';

export const BANK_TRANSACTION_AMOUNT_CONVERSION_QUEUE = 'bank-transaction-amount-conversion';
export const BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB = 'backfill-bank-transaction-amounts';
export const BANK_TRANSACTION_AMOUNT_CONVERSION_JOB = 'convert-bank-transaction-amounts';
export const BANK_TRANSACTION_AMOUNT_CONVERSION_SCHEDULER_ID = 'bank-transaction-amount-conversion-scheduler';
