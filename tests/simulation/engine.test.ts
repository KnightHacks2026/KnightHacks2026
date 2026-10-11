import { describe, expect, it } from "vitest";
import { cascadeImport, cascadeSnapshot, fullFundingScenario, partialFundingScenario } from "../../src/contracts/fixtures/twin-cascade";
import type { Obligation } from "../../src/contracts";
import { simulateSettlement, type SimulationInput, type SimulationIntervention } from "../../src/lib/simulation";

function input(interventions: SimulationIntervention[] = fullFundingScenario.interventions): SimulationInput {
  return {
    request: { ...structuredClone(fullFundingScenario), interventions: structuredClone(interventions) as SimulationInput["request"]["interventions"] },
    snapshot: structuredClone(cascadeSnapshot),
    accounts: structuredClone(cascadeImport.accounts),
    instruments: structuredClone(cascadeImport.instruments),
    dependencies: structuredClone(cascadeImport.dependencies),
    resultId: "simulation-test", createdAt: "2026-10-09T13:00:00Z",
  };
}

const cash = (projection: NonNullable<ReturnType<typeof simulateSettlement>["baseline"]>, accountId: string) =>
  BigInt(projection.cashBalances.find(balance => balance.accountId === accountId && balance.currency === "USD")?.settledMinorUnits ?? "0");
const totalCash = (projection: NonNullable<ReturnType<typeof simulateSettlement>["baseline"]>) =>
  projection.cashBalances.reduce((sum, balance) => sum + BigInt(balance.settledMinorUnits), 0n);

