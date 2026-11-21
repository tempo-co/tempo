# Tempo

Tempo shows people their spending and income across the bank accounts they connect or import.

## Language

**Account-history writer**:
The one way a write to an owner's transaction history (a sync, an import, a doubtful or never-sent row, an undo) starts: it takes the write's locks in one fixed order before any row is touched. Inside it, recording a bank fetch for an account, or adding file rows to an account, runs that account's steps in one fixed order too.
_Avoid_: import transaction, sync transaction, lock helper

**Bank identity**:
The bank an account is held at, as Tempo records it: the institution name of its connection, of the bank a statement format belongs to or of the bank an owner named for a layout, or a BIC a statement states. A name never equals a BIC. A currency exchange happens inside one bank, so exchanges among imported files pair only within one bank identity. It never names an account: a statement giving an id that is no IBAN another bank than its account records is refused. Undoing an import forgets the bank its accounts recorded from files, until the next import gives it again.
_Avoid_: institution key, bank code

**Derived-data refresh**:
Bringing the values Tempo computes from an owner's transaction history (reporting currency, currency exchanges, own transfers, categories, merchant logos) up to date after a write to that history.
_Avoid_: post-sync hook, follow-up steps, after-write steps
