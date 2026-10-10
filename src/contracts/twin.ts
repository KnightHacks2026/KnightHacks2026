import type {
  ContractVersion,
  DecimalInteger,
  EntityId,
  FinancialReasonCode,
  InterventionValidationCode,
  IsoDateTime,
  Money,
  ValidationIssue,
} from "./core";
import type { CashBalance, Dependency, SecuritiesBalance } from "./entities";

interface InterventionBase {
  id: EntityId;
  datasetId: EntityId;
  baseSnapshotId: EntityId;
  expectedDatasetRevision: DecimalInteger;
  rationale: string;
}

/** Simulation-only transfer. Source and target must be distinct accounts. */
export interface CashTransferIntervention extends InterventionBase {
  kind: "cash_transfer";
  sourceAccountId: EntityId;
  targetAccountId: EntityId;
  amount: Money;
  effectiveAt: IsoDateTime;
}

/** Changes simulation queue order only; it does not alter contractual due dates. */
export interface SettlementPriorityIntervention extends InterventionBase {
  kind: "settlement_priority";
  obligationId: EntityId;
  aheadOfObligationId: EntityId;
}

export type Intervention = CashTransferIntervention | SettlementPriorityIntervention;

export interface ProjectedObligation {
  obligationId: EntityId;
  status: "pending" | "at_risk" | "blocked" | "settled" | "cancelled";
  reasonCodes: FinancialReasonCode[];
  projectedSettlementAt?: IsoDateTime;
  settledUnits: DecimalInteger;
}

/** Graph-ready, engine-derived view; direction follows Dependency predecessor -> successor. */
export interface TwinProjection {
  datasetId: EntityId;
  snapshotId: EntityId;
  asOf: IsoDateTime;
  obligations: ProjectedObligation[];
  dependencies: Dependency[];
  cashBalances: CashBalance[];
  securitiesBalances: SecuritiesBalance[];
}

export interface SimulationComparison {
  newlySettledObligationIds: EntityId[];
  stillBlockedObligationIds: EntityId[];
  newlyAtRiskObligationIds: EntityId[];
  /** Nonfinancial cardinalities; cash and security balances remain decimal strings. */
  blockedCountBefore: number;
  blockedCountAfter: number;
}

export type SimulationResult =
  | {
      id: EntityId;
      contractVersion: ContractVersion;
      datasetId: EntityId;
      baseSnapshotId: EntityId;
      modelVersion: string;
      createdAt: IsoDateTime;
      interventionIds: EntityId[];
      status: "valid";
      validationIssues: [];
      baseline: TwinProjection;
      projected: TwinProjection;
      comparison: SimulationComparison;
    }
  | {
      id: EntityId;
      contractVersion: ContractVersion;
      datasetId: EntityId;
      baseSnapshotId: EntityId;
      modelVersion: string;
      createdAt: IsoDateTime;
      interventionIds: EntityId[];
      status: "invalid";
      validationIssues: ValidationIssue<InterventionValidationCode>[];
      baseline: TwinProjection;
      projected?: never;
      comparison?: never;
    };

export interface Explanation {
  id: EntityId;
  datasetId: EntityId;
  subject:
    | { kind: "exception"; id: EntityId }
    | { kind: "obligation"; id: EntityId }
    | { kind: "simulation"; id: EntityId };
  generatedAt: IsoDateTime;
  model: string;
  summary: string;
  reasonCodes: FinancialReasonCode[];
  sourceRecordIds: EntityId[];
  obligationIds: EntityId[];
  simulationResultId?: EntityId;
  /** AI text is explanatory and cannot authorize or execute a correction. */
  requiresHumanReview: true;
}
