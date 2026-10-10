import { CONTRACT_VERSION } from "../../contracts";
import type {
  Account, CashBalance, DecimalInteger, Dependency, FinancialReasonCode,
  FinancialSnapshot, Instrument, Intervention, InterventionValidationCode,
  Obligation, ProjectedObligation, RunSimulationRequest, SecuritiesBalance,
  SimulationComparison, SimulationResult, TwinProjection, ValidationIssue,
} from "../../contracts";

export const SIMULATION_MODEL_VERSION = "1.0.0";

/** Local extensions until the shared v1 contract exposes these intervention kinds. */
export type SecurityTransferIntervention = {
  id: string; datasetId: string; baseSnapshotId: string;
  expectedDatasetRevision: DecimalInteger; rationale: string;
  kind: "security_transfer"; sourceAccountId: string; targetAccountId: string;
  instrumentId: string; units: DecimalInteger; effectiveAt: string;
};
export type DeferralIntervention = {
  id: string; datasetId: string; baseSnapshotId: string;
  expectedDatasetRevision: DecimalInteger; rationale: string;
  kind: "settlement_deferral"; obligationId: string; deferUntil: string;
};
export type SimulationIntervention = Intervention | SecurityTransferIntervention | DeferralIntervention;
export type SimulationRequest = Omit<RunSimulationRequest, "interventions"> & {
  interventions: [SimulationIntervention, ...SimulationIntervention[]];
};
/** A cash and security leg must settle together, or neither may settle. */
export interface DvpPair { cashObligationId: string; securityObligationId: string }
export interface SimulationInput {
  request: SimulationRequest;
  snapshot: FinancialSnapshot;
  accounts: Account[];
  instruments: Instrument[];
  dependencies: Dependency[];
  dvpPairs?: DvpPair[];
  /** Explicit replay horizon, defaulting to the latest obligation due time. */
  horizonAt?: string;
  resultId: string;
  createdAt: string;
}

type Ledger = { settled: bigint; reserved: bigint };
type State = { cash: Map<string, Ledger>; securities: Map<string, Ledger> };
type Event = { at: string; kind: "cash_transfer" | "security_transfer"; intervention: SimulationIntervention };
class AllocationError extends Error {
  constructor(readonly code: InterventionValidationCode) { super("Inventory double allocation"); }
}
const integerPattern = /^(0|[1-9][0-9]*)$/;
const timestampPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const cashKey = (account: string, currency: string) => `${account}\u0000${currency}`;
const securityKey = (account: string, instrument: string) => `${account}\u0000${instrument}`;
const decimal = (value: unknown, name: string): bigint => {
  if (typeof value !== "string" || !integerPattern.test(value)) throw new Error(`Invalid ${name}: expected canonical nonnegative integer`);
  return BigInt(value);
};
const timestamp = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !timestampPattern.test(value) || Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`Invalid ${name}: expected UTC ISO timestamp`);
  }
  return value;
};
const time = (value: string) => Date.parse(value);
const available = (entry?: Ledger) => entry ? entry.settled - entry.reserved : 0n;
const copyState = (state: State): State => ({
  cash: new Map([...state.cash].map(([key, value]) => [key, { ...value }])),
  securities: new Map([...state.securities].map(([key, value]) => [key, { ...value }])),
});
const issue = (code: InterventionValidationCode, message: string, field?: string, entityId?: string): ValidationIssue<InterventionValidationCode> => ({ code, message, ...(field && { field }), ...(entityId && { entityId }) });

