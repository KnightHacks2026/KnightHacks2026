import type {
  Asset,
  ContractVersion,
  CurrencyCode,
  DecimalInteger,
  EntityId,
  FinancialReasonCode,
  IsoDateTime,
  JsonValue,
  Money,
  SecuritiesQuantity,
  SourceReference,
} from "./core";

export interface Dataset {
  id: EntityId;
  contractVersion: ContractVersion;
  /** Monotonically increasing optimistic-concurrency revision. */
  revision: DecimalInteger;
  name: string;
  asOf: IsoDateTime;
  createdAt: IsoDateTime;
  status: "importing" | "ready" | "invalid";
}

export interface Institution {
  id: EntityId;
  datasetId: EntityId;
  name: string;
  externalId?: string;
  role: "custodian" | "client" | "counterparty";
}

export interface Account {
  id: EntityId;
  datasetId: EntityId;
  institutionId: EntityId;
  externalId: string;
  name: string;
  kind: "cash" | "securities" | "omnibus";
  status: "open" | "restricted" | "closed";
}

export interface Instrument {
  id: EntityId;
  datasetId: EntityId;
  symbol: string;
  name: string;
  assetClass: "equity" | "fixed_income" | "fund" | "other";
  /** Decimal digits represented by one integer unit (0 for whole shares). */
  quantityScale: number;
  identifiers: { isin?: string; cusip?: string };
}

export interface SourceRecord {
  id: EntityId;
  datasetId: EntityId;
  sourceSystem: string;
  externalId: string;
  kind: "trade" | "cash_movement" | "position" | "settlement" | "other";
  occurredAt: IsoDateTime;
  receivedAt: IsoDateTime;
  accountId?: EntityId;
  amount?: Money;
  quantity?: SecuritiesQuantity;
  /** Raw nonfinancial metadata only; calculations use typed amount/quantity fields. */
  attributes: Record<string, JsonValue>;
}

export interface ReconciliationException {
  id: EntityId;
  datasetId: EntityId;
  reasonCode: FinancialReasonCode;
  status: "open" | "investigating" | "resolved";
  severity: "info" | "warning" | "critical";
  sourceRecordIds: EntityId[];
  obligationIds: EntityId[];
  detectedAt: IsoDateTime;
  summary: string;
  /** Human-facing evidence, never the authority for financial calculations. */
  evidence: SourceReference[];
}

/** One obligation is one deliverable cash or security leg. */
export interface Obligation {
  id: EntityId;
  datasetId: EntityId;
  externalId: string;
  fromAccountId: EntityId;
  toAccountId: EntityId;
  asset: Asset;
  /** Nonnegative integer in minor currency units or instrument quantity units. */
  requiredUnits: DecimalInteger;
  settledUnits: DecimalInteger;
  dueAt: IsoDateTime;
  status: "pending" | "at_risk" | "blocked" | "settled" | "cancelled";
  sourceRecordIds: EntityId[];
}

/** A blocked predecessor may propagate risk to its successor. */
export interface Dependency {
  id: EntityId;
  datasetId: EntityId;
  predecessorObligationId: EntityId;
  successorObligationId: EntityId;
  kind: "settlement_proceeds" | "inventory_release" | "operational";
}

export interface CashBalance {
  accountId: EntityId;
  currency: CurrencyCode;
  /** Settled ledger balance; reservations are included in this amount. */
  settledMinorUnits: DecimalInteger;
  reservedMinorUnits: DecimalInteger;
}

export interface SecuritiesBalance {
  accountId: EntityId;
  instrumentId: EntityId;
  settledUnits: DecimalInteger;
  reservedUnits: DecimalInteger;
}

/** Immutable state input for deterministic simulation. */
export interface FinancialSnapshot {
  id: EntityId;
  datasetId: EntityId;
  datasetRevision: DecimalInteger;
  asOf: IsoDateTime;
  cashBalances: CashBalance[];
  securitiesBalances: SecuritiesBalance[];
  obligations: Obligation[];
}
