import type { GetTwinResponse, RunSimulationResponse, TwinProjection } from "@/contracts";
import { cascadeImport, fullFundingScenario, partialFundingScenario } from "@/contracts/fixtures";

export type SettlementScenario = "baseline" | "partial" | "full";
export const scenarioLabels: Record<SettlementScenario, string> = {
  baseline: "Baseline", partial: "Fund $5M", full: "Fund $10M",
};
export const legIds = ["obligation-1", "obligation-2", "obligation-3"] as const;
const millionMinorUnits = 100_000_000n;

function cash(projection: TwinProjection, accountId: string): bigint {
  const balance = projection.cashBalances.find(item => item.accountId === accountId && item.currency === "USD");
  if (!balance || !/^(0|[1-9]\d*)$/.test(balance.settledMinorUnits)) throw new Error("Simulation response is missing a valid USD cash balance.");
  return BigInt(balance.settledMinorUnits);
}

export type SettlementView = {
  projection: TwinProjection;
  fundedMinorUnits: bigint;
  requiredMinorUnits: bigint;
  gapMinorUnits: bigint;
  blocked: number;
  settled: number;
  statuses: ("settled" | "blocked")[];
  reasons: string[][];
  sequence: ("ready" | "root" | "leg1" | "flow12" | "leg2" | "flow23" | "leg3" | "complete")[];
};

export function mapSettlementProjection(baseline: TwinProjection, projected: TwinProjection): SettlementView {
  if (baseline.datasetId !== "dataset-cascade" || projected.datasetId !== baseline.datasetId || projected.snapshotId !== baseline.snapshotId) {
    throw new Error("Simulation response does not match the settlement dataset.");
  }
  const dependencies = projected.dependencies;
  if (dependencies.length !== 2 || !legIds.slice(0, 2).every((id, index) =>
    dependencies.some(edge => edge.predecessorObligationId === id && edge.successorObligationId === legIds[index + 1] && edge.kind === "settlement_proceeds"))) {
    throw new Error("Simulation response has an unexpected dependency path.");
  }
  const legs = legIds.map(id => {
    const leg = projected.obligations.find(item => item.obligationId === id);
    if (!leg || (leg.status !== "settled" && leg.status !== "blocked")) throw new Error("Simulation response has an unsupported obligation status.");
    return leg;
  });
  const root = cascadeImport.obligations.find(item => item.id === legIds[0]);
  if (!root) throw new Error("Settlement fixture is missing the root obligation.");
  const requiredMinorUnits = BigInt(root.requiredUnits);
  const fundedMinorUnits = cash(baseline, "acct-a") + cash(baseline, "acct-reserve") - cash(projected, "acct-reserve");
  if (fundedMinorUnits < 0n || fundedMinorUnits > requiredMinorUnits) throw new Error("Simulation response has inconsistent funding.");
  const sequence: SettlementView["sequence"] = ["root"];
  if (legs[0].status === "settled") sequence.push("leg1");
  sequence.push("flow12", "leg2", "flow23", "leg3", "complete");
  return {
    projection: projected, fundedMinorUnits, requiredMinorUnits,
    gapMinorUnits: requiredMinorUnits - fundedMinorUnits,
    blocked: legs.filter(leg => leg.status === "blocked").length,
    settled: legs.filter(leg => leg.status === "settled").length,
    statuses: legs.map(leg => leg.status as "settled" | "blocked"),
    reasons: legs.map(leg => leg.reasonCodes),
    sequence,
  };
}

export function millions(units: bigint): string {
  const whole = units / millionMinorUnits;
  const remainder = units % millionMinorUnits;
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(8, "0").replace(/0+$/, "")}`;
}

async function readResponse<T extends { ok: boolean }>(response: Response): Promise<T> {
  let payload: T;
  try { payload = await response.json() as T; }
  catch { throw new Error("The simulation service returned an unreadable response."); }
  if (!response.ok || !payload.ok) {
    const error = payload as { error?: { message?: string } };
    throw new Error(error.error?.message ?? `Simulation service failed (HTTP ${response.status}).`);
  }
  return payload;
}

export async function fetchSettlementScenario(scenario: SettlementScenario, signal?: AbortSignal): Promise<SettlementView> {
  if (scenario === "baseline") {
    const response = await fetch("/api/datasets/dataset-cascade/twin", { signal, cache: "no-store" });
    const payload = await readResponse<GetTwinResponse>(response);
    if (!payload.ok) throw new Error("Baseline projection unavailable.");
    return mapSettlementProjection(payload.data.projection, payload.data.projection);
  }
  const body = scenario === "partial" ? partialFundingScenario : fullFundingScenario;
  const response = await fetch("/api/datasets/dataset-cascade/simulations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal, cache: "no-store",
  });
  const payload = await readResponse<RunSimulationResponse>(response);
  if (!payload.ok) throw new Error("Simulation projection unavailable.");
  if (payload.data.result.status !== "valid") {
    throw new Error(payload.data.result.validationIssues.map(issue => issue.message).join(" ") || "The scenario is invalid.");
  }
  return mapSettlementProjection(payload.data.result.baseline, payload.data.result.projected);
}