function prepare(input: SimulationInput): { state: State; obligations: Map<string, Obligation>; predecessors: Map<string, string[]>; pairs: Map<string, string>; horizon: string } {
  const { snapshot, request, accounts, instruments, dependencies } = input;
  timestamp(snapshot.asOf, "snapshot.asOf");
  const horizon = timestamp(input.horizonAt ?? snapshot.obligations.reduce((latest, obligation) => time(obligation.dueAt) > time(latest) ? obligation.dueAt : latest, snapshot.asOf), "horizonAt");
  if (time(horizon) < time(snapshot.asOf)) throw new Error("Horizon precedes snapshot");
  if (snapshot.datasetId !== request.datasetId) throw new Error("Snapshot belongs to another dataset");
  decimal(snapshot.datasetRevision, "snapshot.datasetRevision");
  const accountIds = new Set(accounts.map(a => a.id));
  const instrumentIds = new Set(instruments.map(i => i.id));
  if (accountIds.size !== accounts.length || instrumentIds.size !== instruments.length) throw new Error("Duplicate account or instrument ID");
  if (accounts.some(a => a.datasetId !== request.datasetId) || instruments.some(i => i.datasetId !== request.datasetId)) throw new Error("Cross-dataset account or instrument");
  if (instruments.some(i => !Number.isInteger(i.quantityScale) || i.quantityScale < 0)) throw new Error("Invalid quantity scale");
  const state: State = { cash: new Map(), securities: new Map() };
  for (const balance of snapshot.cashBalances) {
    if (!accountIds.has(balance.accountId)) throw new Error("Unknown cash balance account");
    const key = cashKey(balance.accountId, balance.currency);
    if (state.cash.has(key)) throw new Error("Duplicate cash balance");
    const settled = decimal(balance.settledMinorUnits, "settledMinorUnits");
    const reserved = decimal(balance.reservedMinorUnits, "reservedMinorUnits");
    if (reserved > settled) throw new Error("Cash reservation exceeds settled balance");
    state.cash.set(key, { settled, reserved });
  }
  for (const balance of snapshot.securitiesBalances) {
    if (!accountIds.has(balance.accountId) || !instrumentIds.has(balance.instrumentId)) throw new Error("Unknown security balance reference");
    const key = securityKey(balance.accountId, balance.instrumentId);
    if (state.securities.has(key)) throw new Error("Duplicate security balance");
    const settled = decimal(balance.settledUnits, "settledUnits");
    const reserved = decimal(balance.reservedUnits, "reservedUnits");
    if (reserved > settled) throw new Error("Security reservation exceeds settled balance");
    state.securities.set(key, { settled, reserved });
  }
  const obligations = new Map<string, Obligation>();
  for (const obligation of snapshot.obligations) {
    if (obligations.has(obligation.id) || obligation.datasetId !== request.datasetId || !accountIds.has(obligation.fromAccountId) || !accountIds.has(obligation.toAccountId)) throw new Error("Invalid obligation identity or account");
    if (obligation.asset.kind === "security" && !instrumentIds.has(obligation.asset.instrumentId)) throw new Error("Unknown obligation instrument");
    const required = decimal(obligation.requiredUnits, "requiredUnits");
    if (decimal(obligation.settledUnits, "settledUnits") > required) throw new Error("Obligation over-settled");
    timestamp(obligation.dueAt, "obligation.dueAt");
    obligations.set(obligation.id, obligation);
  }
  const predecessors = new Map([...obligations.keys()].map(id => [id, [] as string[]]));
  for (const dependency of dependencies) {
    if (dependency.datasetId !== request.datasetId || !obligations.has(dependency.predecessorObligationId) || !obligations.has(dependency.successorObligationId)) throw new Error("Invalid dependency reference");
    predecessors.get(dependency.successorObligationId)!.push(dependency.predecessorObligationId);
  }
  for (const list of predecessors.values()) list.sort();
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of predecessors.get(id)!) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  for (const id of obligations.keys()) visit(id);
  const pairs = new Map<string, string>();
  for (const pair of input.dvpPairs ?? []) {
    const cash = obligations.get(pair.cashObligationId), security = obligations.get(pair.securityObligationId);
    if (!cash || !security || cash.asset.kind !== "cash" || security.asset.kind !== "security" || pairs.has(cash.id) || pairs.has(security.id)) throw new Error("Invalid DvP pair");
    if (cash.fromAccountId !== security.toAccountId || cash.toAccountId !== security.fromAccountId) throw new Error("DvP accounts must be opposite");
    if (predecessors.get(cash.id)!.includes(security.id) || predecessors.get(security.id)!.includes(cash.id)) throw new Error("DvP legs cannot depend on each other");
    if (cash.status === "cancelled" || security.status === "cancelled" ||
      (cash.status === "settled") !== (security.status === "settled") ||
      (BigInt(cash.settledUnits) > 0n) !== (BigInt(security.settledUnits) > 0n)) {
      throw new Error("DvP legs must share completion state");
    }
    pairs.set(cash.id, security.id); pairs.set(security.id, cash.id);
  }
  return { state, obligations, predecessors, pairs, horizon };
}

