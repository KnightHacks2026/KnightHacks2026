# Custody assessment handoff

`assessCustody(input)` is a pure, deterministic read of a `FinancialSnapshot`, accounts, instruments, source records, dependencies, and optional explicit DvP pairs. It returns positions, obligation readiness, structured exceptions, and aggregate indicators. It does not mutate balances or settle obligations. Its `detectedAt` is the snapshot `asOf`, so identical inputs produce identical results.

`GET /api/datasets/:datasetId/custody` reads the cascade fixture or an imported dataset through `getSimulationDataset`, including that dataset's source records. The response uses the shared `ApiResponse` envelope with `{ assessment }` data and `datasetRevision` metadata. Unknown datasets return `NOT_FOUND`; incompatible contract versions return `UNSUPPORTED_CONTRACT_VERSION`.

**Data integration interface:** supply one dataset revision's `snapshot`, `accounts`, `instruments`, `sourceRecords`, `dependencies`, and optional explicit `dvpPairs` to `assessCustody`. The route now supplies imported data from the repository. The v1 import contract has no `dvpPairs` field, so imports reject it until a shared contract supports it. The service never guesses a DvP relationship from matching amounts or dates. Cancelled or inconsistently completed pairs fail validation. A break in either leg blocks readiness for both.

**Architect/Platform decision:** the shared `POST /reconciliation` response requires a persisted `auditEventId`, but this branch has no audit persistence and custody does not own it. The read-only GET gives usable custody insights now. Connect POST only when the data/platform layer can atomically store exception records and a real audit event under `expectedDatasetRevision`; an invented ID would violate the contract.

Status semantics: a fully settled obligation is `settled`; an unsettled obligation with a break or recorded `blocked` status is `blocked`, or `failed` when its due time precedes snapshot `asOf`; otherwise it is `pending`. `readyCount` counts pending obligations with no detected break. Readiness is a count ratio. Blocked cash and security units remain separate by currency and instrument, with no cross-asset sum.
