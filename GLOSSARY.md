# Tempo

Tempo shows people their spending and income across the bank accounts they connect or import.

## Language

**Account-history writer**:
The one way a write to an owner's transaction history (a sync, an import, a doubtful or never-sent row, an undo) starts: it takes the write's locks in one fixed order before any row is touched. Inside it, recording a bank fetch for an account, or adding file rows to an account, runs that account's steps in one fixed order too.
_Avoid_: import transaction, sync transaction, lock helper

**Bank identity**:
The bank an account is held at, as Tempo records it: the institution name of its connection, of the bank a statement format belongs to or of the bank an owner named for a layout, or a BIC a statement states. A name never equals a BIC. A currency exchange happens inside one bank, so exchanges among imported files pair only within one bank identity. It never names an account: a statement giving an id that is no IBAN another bank than its account records is refused. An account made from files takes its bank from the first drop giving one (the strongest evidence of that drop) and keeps it while it has rows; it goes only with the account.
_Avoid_: institution key, bank code

**Data coverage**:
The days an owner's data has come in for, per shown account (a hidden one covers nothing): from its first transaction (or the earlier day its sync recorded covering) through its own last covered day, the newest day its sync fetched transactions for or its newest imported statement runs to. Only gaps something recorded are left out: missing entries between two imported statements (until the bank's sync covers those days), and the days before a reconnect's sync took over. A gap nothing records counts as covered. The newest covered day across accounts is the **last covered day**; a day after it is not in yet, which is not the same as a day with no spending.
_Avoid_: freshness, sync range, data gap

**Derived-data refresh**:
Bringing the values Tempo computes from an owner's transaction history (reporting currency, currency exchanges, own transfers, categories, merchant logos) up to date after a write to that history.
_Avoid_: post-sync hook, follow-up steps, after-write steps

**Hidden account**:
An account the owner hid: it leaves the account lists and the balance total, its transactions count in no total (as if each were left out of totals), and it shows under Hidden on Accounts, where it can be shown again. Its transactions stay in the list, marked, and its balance stays on the account. Removing an account deletes it instead, and only an imported-files account can be removed on its own.
_Avoid_: archived, closed, inactive

**Leave out of totals**:
An owner's choice that one of their transactions counts in no total (spending, income, merchants, recurring payments, the AI assistant's reads), as own transfers and currency exchanges never do; the transaction stays in their list, marked as left out, and in their balances, because the money did move. Putting it back counts it again.
_Avoid_: exclude, hide, ignore

**To check**:
An owner's transactions that wait for them to pick a category: those the AI could not place (Needs review) and those whose categorisation failed. A transaction leaves To check when the owner picks its category; Tempo keeps no guess for it, so there is nothing to confirm.
_Avoid_: to review, needs attention, uncategorised

**Usual pace**:
How much an owner usually has spent by each day of a month: the average, day by day, of their newest six complete months before this one, shown once two complete months exist. A month is complete when their data covers every day of it, from the 1st to the last. This month's spending is compared with it up to the last covered day.
_Avoid_: baseline, typical spending, average month

**Verified bank**:
A bank whose real export a built-in reader (a built-in CSV or XLSX layout, or the CAMT, MT940 or OFX reader) reads correctly, row for row. A real export is an owner's own, a public anonymised one of any year, or a bank-published example where the bank's help shows private customers can download that format. Hand-made samples and the column mapper never make a bank verified. The bank list (`packages/contracts/src/banks.ts`) names each verified bank's readers.
_Avoid_: supported bank, working bank
