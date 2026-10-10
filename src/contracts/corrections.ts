import type {
  DecimalInteger,
  EntityId,
  IsoDateTime,
  JsonValue,
} from "./core";
import type { Intervention } from "./twin";

export type CorrectionProposalStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "applied";

/** Proposal creation has no financial effect. */
interface CorrectionProposalBase {
  id: EntityId;
  datasetId: EntityId;
  expectedDatasetRevision: DecimalInteger;
  baseSnapshotId: EntityId;
  simulationResultId: EntityId;
  intervention: Intervention;
  proposedBy: EntityId;
  proposedAt: IsoDateTime;
}

export type CorrectionProposal = CorrectionProposalBase &
  (
    | { status: "pending_approval"; decidedBy?: never; decidedAt?: never; decisionAuditEventId?: never }
    | { status: "approved" | "rejected" | "applied"; decidedBy: EntityId; decidedAt: IsoDateTime; decisionAuditEventId: EntityId }
  );

/** Records a deterministic mutation of the sandbox dataset only. */
export interface AppliedCorrection {
  id: EntityId;
  datasetId: EntityId;
  proposalId: EntityId;
  scope: "sandbox";
  appliedBy: EntityId;
  appliedAt: IsoDateTime;
  beforeSnapshotId: EntityId;
  afterSnapshotId: EntityId;
  auditEventId: EntityId;
}

export type AuditAction =
  | "DATASET_IMPORTED"
  | "RECONCILIATION_RUN"
  | "SIMULATION_RUN"
  | "CORRECTION_PROPOSED"
  | "CORRECTION_APPROVED"
  | "CORRECTION_REJECTED"
  | "CORRECTION_APPLIED";

export interface AuditEvent {
  id: EntityId;
  datasetId: EntityId;
  actorId: EntityId;
  action: AuditAction;
  subjectId: EntityId;
  occurredAt: IsoDateTime;
  datasetRevisionBefore: DecimalInteger;
  datasetRevisionAfter: DecimalInteger;
  details: Record<string, JsonValue>;
}