describe("settlement simulation", () => {
  it("derives the cascade baseline and fully funded settlement without mutating the snapshot", () => {
    const data = input();
    const original = structuredClone(data.snapshot);
    const result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.baseline.obligations.map(o => [o.obligationId, o.status, o.reasonCodes])).toEqual([
      ["obligation-1", "blocked", ["CASH_SHORTFALL"]],
      ["obligation-2", "blocked", ["UPSTREAM_SETTLEMENT_BLOCKED"]],
      ["obligation-3", "blocked", ["UPSTREAM_SETTLEMENT_BLOCKED"]],
    ]);
    expect(result.comparison).toEqual({ newlySettledObligationIds: ["obligation-1", "obligation-2", "obligation-3"], stillBlockedObligationIds: [], newlyAtRiskObligationIds: [], blockedCountBefore: 3, blockedCountAfter: 0 });
    expect(["acct-a", "acct-b", "acct-c", "acct-d", "acct-reserve"].map(id => cash(result.projected, id))).toEqual([0n, 0n, 0n, 10000000000n, 1000000000n]);
    expect(totalCash(result.baseline)).toBe(11000000000n);
    expect(totalCash(result.projected)).toBe(11000000000n);
    expect(data.snapshot).toEqual(original);
    expect(simulateSettlement(data)).toEqual(result);
  });

  it("leaves the cascade blocked after a partial transfer", () => {
    const data = input(partialFundingScenario.interventions);
    const result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.comparison.blockedCountAfter).toBe(3);
    expect(result.comparison.stillBlockedObligationIds).toEqual(["obligation-1", "obligation-2", "obligation-3"]);
    expect(cash(result.projected, "acct-a")).toBe(9500000000n);
  });

  it("rejects stale revisions, duplicate IDs, and aggregate double allocation without a projected state", () => {
    const data = input([
      { ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "1500000000" } },
      { ...fullFundingScenario.interventions[0], id: "second", amount: { currency: "USD", minorUnits: "1000000000" } },
    ]);
    data.request.expectedDatasetRevision = "2";
    const result = simulateSettlement(data);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.validationIssues.map(i => i.code)).toContain("DATASET_REVISION_MISMATCH");
    expect(result.validationIssues.map(i => i.code)).toContain("DUPLICATE_RESOURCE_ALLOCATION");
    expect("projected" in result).toBe(false);
  });

  it("respects reserved cash and rejects noncanonical or nonpositive amounts", () => {
    const data = input();
    data.snapshot.cashBalances.find(b => b.accountId === "acct-reserve")!.reservedMinorUnits = "1500000000";
    let result = simulateSettlement(data);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.validationIssues.map(i => i.code)).toContain("INSUFFICIENT_AVAILABLE_CASH");
    data.request.interventions[0] = { ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "01" as "1" } };
    result = simulateSettlement(data);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.validationIssues.map(i => i.code)).toContain("POLICY_CONSTRAINT");
  });

  it("moves security inventory exactly once and respects its reservations", () => {
    const transfer: SimulationIntervention = {
      id: "security-transfer", datasetId: "dataset-cascade", baseSnapshotId: "snapshot-cascade-1", expectedDatasetRevision: "1",
      rationale: "Move existing securities", kind: "security_transfer", sourceAccountId: "acct-a", targetAccountId: "acct-b",
      instrumentId: "instrument-demo", units: "10", effectiveAt: "2026-10-09T13:05:00Z",
    };
    const data = input([transfer]);
    data.accounts.find(a => a.id === "acct-b")!.kind = "omnibus";
    const result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.projected.securitiesBalances.map(b => [b.accountId, b.settledUnits])).toEqual([["acct-a", "15"], ["acct-b", "10"]]);
    data.snapshot.securitiesBalances[0].reservedUnits = "20";
    const invalid = simulateSettlement(data);
    expect(invalid.status).toBe("invalid");
    if (invalid.status === "invalid") expect(invalid.validationIssues.map(i => i.code)).toContain("INSUFFICIENT_AVAILABLE_SECURITIES");
  });

  it("settles DvP legs atomically when both inventories exist", () => {
    const data = input([{ ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "500000000" } }]);
    data.snapshot.obligations = [
      { ...data.snapshot.obligations[0], id: "cash-leg", fromAccountId: "acct-a", toAccountId: "acct-b", requiredUnits: "10000000000" },
      { ...data.snapshot.obligations[0], id: "security-leg", fromAccountId: "acct-b", toAccountId: "acct-a", asset: { kind: "security", instrumentId: "instrument-demo" }, requiredUnits: "20" },
    ];
    data.accounts.find(a => a.id === "acct-b")!.kind = "omnibus";
    data.snapshot.securitiesBalances = [{ accountId: "acct-b", instrumentId: "instrument-demo", settledUnits: "20", reservedUnits: "0" }];
    data.dependencies = [];
    data.dvpPairs = [{ cashObligationId: "cash-leg", securityObligationId: "security-leg" }];
    let result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.projected.obligations.map(o => o.status)).toEqual(["blocked", "blocked"]);
    expect(result.projected.obligations[0].reasonCodes).toContain("CASH_SHORTFALL");
    expect(result.projected.securitiesBalances[0].settledUnits).toBe("20");
    data.request.interventions[0] = fullFundingScenario.interventions[0];
    result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.projected.obligations.map(o => o.status)).toEqual(["settled", "settled"]);
    expect(result.projected.securitiesBalances.find(b => b.accountId === "acct-a")?.settledUnits).toBe("20");
    expect(result.projected.securitiesBalances.find(b => b.accountId === "acct-b")?.settledUnits).toBe("0");
    expect(result.projected.securitiesBalances.reduce((sum, b) => sum + BigInt(b.settledUnits), 0n)).toBe(20n);
  });

  it("rejects an inconsistent partially settled DvP snapshot", () => {
    const data = input();
    data.snapshot.obligations = [
      { ...data.snapshot.obligations[0], id: "cash-leg", settledUnits: "1" },
      { ...data.snapshot.obligations[0], id: "security-leg", asset: { kind: "security", instrumentId: "instrument-demo" }, fromAccountId: "acct-b", toAccountId: "acct-a", requiredUnits: "20" },
    ];
    data.dependencies = [];
    data.dvpPairs = [{ cashObligationId: "cash-leg", securityObligationId: "security-leg" }];
    expect(() => simulateSettlement(data)).toThrow("DvP legs must share completion state");
  });

  it("defers a predecessor, blocks successors, and rejects priority cycles", () => {
    const data = input([
      fullFundingScenario.interventions[0],
      { id: "defer-first", datasetId: "dataset-cascade", baseSnapshotId: "snapshot-cascade-1", expectedDatasetRevision: "1", rationale: "Scenario delay", kind: "settlement_deferral", obligationId: "obligation-1", deferUntil: "2026-10-09T15:00:00Z" },
    ]);
    let result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.projected.obligations.map(o => o.reasonCodes)).toEqual([["POLICY_CONSTRAINT"], ["UPSTREAM_SETTLEMENT_BLOCKED"], ["UPSTREAM_SETTLEMENT_BLOCKED"]]);
    data.request.interventions.push({ id: "reverse", datasetId: "dataset-cascade", baseSnapshotId: "snapshot-cascade-1", expectedDatasetRevision: "1", rationale: "Reverse chain", kind: "settlement_priority", obligationId: "obligation-3", aheadOfObligationId: "obligation-1" });
    result = simulateSettlement(data);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.validationIssues.map(i => i.code)).toContain("INVALID_SETTLEMENT_ORDER");
  });

  it("uses exact integer arithmetic above Number.MAX_SAFE_INTEGER", () => {
    const data = input();
    data.snapshot.obligations = data.snapshot.obligations.slice(0, 1).map((o): Obligation => ({ ...o, requiredUnits: "9007199254740993" }));
    data.dependencies = [];
    data.snapshot.cashBalances.find(b => b.accountId === "acct-a")!.settledMinorUnits = "9007199254740993";
    data.request.interventions[0] = { ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "1" } };
    const result = simulateSettlement(data);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.projected.obligations[0].settledUnits).toBe("9007199254740993");
    expect(totalCash(result.projected)).toBe(9007201254740993n);
  });

  it("rejects a transfer when an earlier settlement consumes its source cash", () => {
    const data = input();
    data.request.interventions = [{
      ...fullFundingScenario.interventions[0],
      sourceAccountId: "acct-a",
      targetAccountId: "acct-reserve",
      amount: { currency: "USD", minorUnits: "1000000000" },
      effectiveAt: "2026-10-09T14:10:00Z",
    }];
    data.snapshot.cashBalances.find(b => b.accountId === "acct-a")!.settledMinorUnits = "10000000000";
    const original = structuredClone(data.snapshot);
    const result = simulateSettlement(data);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.validationIssues.map(i => i.code)).toContain("INSUFFICIENT_AVAILABLE_CASH");
      expect("projected" in result).toBe(false);
    }
    expect(data.snapshot).toEqual(original);
  });
});
