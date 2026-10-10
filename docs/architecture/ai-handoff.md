# Settlement intelligence handoff

The AI layer currently uses deterministic rules. It reads the imported dataset or cascade fixture through `getSimulationDataset`, derives custody assessment and the settlement baseline, and never writes financial state. No external model is configured; `Explanation.model` is `deterministic-rules-v1`.

## Routes

- `POST /api/datasets/:datasetId/explanations` accepts the shared `GetExplanationRequest` for `exception` and `obligation` subjects. The response is the shared `GetExplanationResponse` envelope.
- For a `simulation` subject, include the original `simulationRequest` alongside the shared request fields. This is an additive route input while simulation results are not persisted. The server validates and reruns the request against the current snapshot and revision, then requires the recomputed result ID to match `subject.id`. A stale revision returns `REVISION_CONFLICT`; an unknown result ID returns `NOT_FOUND`. Client supplied result bodies are never trusted.
- `GET /api/datasets/:datasetId/recommendations` returns `{ recommendations, snapshotId }` in the shared `ApiResponse` envelope. Each recommendation includes a typed intervention, an engine-derived comparison, the simulation result ID, and `requiresHumanReview: true`. The frontend can send the intervention in a normal simulation request to inspect the full projection. The route has no approval or execution capability.

The frontend may import `SimulationExplanationRequest`, `Recommendation`, and `RecommendationsData` from `src/lib/ai/intelligence.ts`. The simulation explanation request adds `simulationRequest` to the shared request shape:

```json
{
  "contractVersion": "1.0.0",
  "datasetId": "dataset-cascade",
  "subject": { "kind": "simulation", "id": "simulation-..." },
  "simulationRequest": {
    "contractVersion": "1.0.0",
    "datasetId": "dataset-cascade",
    "baseSnapshotId": "snapshot-cascade-1",
    "expectedDatasetRevision": "1",
    "interventions": [{
      "id": "intervention-full-funding",
      "kind": "cash_transfer",
      "datasetId": "dataset-cascade",
      "baseSnapshotId": "snapshot-cascade-1",
      "expectedDatasetRevision": "1",
      "rationale": "Test a funded transfer from the uncommitted reserve.",
      "sourceAccountId": "acct-reserve",
      "targetAccountId": "acct-a",
      "amount": { "currency": "USD", "minorUnits": "1000" },
      "effectiveAt": "2026-10-09T13:05:00Z"
    }]
  }
}
```

Both routes return `ok`, `data`, and `meta` on success. Explanation data is `{ explanation: Explanation }`. Recommendation data is `{ recommendations: Recommendation[], snapshotId: string }`. Each recommendation contains `id`, `kind`, `summary`, `rationale`, `intervention`, `simulationResultId`, `comparison`, and `requiresHumanReview`. Errors use the shared `ApiResponse` error envelope. Send the exact returned `intervention` in `POST /simulations` with the recommendation's dataset, snapshot, and revision to inspect its projection. Its ID may differ from `simulationResultId` if the request differs; `simulationResultId` identifies the candidate request evaluated by this route.

Explanations cite obligation IDs, source record IDs, reason codes, exact integer units, and predecessor dependencies. Cash amounts remain minor-unit strings. `Explanation.generatedAt` is the actual generation time; financial evidence is anchored to the snapshot `asOf` and `snapshotId`. Recommendations test available settled cash minus reservations and keep only interventions the simulation engine validates and projects to settle obligations, reduce blocked count, and create no newly at-risk obligations. Custody assessment must show no unresolved record or policy break on newly settled obligations. Priority suggestions are similarly verified; a dataset may yield none. Candidate simulations are independent, so recommendations are alternatives and must not be applied together without a fresh combined simulation. Human approval, application, and audit remain owned by the future correction workflow.

The import contract currently rejects explicit DvP pair fields. When the shared contract and dataset loader add DvP pairs, this adapter must pass them to both custody assessment and simulation before recommending scenarios for those datasets.
