# Tempo

Tempo shows people their spending and income across the bank accounts they connect or import.

## Language

**Account-history writer**:
The one way a write to an owner's transaction history (a sync, an import, a doubtful or never-sent row, an undo) starts: it takes the write's locks in one fixed order before any row is touched.
_Avoid_: import transaction, sync transaction, lock helper

**Derived-data refresh**:
Bringing the values Tempo computes from an owner's transaction history (reporting currency, currency exchanges, own transfers, categories, merchant logos) up to date after a write to that history.
_Avoid_: post-sync hook, follow-up steps, after-write steps