function validate(input: SimulationInput, prepared: ReturnType<typeof prepare>): ValidationIssue<InterventionValidationCode>[] {
  const { request, snapshot } = input;
  const issues: ValidationIssue<InterventionValidationCode>[] = [];
  if (request.expectedDatasetRevision !== snapshot.datasetRevision) issues.push(issue("DATASET_REVISION_MISMATCH", "Dataset revision differs from snapshot", "expectedDatasetRevision"));
  if (request.baseSnapshotId !== snapshot.id) issues.push(issue("SNAPSHOT_MISMATCH", "Base snapshot ID differs", "baseSnapshotId"));
  if (request.contractVersion !== CONTRACT_VERSION) issues.push(issue("POLICY_CONSTRAINT", "Unsupported contract version", "contractVersion"));
  if (!Array.isArray(request.interventions) || request.interventions.length === 0) issues.push(issue("POLICY_CONSTRAINT", "At least one intervention is required", "interventions"));
  const accounts = new Map(input.accounts.map(account => [account.id, account]));
  const instruments = new Set(input.instruments.map(instrument => instrument.id));
  const allocatedCash = new Map<string, bigint>(), allocatedSecurities = new Map<string, bigint>();
  const cashClaims = new Map<string, number>(), securitiesClaims = new Map<string, number>();
  const ids = new Set<string>();
  const priorityEdges: [string, string][] = [];
  const deferred = new Set<string>();
  for (const [index, intervention] of (request.interventions ?? []).entries()) {
    const field = `interventions[${index}]`;
    if (!intervention || typeof intervention !== "object") {
      issues.push(issue("POLICY_CONSTRAINT", "Intervention must be an object", field));
      continue;
    }
    if (!intervention || typeof intervention.id !== "string" || !intervention.id || ids.has(intervention.id)) issues.push(issue("INTERVENTION_CONFLICT", "Intervention IDs must be unique and nonempty", `${field}.id`));
    else ids.add(intervention.id);
    if (intervention.datasetId !== request.datasetId || intervention.baseSnapshotId !== snapshot.id) issues.push(issue("SNAPSHOT_MISMATCH", "Intervention dataset or snapshot differs", field, intervention.id));
    if (intervention.expectedDatasetRevision !== snapshot.datasetRevision) issues.push(issue("DATASET_REVISION_MISMATCH", "Intervention revision differs", field, intervention.id));
    if (intervention.kind === "cash_transfer" || intervention.kind === "security_transfer") {
      const source = accounts.get(intervention.sourceAccountId), target = accounts.get(intervention.targetAccountId);
      if (!source || !target) issues.push(issue("ACCOUNT_NOT_FOUND", "Transfer account not found", field, intervention.id));
      else if (source.id === target.id || source.status !== "open" || target.status !== "open" ||
        (intervention.kind === "cash_transfer" && (source.kind === "securities" || target.kind === "securities")) ||
        (intervention.kind === "security_transfer" && (source.kind === "cash" || target.kind === "cash"))) issues.push(issue("POLICY_CONSTRAINT", "Transfer requires distinct open accounts that support the asset", field, intervention.id));
      let amount = 0n;
      try { amount = decimal(intervention.kind === "cash_transfer" ? intervention.amount?.minorUnits : intervention.units, "transfer amount"); if (amount === 0n) throw new Error(); }
      catch { issues.push(issue("POLICY_CONSTRAINT", "Transfer amount must be a positive canonical integer", field, intervention.id)); }
      try { if (time(timestamp(intervention.effectiveAt, "effectiveAt")) < time(snapshot.asOf) || time(intervention.effectiveAt) > time(prepared.horizon)) issues.push(issue("POLICY_CONSTRAINT", "Transfer time is outside simulation window", `${field}.effectiveAt`, intervention.id)); }
      catch { issues.push(issue("POLICY_CONSTRAINT", "Invalid transfer time", `${field}.effectiveAt`, intervention.id)); }
      if (intervention.kind === "cash_transfer") {
        if (typeof intervention.amount?.currency !== "string" || !intervention.amount.currency) issues.push(issue("CURRENCY_MISMATCH", "Transfer currency is required", `${field}.amount.currency`, intervention.id));
        if (source && target && amount > 0n) {
          const key = cashKey(source.id, intervention.amount.currency);
          if (!prepared.state.cash.has(key)) issues.push(issue("CURRENCY_MISMATCH", "Source account has no balance in the transfer currency", field, intervention.id));
          allocatedCash.set(key, (allocatedCash.get(key) ?? 0n) + amount);
          cashClaims.set(key, (cashClaims.get(key) ?? 0) + 1);
        }
      } else {
        if (!instruments.has(intervention.instrumentId)) issues.push(issue("POLICY_CONSTRAINT", "Transfer instrument not found", `${field}.instrumentId`, intervention.id));
        if (source && target && amount > 0n) {
          const key = securityKey(source.id, intervention.instrumentId);
          allocatedSecurities.set(key, (allocatedSecurities.get(key) ?? 0n) + amount);
          securitiesClaims.set(key, (securitiesClaims.get(key) ?? 0) + 1);
        }
      }
    } else if (intervention.kind === "settlement_deferral") {
      const obligation = prepared.obligations.get(intervention.obligationId);
      if (!obligation) issues.push(issue("OBLIGATION_NOT_FOUND", "Deferred obligation not found", field, intervention.id));
      else if (obligation.status === "cancelled" || obligation.status === "settled" || deferred.has(obligation.id)) issues.push(issue("INTERVENTION_CONFLICT", "Obligation cannot be deferred twice or after completion", field, intervention.id));
      deferred.add(intervention.obligationId);
      try { if (time(timestamp(intervention.deferUntil, "deferUntil")) <= time(obligation?.dueAt ?? snapshot.asOf)) issues.push(issue("POLICY_CONSTRAINT", "Deferral must follow contractual due time", `${field}.deferUntil`, intervention.id)); }
      catch { issues.push(issue("POLICY_CONSTRAINT", "Invalid deferral time", `${field}.deferUntil`, intervention.id)); }
    } else if (intervention.kind === "settlement_priority") {
      if (!prepared.obligations.has(intervention.obligationId) || !prepared.obligations.has(intervention.aheadOfObligationId)) issues.push(issue("OBLIGATION_NOT_FOUND", "Priority obligation not found", field, intervention.id));
      else if (intervention.obligationId === intervention.aheadOfObligationId) issues.push(issue("INVALID_SETTLEMENT_ORDER", "Priority obligations must differ", field, intervention.id));
      else priorityEdges.push([intervention.obligationId, intervention.aheadOfObligationId]);
    } else issues.push(issue("POLICY_CONSTRAINT", "Unknown intervention kind", `${field}.kind`));
  }
  for (const [key, amount] of allocatedCash) if (amount > available(prepared.state.cash.get(key))) issues.push(issue((cashClaims.get(key) ?? 0) > 1 ? "DUPLICATE_RESOURCE_ALLOCATION" : "INSUFFICIENT_AVAILABLE_CASH", "Transfers overallocate source cash", "interventions", key.split("\u0000")[0]));
  for (const [key, amount] of allocatedSecurities) if (amount > available(prepared.state.securities.get(key))) issues.push(issue((securitiesClaims.get(key) ?? 0) > 1 ? "DUPLICATE_RESOURCE_ALLOCATION" : "INSUFFICIENT_AVAILABLE_SECURITIES", "Transfers overallocate source securities", "interventions", key.split("\u0000")[0]));
  const edges = new Map([...prepared.predecessors].map(([id, parents]) => [id, [...parents]]));
  for (const [before, after] of priorityEdges) edges.get(after)!.push(before);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const parent of edges.get(id)!) if (visit(parent)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if ([...edges.keys()].some(visit)) issues.push(issue("INVALID_SETTLEMENT_ORDER", "Priority order conflicts with dependencies", "interventions"));
  return issues;
}

