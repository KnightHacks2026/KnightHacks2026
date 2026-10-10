import type { Asset, DecimalInteger, FinancialReasonCode } from "../../contracts";

const currencyExponent: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0 };

/** Display only. Financial decisions are made by the simulation service. */
export function formatAssetUnits(asset: Asset, units: DecimalInteger, symbol?: string): string {
  if (asset.kind === "security") return `${units} ${symbol ?? "units"}`;
  const exponent = currencyExponent[asset.currency];
  if (exponent === undefined) return `${units} minor units ${asset.currency}`;
  const negative = units.startsWith("-");
  const absolute = BigInt(units.replace("-", ""));
  const divisor = 10n ** BigInt(exponent);
  const integer = (absolute / divisor).toLocaleString("en-US");
  const fraction = exponent ? `.${(absolute % divisor).toString().padStart(exponent, "0")}` : "";
  return `${negative ? "−" : ""}${asset.currency} ${integer}${fraction}`;
}

export function formatUtc(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";
}

export function reasonLabel(code: FinancialReasonCode): string {
  const labels: Record<FinancialReasonCode, string> = {
    SOURCE_RECORD_MISSING: "Source record missing",
    SOURCE_RECORD_DUPLICATE: "Duplicate source record",
    AMOUNT_MISMATCH: "Amount mismatch",
    CURRENCY_MISMATCH: "Currency mismatch",
    QUANTITY_MISMATCH: "Quantity mismatch",
    ACCOUNT_MISMATCH: "Account mismatch",
    INSTRUMENT_MISMATCH: "Instrument mismatch",
    SETTLEMENT_DATE_MISMATCH: "Settlement date mismatch",
    CASH_SHORTFALL: "Cash shortfall",
    SECURITIES_SHORTFALL: "Securities shortfall",
    UPSTREAM_SETTLEMENT_BLOCKED: "Upstream settlement blocked",
    COUNTERPARTY_DELAY: "Counterparty delay",
    POSITION_CONFLICT: "Position conflict",
    DATA_STALE: "Data stale",
    POLICY_CONSTRAINT: "Policy constraint",
  };
  return labels[code] ?? code.replaceAll("_", " ").toLowerCase();
}
