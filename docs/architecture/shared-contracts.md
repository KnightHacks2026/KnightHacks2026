# CustodyOS shared contracts v1

`src/contracts/index.ts` is the public TypeScript entry point for all seven implementation agents. The Chief Architect owns changes to these files. Consumers import types from this barrel and keep module-specific models behind their own boundaries. Fixtures in `src/contracts/fixtures` are synthetic input examples, not persisted records or a simulation engine.

## Financial representation and invariants

- Every money amount crossing an API boundary is `Money { currency, minorUnits }`; every securities quantity is integer `units` tied to an `Instrument.quantityScale`. `DecimalInteger` is a canonical signed base-10 integer string. Runtime validators must enforce `^-?(0|[1-9][0-9]*)$`, reject `-0`, and use `BigInt` or an exact decimal library. No financial calculation may use JavaScript `number` or floating point. Counts, display coordinates, and `quantityScale` may be numbers; `quantityScale` must be a nonnegative integer.
- `Money.minorUnits` uses the ISO 4217 currency exponent. An obligation's `requiredUnits` and `settledUnits` use the exponent of its `asset` (`cash` currency minor units or security quantity scale). Both are nonnegative, and `settledUnits <= requiredUnits`.
- `CashBalance.settledMinorUnits` and `SecuritiesBalance.settledUnits` include reserved inventory. Available inventory is settled minus reserved. A transfer or settlement must reserve or consume inventory exactly once, across all interventions in the same simulation and across concurrent corrections. Never allocate more than available. Do not count anticipated proceeds as settled inventory until their predecessor obligation settles.
- Each `Dependency` points from `predecessorObligationId` to `successorObligationId`. Both must exist in the same dataset; the graph must be acyclic. A blocked predecessor can propagate `UPSTREAM_SETTLEMENT_BLOCKED` to successors. Source references, account IDs, instrument IDs, and snapshot IDs must resolve within one dataset.
- Financial snapshots are immutable. Simulations run against one snapshot and dataset revision; they do not mutate that snapshot. Every intervention must use that same dataset, snapshot, and revision. A stale revision fails before simulation or application. Comparisons are engine-derived, and invalid simulations have no projected outcome.
- The AI workflow can produce `Explanation` and suggest a `CorrectionProposal`; it cannot approve, apply, or execute financial activity. Approval requires a human actor and creates an audit event. Applying an approved correction is a separate human-triggered **sandbox-only** operation that atomically creates an `AppliedCorrection`, a new snapshot, and an audit event. No contract here represents a live settlement instruction.

## Intervention validation

The simulation and correction services must validate these rules at runtime; TypeScript types alone do not validate JSON:

1. Enforce matching `datasetId`, `baseSnapshotId`, and `expectedDatasetRevision`, unique intervention IDs, existing accounts and obligations, and a nonempty intervention list.
2. Require positive integer transfer amount, matching account currency, distinct source and target accounts, and `effectiveAt` no earlier than snapshot `asOf`. Check aggregate source availability across the full intervention set and reject duplicate resource allocation.
3. For `settlement_priority`, require distinct existing obligations. Reject an order that violates any predecessor path or introduces a conflict. It changes queue order only and cannot change `dueAt` or invent inventory.
4. Recheck all financial and policy constraints at correction application time. A prior valid simulation is evidence, not a lock on inventory. Approval and application each produce their own audit event. An invalid intervention returns stable `INTERVENTION_VALIDATION_CODES` with no projected state.

`FINANCIAL_REASON_CODES` identify reconciliation and settlement conditions. Codes are stable machine values; user-facing wording belongs in explanations or UI copy. New additive codes require consumers to handle unknown values gracefully at runtime.

| Code | Meaning |
| --- | --- |
| `SOURCE_RECORD_MISSING` | An expected source-side record is absent. |
| `SOURCE_RECORD_DUPLICATE` | More than one source record claims the same external identity. |
| `AMOUNT_MISMATCH` | Cash minor-unit amounts differ across matched records. |
| `CURRENCY_MISMATCH` | Matched cash legs use different currencies. |
| `QUANTITY_MISMATCH` | Security integer-unit quantities differ. |
| `ACCOUNT_MISMATCH` | Matched records identify different accounts. |
| `INSTRUMENT_MISMATCH` | Matched records identify different instruments. |
| `SETTLEMENT_DATE_MISMATCH` | Matched records disagree on settlement date. |
| `CASH_SHORTFALL` | Available settled cash is below a required cash leg. |
| `SECURITIES_SHORTFALL` | Available settled security units are below a required security leg. |
| `UPSTREAM_SETTLEMENT_BLOCKED` | A required predecessor has not settled. |
| `COUNTERPARTY_DELAY` | A counterparty-side event is late. |
| `POSITION_CONFLICT` | Competing claims exceed the same cash or security inventory. |
| `DATA_STALE` | Financial input is older than the accepted freshness window. |
| `POLICY_CONSTRAINT` | An explicit operational rule prevents the action. |