function move(state: State, kind: "cash" | "security", from: string, to: string, asset: string, amount: bigint): void {
  const balances = kind === "cash" ? state.cash : state.securities;
  const key = kind === "cash" ? cashKey : securityKey;
  const sourceKey = key(from, asset), targetKey = key(to, asset);
  const source = balances.get(sourceKey), target = balances.get(targetKey);
  if (amount > available(source)) throw new AllocationError(kind === "cash" ? "INSUFFICIENT_AVAILABLE_CASH" : "INSUFFICIENT_AVAILABLE_SECURITIES");
  if (source) source.settled -= amount;
  if (target) target.settled += amount;
  else balances.set(targetKey, { settled: amount, reserved: 0n });
}

function project(input: SimulationInput, prepared: ReturnType<typeof prepare>, interventions: SimulationIntervention[]): TwinProjection {
  const state = copyState(prepared.state);
  const settled = new Map([...prepared.obligations].map(([id, obligation]) => [id, BigInt(obligation.settledUnits)]));
  const statuses = new Map<string, ProjectedObligation>();
  const priority = new Map<string, Set<string>>();
  const deferred = new Map<string, string>();
  const events: Event[] = [];
  for (const intervention of interventions) {
    if (intervention.kind === "settlement_priority") {
      const set = priority.get(intervention.aheadOfObligationId) ?? new Set<string>(); set.add(intervention.obligationId); priority.set(intervention.aheadOfObligationId, set);
    } else if (intervention.kind === "settlement_deferral") deferred.set(intervention.obligationId, intervention.deferUntil);
    else events.push({ at: intervention.effectiveAt, kind: intervention.kind, intervention });
  }
  events.sort((a, b) => time(a.at) - time(b.at) || a.intervention.id.localeCompare(b.intervention.id));
  const obligations = [...prepared.obligations.values()];
  const rank = new Map<string, number>();
  const visit = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    const parents = [...prepared.predecessors.get(id)!, ...(priority.get(id) ?? [])];
    const value = parents.length ? 1 + Math.max(...parents.map(visit)) : 0;
    rank.set(id, value); return value;
  };
  for (const obligation of obligations) visit(obligation.id);
  obligations.sort((a, b) => (rank.get(a.id)! - rank.get(b.id)!) || time(a.dueAt) - time(b.dueAt) || a.id.localeCompare(b.id));
  const points = new Set<number>([time(prepared.horizon), ...events.map(e => time(e.at)), ...obligations.map(o => time(o.dueAt)), ...[...deferred.values()].map(time)].filter(t => t >= time(input.snapshot.asOf) && t <= time(prepared.horizon)));
  const orderedPoints = [...points].sort((a, b) => a - b);
  let eventIndex = 0;
  for (const now of orderedPoints) {
    while (eventIndex < events.length && time(events[eventIndex].at) <= now) {
      const event = events[eventIndex++], transfer = event.intervention;
      if (transfer.kind === "cash_transfer") move(state, "cash", transfer.sourceAccountId, transfer.targetAccountId, transfer.amount.currency, BigInt(transfer.amount.minorUnits));
      else if (transfer.kind === "security_transfer") move(state, "security", transfer.sourceAccountId, transfer.targetAccountId, transfer.instrumentId, BigInt(transfer.units));
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const obligation of obligations) {
        if (statuses.get(obligation.id)?.status === "settled" || obligation.status === "cancelled" || obligation.status === "settled" || now < time(obligation.dueAt) || now < time(deferred.get(obligation.id) ?? obligation.dueAt)) continue;
        const partnerId = prepared.pairs.get(obligation.id);
        const group = partnerId ? [obligation, prepared.obligations.get(partnerId)!] : [obligation];
        if (group.some(o => statuses.get(o.id)?.status === "settled" || now < time(o.dueAt) || now < time(deferred.get(o.id) ?? o.dueAt))) continue;
        if (group.some(o => prepared.predecessors.get(o.id)!.some(parent => settled.get(parent)! < BigInt(prepared.obligations.get(parent)!.requiredUnits)))) continue;
        const claims = new Map<string, bigint>();
        for (const leg of group) {
          const key = leg.asset.kind === "cash" ? `c:${cashKey(leg.fromAccountId, leg.asset.currency)}` : `s:${securityKey(leg.fromAccountId, leg.asset.instrumentId)}`;
          claims.set(key, (claims.get(key) ?? 0n) + BigInt(leg.requiredUnits) - settled.get(leg.id)!);
        }
        if ([...claims].some(([key, amount]) => amount > available(key.startsWith("c:") ? state.cash.get(key.slice(2)) : state.securities.get(key.slice(2))))) continue;
        for (const leg of group) {
          const amount = BigInt(leg.requiredUnits) - settled.get(leg.id)!;
          if (amount > 0n) {
            if (leg.asset.kind === "cash") move(state, "cash", leg.fromAccountId, leg.toAccountId, leg.asset.currency, amount);
            else move(state, "security", leg.fromAccountId, leg.toAccountId, leg.asset.instrumentId, amount);
          }
          settled.set(leg.id, BigInt(leg.requiredUnits));
          statuses.set(leg.id, { obligationId: leg.id, status: "settled", reasonCodes: [], settledUnits: leg.requiredUnits, projectedSettlementAt: new Date(now).toISOString() });
        }
        changed = true;
      }
    }
  }
  for (const obligation of obligations) {
    if (statuses.has(obligation.id)) continue;
    if (obligation.status === "cancelled" || obligation.status === "settled") {
      statuses.set(obligation.id, { obligationId: obligation.id, status: obligation.status, reasonCodes: [], settledUnits: obligation.settledUnits }); continue;
    }
    const blockedByParent = prepared.predecessors.get(obligation.id)!.some(parent => settled.get(parent)! < BigInt(prepared.obligations.get(parent)!.requiredUnits));
    const partner = prepared.pairs.get(obligation.id);
    const blockedByPair = partner && (prepared.predecessors.get(partner)!.some(parent => settled.get(parent)! < BigInt(prepared.obligations.get(parent)!.requiredUnits)));
    let reasonCodes: FinancialReasonCode[] = [];
    if (blockedByParent || blockedByPair) reasonCodes = ["UPSTREAM_SETTLEMENT_BLOCKED"];
    else if (partner && (time(deferred.get(partner) ?? prepared.obligations.get(partner)!.dueAt) > time(prepared.horizon))) reasonCodes = ["POLICY_CONSTRAINT"];
    else if (time(deferred.get(obligation.id) ?? obligation.dueAt) > time(prepared.horizon)) reasonCodes = ["POLICY_CONSTRAINT"];
    else {
      const group = partner ? [obligation, prepared.obligations.get(partner)!] : [obligation];
      for (const leg of group) {
        const balance = leg.asset.kind === "cash" ? state.cash.get(cashKey(leg.fromAccountId, leg.asset.currency)) : state.securities.get(securityKey(leg.fromAccountId, leg.asset.instrumentId));
        if (available(balance) < BigInt(leg.requiredUnits) - settled.get(leg.id)!) reasonCodes.push(leg.asset.kind === "cash" ? "CASH_SHORTFALL" : "SECURITIES_SHORTFALL");
      }
      reasonCodes = [...new Set(reasonCodes)];
    }
    statuses.set(obligation.id, { obligationId: obligation.id, status: reasonCodes.length ? "blocked" : "pending", reasonCodes, settledUnits: settled.get(obligation.id)!.toString() as DecimalInteger });
  }
  const cashBalances: CashBalance[] = [...state.cash].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    const [accountId, currency] = key.split("\u0000"); return { accountId, currency, settledMinorUnits: value.settled.toString() as DecimalInteger, reservedMinorUnits: value.reserved.toString() as DecimalInteger };
  });
  const securitiesBalances: SecuritiesBalance[] = [...state.securities].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    const [accountId, instrumentId] = key.split("\u0000"); return { accountId, instrumentId, settledUnits: value.settled.toString() as DecimalInteger, reservedUnits: value.reserved.toString() as DecimalInteger };
  });
  return { datasetId: input.request.datasetId, snapshotId: input.snapshot.id, asOf: input.snapshot.asOf,
    obligations: [...statuses.values()].sort((a, b) => a.obligationId.localeCompare(b.obligationId)),
    dependencies: [...input.dependencies].sort((a, b) => a.id.localeCompare(b.id)), cashBalances, securitiesBalances };
}

