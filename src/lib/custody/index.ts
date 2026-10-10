import type { Account, CashBalance, Dependency, FinancialReasonCode, FinancialSnapshot, Instrument, Obligation, ReconciliationException, SecuritiesBalance, SourceRecord, ValidationIssue } from "@/contracts";

export interface CustodyInput {
  snapshot: FinancialSnapshot;
  accounts: Account[];
  instruments: Instrument[];
  sourceRecords: SourceRecord[];
  dependencies: Dependency[];
  /** Explicit atomic delivery-versus-payment links supplied by the dataset. */
  dvpPairs?: { cashObligationId: string; securityObligationId: string }[];
}
export interface CustodyAssessment {
  datasetId: string;
  snapshotId: string;
  asOf: string;
  positions: { cash: (CashBalance & { availableMinorUnits: string })[]; securities: (SecuritiesBalance & { availableUnits: string })[] };
  obligations: { obligationId: string; status: "settled" | "pending" | "blocked" | "failed"; reasonCodes: FinancialReasonCode[]; remainingUnits: string }[];
  exceptions: ReconciliationException[];
  indicators: {
    obligationCount: number;
    settledCount: number;
    pendingCount: number;
    blockedCount: number;
    failedCount: number;
    readyCount: number;
    exceptionCount: number;
    exceptionCountsBySeverity: { info: number; warning: number; critical: number };
    blockedCashMinorUnitsByCurrency: Record<string, string>;
    blockedSecuritiesUnitsByInstrument: Record<string, string>;
    /** Count ratio, never a monetary ratio. */
    settlementReadiness: { ready: number; eligible: number };
  };
}
export class CustodyValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(`Invalid custody dataset: ${issues.map(i => i.message).join("; ")}`);
  }
}

const integer = /^(0|[1-9][0-9]*)$/;
const key = (a: string, b: string) => `${a}\u0000${b}`;
const remaining = (o: Obligation) => BigInt(o.requiredUnits) - BigInt(o.settledUnits);
const assetKey = (o: Obligation) => o.asset.kind === "cash" ? key(o.fromAccountId, o.asset.currency) : key(o.fromAccountId, o.asset.instrumentId);