## API operations

All responses are `ApiResponse<T>` with a versioned `meta` envelope. Errors use `ApiErrorCode`; consumers branch on `ok`. `expectedDatasetRevision` supports optimistic concurrency for mutating operations. Routes are a proposed v1 mapping for Platform; request and response interfaces are authoritative.

| Operation | Proposed route | Request / response |
| --- | --- | --- |
| Atomic import | `POST /api/datasets/import` | `ImportDatasetRequest` / `ImportDatasetResponse` |
| Reconcile | `POST /api/datasets/:datasetId/reconciliation` | `RunReconciliationRequest` / `RunReconciliationResponse` |
| Workspace | `GET /api/datasets/:datasetId/workspace` | `GetWorkspaceRequest` / `GetWorkspaceResponse` |
| Twin graph | `GET /api/datasets/:datasetId/twin` | `GetTwinRequest` / `GetTwinResponse` |
| Simulate | `POST /api/datasets/:datasetId/simulations` | `RunSimulationRequest` / `RunSimulationResponse` |
| Explain | `POST /api/datasets/:datasetId/explanations` | `GetExplanationRequest` / `GetExplanationResponse` |
| Propose correction | `POST /api/datasets/:datasetId/correction-proposals` | `CreateCorrectionProposalRequest` / `CreateCorrectionProposalResponse` |
| Decide | `POST /api/datasets/:datasetId/correction-proposals/:proposalId/decisions` | `DecideCorrectionProposalRequest` / `DecideCorrectionProposalResponse` |
| Apply approved sandbox correction | `POST /api/datasets/:datasetId/correction-proposals/:proposalId/apply` | `ApplyApprovedCorrectionRequest` / `ApplyApprovedCorrectionResponse` |
| Audit | `GET /api/datasets/:datasetId/audit-events` | `GetAuditEventsRequest` / `GetAuditEventsResponse` |

Import is atomic: all nested `datasetId` values match the requested dataset, all references resolve, and duplicate source keys `(datasetId, sourceSystem, externalId)` fail validation. Platform maps request data from path/query/body and validates it before calling services. Authenticated actor identity must come from the server session; request `proposedBy`, `decidedBy`, and `appliedBy` fields are asserted against it, never trusted on their own. No partial financial import or correction is reported as success.

Simulation is read-only. `RunSimulationResponse` contains the engine result without an `auditEventId`; no correction is approved or applied by this operation. Workspace reads include institutions, accounts, and instruments so detail views can resolve snapshot references from the same dataset. The current route adapters serve only the fixed `dataset-cascade` fixture until the import and persistence service is available. Unknown datasets and snapshots return `NOT_FOUND`.

## Versioning and agent handoff

`CONTRACT_VERSION` is `1.0.0`. Dataset and request bodies carry it; response metadata and `SimulationResult` echo it. The current types accept that version exactly. Producers reject unsupported versions, and future releases can accept compatible v1 minors explicitly. Patch versions clarify documentation or validation without changing wire shapes; minor versions add optional fields or enum values; major versions may break wire compatibility. Persist the source contract version with imported datasets. API JSON uses camelCase and UTC ISO 8601 timestamps.

- **Data** maps these entities to Prisma and supplies runtime validation and immutable snapshots.
- **Custody** owns reconciliation, obligations, liquidity checks, and financial reason codes emitted by deterministic logic.
- **Simulation** owns dependency traversal, intervention validation, Twin projection, and exact comparison calculations.
- **Platform** owns route adapters, authorization, concurrency checks, response envelopes, and atomic audit writes.
- **AI** may read grounded evidence to create explanations and draft proposals; it does not decide or apply.
- **Frontend** renders workspace and Twin from these read models and sends typed simulation and correction requests.
- **QA** verifies invariants, cascade behavior, concurrency conflicts, and approval/audit flows against these contracts.

The fixture `twin-cascade.ts` has three $100 USD obligations, $90 at the first account, and $20 of separate unreserved cash. Its graph shows an initial cash shortfall and two downstream blocked legs. Two intervention requests move $10 or $5 from that existing reserve. The fixture supplies no asserted simulated outcome; Simulation must calculate and test those outcomes deterministically.

## Open handoff questions

No prior architecture handoff document or package tooling was present on this branch. The following choices are explicit v1 assumptions pending cross-team review: ISO 4217 minor-unit exponent is external reference data; supported currency and instrument identifier catalogs are not defined here; account balance rules currently assume no authorized overdraft; and the route paths above are proposed, while the TypeScript request/response shapes are fixed for this milestone.