function compare(baseline: TwinProjection, projected: TwinProjection): SimulationComparison {
  const before = new Map(baseline.obligations.map(o => [o.obligationId, o]));
  return {
    newlySettledObligationIds: projected.obligations.filter(o => o.status === "settled" && before.get(o.obligationId)?.status !== "settled").map(o => o.obligationId),
    stillBlockedObligationIds: projected.obligations.filter(o => o.status === "blocked" && before.get(o.obligationId)?.status === "blocked").map(o => o.obligationId),
    newlyAtRiskObligationIds: projected.obligations.filter(o => o.status === "at_risk" && before.get(o.obligationId)?.status !== "at_risk").map(o => o.obligationId),
    blockedCountBefore: baseline.obligations.filter(o => o.status === "blocked").length,
    blockedCountAfter: projected.obligations.filter(o => o.status === "blocked").length,
  };
}

/** Pure replay. Invalid interventions include a baseline but never a projected outcome. */
export function projectSettlementBaseline(input: SimulationInput): TwinProjection {
  return project(input, prepare(input), []);
}

export function simulateSettlement(input: SimulationInput): SimulationResult {
  const prepared = prepare(input);
  const baseline = project(input, prepared, []);
  const validationIssues = validate(input, prepared);
  const common = { id: input.resultId, contractVersion: CONTRACT_VERSION, datasetId: input.request.datasetId,
    baseSnapshotId: input.snapshot.id, modelVersion: SIMULATION_MODEL_VERSION, createdAt: input.createdAt,
    interventionIds: (input.request.interventions ?? []).map(i => i.id), baseline };
  if (validationIssues.length) return { ...common, status: "invalid", validationIssues };
  let projected: TwinProjection;
  try {
    projected = project(input, prepared, input.request.interventions);
  } catch (error) {
    if (!(error instanceof AllocationError)) throw error;
    return { ...common, status: "invalid", validationIssues: [issue(error.code, "Intervention inventory was consumed by an earlier settlement", "interventions")] };
  }
  return { ...common, status: "valid", validationIssues: [], projected, comparison: compare(baseline, projected) };
}