export function assessCustody(input: CustodyInput): CustodyAssessment {
  const { snapshot, accounts, instruments, sourceRecords, dependencies } = input;
  const issues: ValidationIssue[] = [];
  const fail = (code: string, message: string, entityId?: string) => issues.push({ code, message, entityId });
  const ids = <T extends { id: string; datasetId: string }>(items: T[], kind: string) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.id || seen.has(item.id)) fail("DUPLICATE_ID", `Duplicate or empty ${kind} ID: ${item.id}`, item.id);
      if (item.datasetId !== snapshot.datasetId) fail("DATASET_MISMATCH", `${kind} ${item.id} belongs to a different dataset`, item.id);
      seen.add(item.id);
    }
    return seen;
  };
  const accountIds = ids(accounts, "account"), instrumentIds = ids(instruments, "instrument");
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const sourceIds = ids(sourceRecords, "source record"), obligationIds = ids(snapshot.obligations, "obligation");
  ids(dependencies, "dependency");
  if (!snapshot.id || !snapshot.datasetId || !integer.test(snapshot.datasetRevision) || Number.isNaN(Date.parse(snapshot.asOf))) fail("INVALID_SNAPSHOT", "Snapshot identity, revision, or asOf is invalid");
  const balanceMap = new Map<string, bigint>();
  const validateBalance = (kind: "cash" | "security", accountId: string, assetId: string, settled: string, reserved: string) => {
    const k = `${kind}\u0000${key(accountId, assetId)}`;
    if (!accountIds.has(accountId) || (kind === "security" && !instrumentIds.has(assetId))) fail("MISSING_REFERENCE", `Balance refers to missing account or instrument: ${accountId}/${assetId}`, accountId);
    if (balanceMap.has(k)) fail("DUPLICATE_BALANCE", `Duplicate balance: ${accountId}/${assetId}`, accountId);
    if (!integer.test(settled) || !integer.test(reserved)) fail("INVALID_BALANCE", `Invalid balance units: ${accountId}/${assetId}`, accountId);
    else if (BigInt(reserved) > BigInt(settled)) fail("INVALID_BALANCE", `Reservations exceed settled balance: ${accountId}/${assetId}`, accountId);
    else balanceMap.set(k, BigInt(settled) - BigInt(reserved));
  };
  for (const b of snapshot.cashBalances) validateBalance("cash", b.accountId, b.currency, b.settledMinorUnits, b.reservedMinorUnits);
  for (const b of snapshot.securitiesBalances) validateBalance("security", b.accountId, b.instrumentId, b.settledUnits, b.reservedUnits);
  const sourceMap = new Map(sourceRecords.map(s => [s.id, s]));
  const sourceKeys = new Set<string>();
  for (const s of sourceRecords) {
    const k = key(s.sourceSystem, s.externalId);
    if (sourceKeys.has(k)) fail("DUPLICATE_SOURCE", `Duplicate source identity: ${s.sourceSystem}/${s.externalId}`, s.id);
    sourceKeys.add(k);
    if (s.accountId && !accountIds.has(s.accountId)) fail("MISSING_REFERENCE", `Source ${s.id} refers to missing account ${s.accountId}`, s.id);
    if (s.amount && (!integer.test(s.amount.minorUnits) || !s.amount.currency)) fail("INVALID_SOURCE", `Source ${s.id} has invalid cash amount`, s.id);
    if (s.quantity && (!integer.test(s.quantity.units) || !instrumentIds.has(s.quantity.instrumentId))) fail("INVALID_SOURCE", `Source ${s.id} has invalid security quantity or instrument`, s.id);
  }
  for (const o of snapshot.obligations) {
    if (!accountIds.has(o.fromAccountId) || !accountIds.has(o.toAccountId) || o.fromAccountId === o.toAccountId) fail("MISSING_REFERENCE", `Obligation ${o.id} has invalid account references`, o.id);
    if (o.asset.kind === "security" && !instrumentIds.has(o.asset.instrumentId)) fail("MISSING_REFERENCE", `Obligation ${o.id} has a missing instrument`, o.id);
    if (!integer.test(o.requiredUnits) || !integer.test(o.settledUnits) || (integer.test(o.requiredUnits) && integer.test(o.settledUnits) && BigInt(o.settledUnits) > BigInt(o.requiredUnits))) fail("INVALID_OBLIGATION", `Obligation ${o.id} has inconsistent units`, o.id);
    if (Number.isNaN(Date.parse(o.dueAt))) fail("INVALID_OBLIGATION", `Obligation ${o.id} has an invalid due date`, o.id);
    if (o.status === "settled" && o.settledUnits !== o.requiredUnits || o.status !== "settled" && o.settledUnits === o.requiredUnits && o.status !== "cancelled") fail("INCONSISTENT_STATUS", `Obligation ${o.id} status contradicts settled units`, o.id);
    if (o.status === "cancelled" && o.settledUnits !== "0") fail("INCONSISTENT_STATUS", `Cancelled obligation ${o.id} has settled units`, o.id);
    for (const id of o.sourceRecordIds) if (!sourceIds.has(id)) fail("MISSING_REFERENCE", `Obligation ${o.id} refers to missing source ${id}`, o.id);
  }
  const predecessors = new Map(snapshot.obligations.map(o => [o.id, [] as string[]]));
  for (const d of dependencies) {
    if (!obligationIds.has(d.predecessorObligationId) || !obligationIds.has(d.successorObligationId) || d.predecessorObligationId === d.successorObligationId) fail("MISSING_REFERENCE", `Dependency ${d.id} has invalid obligation references`, d.id);
    else predecessors.get(d.successorObligationId)!.push(d.predecessorObligationId);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { fail("DEPENDENCY_CYCLE", `Dependency cycle at ${id}`, id); return; }
    if (visited.has(id)) return;
    visiting.add(id); for (const p of predecessors.get(id) ?? []) visit(p);
    visiting.delete(id); visited.add(id);
  };
  for (const id of obligationIds) visit(id);
  const pairMap = new Map<string, string>();
  const obligationsById = new Map(snapshot.obligations.map(o => [o.id, o]));
  for (const pair of input.dvpPairs ?? []) {
    const cash = obligationsById.get(pair.cashObligationId), security = obligationsById.get(pair.securityObligationId);
    if (!cash || !security || cash.asset.kind !== "cash" || security.asset.kind !== "security" || cash.status === "cancelled" || security.status === "cancelled" || pairMap.has(pair.cashObligationId) || pairMap.has(pair.securityObligationId) || cash.fromAccountId !== security.toAccountId || cash.toAccountId !== security.fromAccountId) fail("INVALID_DVP", `Invalid DvP pair ${pair.cashObligationId}/${pair.securityObligationId}`);
    else {
      if (integer.test(cash.settledUnits) && integer.test(security.settledUnits) &&
        ((cash.status === "settled") !== (security.status === "settled") || (BigInt(cash.settledUnits) > 0n) !== (BigInt(security.settledUnits) > 0n))) fail("INVALID_DVP", `DvP pair has inconsistent completion state: ${cash.id}/${security.id}`);
      pairMap.set(cash.id, security.id); pairMap.set(security.id, cash.id);
    }
  }
  if (issues.length) throw new CustodyValidationError(issues);

  const exceptions: ReconciliationException[] = [];
  const reasons = new Map<string, FinancialReasonCode[]>();
  const add = (o: Obligation, code: FinancialReasonCode, summary: string) => {
    const list = reasons.get(o.id) ?? []; if (list.includes(code)) return;
    list.push(code); reasons.set(o.id, list);
    exceptions.push({ id: `custody:${snapshot.id}:${o.id}:${code}`, datasetId: snapshot.datasetId, reasonCode: code, status: "open", severity: code === "SOURCE_RECORD_MISSING" || code === "UPSTREAM_SETTLEMENT_BLOCKED" ? "warning" : "critical", sourceRecordIds: [...o.sourceRecordIds], obligationIds: [o.id], detectedAt: snapshot.asOf, summary, evidence: o.sourceRecordIds.map(id => sourceMap.get(id)).filter((s): s is SourceRecord => !!s).map(s => ({ sourceRecordId: s.id, sourceSystem: s.sourceSystem, externalId: s.externalId })) });
  };
  for (const o of snapshot.obligations) {
    if (o.status === "cancelled" || o.status === "settled") continue;
    if (accountMap.get(o.fromAccountId)?.status !== "open" || accountMap.get(o.toAccountId)?.status !== "open") add(o, "POLICY_CONSTRAINT", `Obligation ${o.id} uses a restricted or closed account.`);
    if (o.asset.kind === "cash" && (accountMap.get(o.fromAccountId)?.kind === "securities" || accountMap.get(o.toAccountId)?.kind === "securities") ||
      o.asset.kind === "security" && (accountMap.get(o.fromAccountId)?.kind === "cash" || accountMap.get(o.toAccountId)?.kind === "cash")) add(o, "POLICY_CONSTRAINT", `Obligation ${o.id} uses an account that does not support its asset.`);
    if (o.sourceRecordIds.length === 0) add(o, "SOURCE_RECORD_MISSING", `Obligation ${o.id} has no supporting source record.`);
    for (const id of o.sourceRecordIds) {
      const s = sourceMap.get(id)!;
      if (s.accountId && s.accountId !== o.fromAccountId) add(o, "ACCOUNT_MISMATCH", `Source ${id} account differs from obligation ${o.id}.`);
      if (o.asset.kind === "cash" && s.amount) {
        if (s.amount.currency !== o.asset.currency) add(o, "CURRENCY_MISMATCH", `Source ${id} currency differs from obligation ${o.id}.`);
        if (s.amount.minorUnits !== o.requiredUnits) add(o, "AMOUNT_MISMATCH", `Source ${id} amount differs from obligation ${o.id}.`);
      } else if (o.asset.kind === "security" && s.quantity) {
        if (s.quantity.instrumentId !== o.asset.instrumentId) add(o, "INSTRUMENT_MISMATCH", `Source ${id} instrument differs from obligation ${o.id}.`);
        if (s.quantity.units !== o.requiredUnits) add(o, "QUANTITY_MISMATCH", `Source ${id} quantity differs from obligation ${o.id}.`);
      } else add(o, "SOURCE_RECORD_MISSING", `Source ${id} lacks the asset quantity required by obligation ${o.id}.`);
    }
  }
  const available = new Map(balanceMap);
  const ordered = [...snapshot.obligations].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
  const processed = new Set<string>();
  for (const o of ordered) {
    if (processed.has(o.id) || o.status === "settled" || o.status === "cancelled") continue;
    const group = pairMap.has(o.id) ? [o, obligationsById.get(pairMap.get(o.id)!)!] : [o];
    group.forEach(g => processed.add(g.id));
    const upstream = group.some(g => (predecessors.get(g.id) ?? []).some(id => obligationsById.get(id)!.status !== "settled"));
    if (upstream) { for (const g of group) add(g, "UPSTREAM_SETTLEMENT_BLOCKED", `Obligation ${g.id} depends on an unsettled predecessor.`); continue; }
    if (group.length === 2 && group.some(g => g.status === "blocked" || (reasons.get(g.id) ?? []).length > 0)) {
      for (const g of group) if (g.status !== "blocked" && (reasons.get(g.id) ?? []).length === 0) add(g, "POSITION_CONFLICT", `DvP partner of obligation ${g.id} has a settlement break.`);
      continue;
    }
    const short = group.some(g => (available.get(`${g.asset.kind}\u0000${assetKey(g)}`) ?? 0n) < remaining(g));
    if (short) { for (const g of group) { const code = g.asset.kind === "cash" ? "CASH_SHORTFALL" : "SECURITIES_SHORTFALL"; if ((available.get(`${g.asset.kind}\u0000${assetKey(g)}`) ?? 0n) < remaining(g)) add(g, code, `Available ${g.asset.kind} inventory cannot cover obligation ${g.id}.`); else add(g, "POSITION_CONFLICT", `DvP partner of obligation ${g.id} lacks inventory.`); } continue; }
    if (group.some(g => (reasons.get(g.id) ?? []).length > 0)) continue;
    // Reserve only in this local assessment to prevent a second claim; the input snapshot is immutable.
    for (const g of group) { const k = `${g.asset.kind}\u0000${assetKey(g)}`; available.set(k, available.get(k)! - remaining(g)); }
  }
  const output = ordered.filter(o => o.status !== "cancelled").map(o => {
    const reasonCodes = reasons.get(o.id) ?? [];
    const status = o.status === "settled" ? "settled" : reasonCodes.length || o.status === "blocked" ? (Date.parse(o.dueAt) < Date.parse(snapshot.asOf) ? "failed" : "blocked") : "pending";
    return { obligationId: o.id, status, reasonCodes, remainingUnits: remaining(o).toString() } as const;
  });
  const blockedCash: Record<string, string> = {}, blockedSecurities: Record<string, string> = {};
  for (const item of output) {
    if (item.status !== "blocked" && item.status !== "failed") continue;
    const o = obligationsById.get(item.obligationId)!;
    const target = o.asset.kind === "cash" ? blockedCash : blockedSecurities;
    const asset = o.asset.kind === "cash" ? o.asset.currency : o.asset.instrumentId;
    target[asset] = (BigInt(target[asset] ?? "0") + remaining(o)).toString();
  }
  const readyCount = output.filter(o => o.status === "pending" && o.reasonCodes.length === 0).length;
  return {
    datasetId: snapshot.datasetId, snapshotId: snapshot.id, asOf: snapshot.asOf,
    positions: { cash: snapshot.cashBalances.map(b => ({ ...b, availableMinorUnits: (BigInt(b.settledMinorUnits) - BigInt(b.reservedMinorUnits)).toString() })), securities: snapshot.securitiesBalances.map(b => ({ ...b, availableUnits: (BigInt(b.settledUnits) - BigInt(b.reservedUnits)).toString() })) },
    obligations: output, exceptions,
    indicators: { obligationCount: output.length, settledCount: output.filter(o => o.status === "settled").length, pendingCount: output.filter(o => o.status === "pending").length, blockedCount: output.filter(o => o.status === "blocked").length, failedCount: output.filter(o => o.status === "failed").length, readyCount, exceptionCount: exceptions.length, exceptionCountsBySeverity: { info: exceptions.filter(e => e.severity === "info").length, warning: exceptions.filter(e => e.severity === "warning").length, critical: exceptions.filter(e => e.severity === "critical").length }, blockedCashMinorUnitsByCurrency: blockedCash, blockedSecuritiesUnitsByInstrument: blockedSecurities, settlementReadiness: { ready: readyCount, eligible: output.filter(o => o.status !== "settled").length } },
  };
}
