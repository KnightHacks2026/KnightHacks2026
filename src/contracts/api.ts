import type {
  ContractVersion,
  DecimalInteger,
  EntityId,
  IsoDateTime,
  ValidationIssue,
} from "./core";
import type {
  Account,
  CashBalance,
  Dataset,
  Dependency,
  FinancialSnapshot,
  Institution,
  Instrument,
  Obligation,
  ReconciliationException,
  SecuritiesBalance,
  SourceRecord,
} from "./entities";
import type { AppliedCorrection, AuditEvent, CorrectionProposal } from "./corrections";
import type {
  Explanation,
  Intervention,
  SimulationResult,
  TwinProjection,
} from "./twin";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "VALIDATION_FAILED"
  | "INTERVENTION_INVALID"
  | "APPROVAL_REQUIRED"
  | "PERMISSION_DENIED"
  | "INTERNAL_ERROR";

export interface ApiMeta {
  contractVersion: ContractVersion;
  requestId: string;
  generatedAt: IsoDateTime;
  datasetRevision?: DecimalInteger;
}

export type ApiResponse<T> =
  | { ok: true; data: T; meta: ApiMeta }
  | {
      ok: false;
      error: {
        code: ApiErrorCode;
        message: string;
        validationIssues?: ValidationIssue[];
      };
      meta: ApiMeta;
    };

export interface VersionedRequest {
  contractVersion: ContractVersion;
}

export interface DatasetRequest extends VersionedRequest {
  datasetId: EntityId;
}

export interface MutatingDatasetRequest extends DatasetRequest {
  expectedDatasetRevision: DecimalInteger;
}

/** Atomic import. All nested datasetId values must match dataset.id. */
export interface ImportDatasetRequest extends VersionedRequest {
  dataset: Pick<Dataset, "id" | "name" | "asOf" | "contractVersion">;
  institutions: Institution[];
  accounts: Account[];
  instruments: Instrument[];
  sourceRecords: SourceRecord[];
  obligations: Obligation[];
  dependencies: Dependency[];
  initialCashBalances: CashBalance[];
  initialSecuritiesBalances: SecuritiesBalance[];
}

export type ImportDatasetResponse = ApiResponse<{
  dataset: Dataset;
  snapshotId: EntityId;
  imported: {
    institutions: number;
    accounts: number;
    instruments: number;
    sourceRecords: number;
    obligations: number;
    dependencies: number;
  };
  auditEventId: EntityId;
}>;

export interface RunReconciliationRequest extends MutatingDatasetRequest {
  sourceRecordIds?: EntityId[];
}

export type RunReconciliationResponse = ApiResponse<{
  exceptions: ReconciliationException[];
  checkedSourceRecordCount: number;
  auditEventId: EntityId;
}>;

export interface GetWorkspaceRequest extends DatasetRequest {}

export type GetWorkspaceResponse = ApiResponse<{
  dataset: Dataset;
  snapshot: FinancialSnapshot;
  exceptions: ReconciliationException[];
  proposals: CorrectionProposal[];
  recentAuditEvents: AuditEvent[];
}>;

export interface GetTwinRequest extends DatasetRequest {
  snapshotId?: EntityId;
}

export type GetTwinResponse = ApiResponse<{
  projection: TwinProjection;
}>;

export interface RunSimulationRequest extends MutatingDatasetRequest {
  baseSnapshotId: EntityId;
  interventions: [Intervention, ...Intervention[]];
}

export type RunSimulationResponse = ApiResponse<{
  result: SimulationResult;
  auditEventId: EntityId;
}>;

export interface GetExplanationRequest extends DatasetRequest {
  subject:
    | { kind: "exception"; id: EntityId }
    | { kind: "obligation"; id: EntityId }
    | { kind: "simulation"; id: EntityId };
}

export type GetExplanationResponse = ApiResponse<{
  explanation: Explanation;
}>;

export interface CreateCorrectionProposalRequest extends MutatingDatasetRequest {
  simulationResultId: EntityId;
  interventionId: EntityId;
  proposedBy: EntityId;
}

export type CreateCorrectionProposalResponse = ApiResponse<{
  proposal: CorrectionProposal;
  auditEvent: AuditEvent;
}>;

export interface DecideCorrectionProposalRequest extends MutatingDatasetRequest {
  proposalId: EntityId;
  decision: "approve" | "reject";
  decidedBy: EntityId;
  note?: string;
}

export type DecideCorrectionProposalResponse = ApiResponse<{
  proposal: CorrectionProposal;
  auditEvent: AuditEvent;
}>;

/** Separate human-triggered application of an approved sandbox correction. */
export interface ApplyApprovedCorrectionRequest extends MutatingDatasetRequest {
  proposalId: EntityId;
  appliedBy: EntityId;
}

export type ApplyApprovedCorrectionResponse = ApiResponse<{
  appliedCorrection: AppliedCorrection;
  afterSnapshot: FinancialSnapshot;
  auditEvent: AuditEvent;
}>;

export interface GetAuditEventsRequest extends DatasetRequest {
  cursor?: string;
  limit?: number;
  subjectId?: EntityId;
}

export type GetAuditEventsResponse = ApiResponse<{
  events: AuditEvent[];
  nextCursor?: string;
}>;
