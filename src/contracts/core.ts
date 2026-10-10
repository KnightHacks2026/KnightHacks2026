/** Public JSON contract version. Breaking wire changes require a new major version. */
export const CONTRACT_VERSION = "1.0.0" as const;
export type ContractVersion = typeof CONTRACT_VERSION;

/** Canonical base-10 integer string; runtime parsers must also enforce /^-?(0|[1-9][0-9]*)$/. */
export type DecimalInteger = `${bigint}`;
export type IsoDateTime = string;
export type IsoDate = string;
export type CurrencyCode = string;
export type EntityId = string;

export interface Money {
  /** ISO 4217 code. minorUnits uses that currency's ISO 4217 exponent. */
  currency: CurrencyCode;
  minorUnits: DecimalInteger;
}

export interface SecuritiesQuantity {
  instrumentId: EntityId;
  /** Integer units at Instrument.quantityScale decimal places. */
  units: DecimalInteger;
}

export type Asset =
  | { kind: "cash"; currency: CurrencyCode }
  | { kind: "security"; instrumentId: EntityId };

export interface SourceReference {
  sourceRecordId: EntityId;
  sourceSystem: string;
  externalId: string;
}

export type JsonValue =
  | null
  | boolean
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Stable machine codes. Consumers must display the supplied text separately. */
export const FINANCIAL_REASON_CODES = [
  "SOURCE_RECORD_MISSING",
  "SOURCE_RECORD_DUPLICATE",
  "AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
  "QUANTITY_MISMATCH",
  "ACCOUNT_MISMATCH",
  "INSTRUMENT_MISMATCH",
  "SETTLEMENT_DATE_MISMATCH",
  "CASH_SHORTFALL",
  "SECURITIES_SHORTFALL",
  "UPSTREAM_SETTLEMENT_BLOCKED",
  "COUNTERPARTY_DELAY",
  "POSITION_CONFLICT",
  "DATA_STALE",
  "POLICY_CONSTRAINT",
] as const;
export type FinancialReasonCode = (typeof FINANCIAL_REASON_CODES)[number];

export const INTERVENTION_VALIDATION_CODES = [
  "DATASET_REVISION_MISMATCH",
  "SNAPSHOT_MISMATCH",
  "OBLIGATION_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "CURRENCY_MISMATCH",
  "INSUFFICIENT_AVAILABLE_CASH",
  "INSUFFICIENT_AVAILABLE_SECURITIES",
  "DUPLICATE_RESOURCE_ALLOCATION",
  "INVALID_SETTLEMENT_ORDER",
  "INTERVENTION_CONFLICT",
  "POLICY_CONSTRAINT",
] as const;
export type InterventionValidationCode =
  (typeof INTERVENTION_VALIDATION_CODES)[number];

export interface ValidationIssue<TCode extends string = string> {
  code: TCode;
  message: string;
  field?: string;
  entityId?: EntityId;
}
