import { describe, expect, it } from "vitest";
import { cascadeBaselineProjection, fullFundingScenario, partialFundingScenario } from "../../src/contracts/fixtures";
import { GET as workspace } from "../../src/app/api/datasets/[datasetId]/workspace/route";
import { GET as twin } from "../../src/app/api/datasets/[datasetId]/twin/route";
import { POST as simulate } from "../../src/app/api/datasets/[datasetId]/simulations/route";

const context = { params: Promise.resolve({ datasetId: "dataset-cascade" }) };
const post = (body: unknown) => simulate(new Request("http://localhost/api/datasets/dataset-cascade/simulations", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), context);

describe("fixture-backed simulation API", () => {
  it("serves workspace details and an engine-derived baseline", async () => {
    const workspaceResponse = await workspace(new Request("http://localhost/api/datasets/dataset-cascade/workspace"), context);
    const workspaceBody = await workspaceResponse.json();
    expect(workspaceBody.ok).toBe(true);
    expect(workspaceBody.data.dataset.revision).toBe("1");
    expect(workspaceBody.data.accounts).toHaveLength(5);
    const twinResponse = await twin(new Request("http://localhost/api/datasets/dataset-cascade/twin?snapshotId=snapshot-cascade-1"), context);
    const twinBody = await twinResponse.json();
    expect(twinBody.data.projection).toEqual(cascadeBaselineProjection);
    expect(twinBody.meta).toMatchObject({ contractVersion: "1.0.0", datasetRevision: "1" });
  });

  it("runs both scenarios with real comparisons and leaves workspace state intact", async () => {
    const full = await (await post(fullFundingScenario)).json();
    const partial = await (await post(partialFundingScenario)).json();
    expect(full.ok).toBe(true);
    expect(full.data.result.baseline).toEqual(cascadeBaselineProjection);
    expect(full.data.result.contractVersion).toBe(full.meta.contractVersion);
    expect(full.data).not.toHaveProperty("auditEventId");
    expect(full.data.result.comparison.newlySettledObligationIds).toHaveLength(3);
    expect(partial.data.result.comparison.stillBlockedObligationIds).toHaveLength(3);
    expect(full.data.result.projected.cashBalances.reduce((sum: bigint, b: { settledMinorUnits: string }) => sum + BigInt(b.settledMinorUnits), 0n)).toBe(11000n);
    const after = await (await workspace(new Request("http://localhost/api/datasets/dataset-cascade/workspace"), context)).json();
    expect(after.data.snapshot.cashBalances.find((b: { accountId: string }) => b.accountId === "acct-reserve").settledMinorUnits).toBe("2000");
  });

  it("replays an identical result for equivalent JSON requests", async () => {
    const first = await (await post(fullFundingScenario)).json();
    const second = await (await post({
      interventions: fullFundingScenario.interventions.map(({ amount, ...rest }) => ({ ...rest, amount: { minorUnits: amount.minorUnits, currency: amount.currency } })),
      baseSnapshotId: fullFundingScenario.baseSnapshotId,
      expectedDatasetRevision: fullFundingScenario.expectedDatasetRevision,
      datasetId: fullFundingScenario.datasetId,
      contractVersion: fullFundingScenario.contractVersion,
    })).json();
    expect(second.data.result).toEqual(first.data.result);
    expect(first.data.result.createdAt).toBe("2026-10-09T13:00:00Z");
  });

  it("rejects stale revisions and returns invalid interventions without projected outcomes", async () => {
    const stale = await post({ ...fullFundingScenario, expectedDatasetRevision: "2" });
    expect(stale.status).toBe(409);
    const invalid = await (await post({ ...fullFundingScenario, interventions: [{ ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "3000" } }] })).json();
    expect(invalid.data.result.status).toBe("invalid");
    expect(invalid.data.result.projected).toBeUndefined();
    expect(invalid.data.result.comparison).toBeUndefined();
    expect(invalid.data.result.validationIssues[0].code).toBe("INSUFFICIENT_AVAILABLE_CASH");
  });

  it("reports request, version, dataset, and snapshot errors with the shared envelope", async () => {
    const cases: [unknown, number, string][] = [
      [{ ...fullFundingScenario, contractVersion: "2.0.0" }, 400, "UNSUPPORTED_CONTRACT_VERSION"],
      [{ datasetId: "dataset-cascade" }, 400, "INVALID_REQUEST"],
      [{ ...fullFundingScenario, datasetId: "wrong" }, 400, "INVALID_REQUEST"],
      [{ ...fullFundingScenario, baseSnapshotId: "wrong" }, 404, "NOT_FOUND"],
      [{ ...fullFundingScenario, interventions: [{ ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "01" } }] }, 400, "INVALID_REQUEST"],
      [{ ...fullFundingScenario, interventions: [] }, 400, "INVALID_REQUEST"],
    ];
    for (const [body, status, code] of cases) {
      const response = await post(body);
      expect(response.status).toBe(status);
      const payload = await response.json();
      expect(payload).toMatchObject({ ok: false, error: { code }, meta: { contractVersion: "1.0.0" } });
    }
    const missing = await simulate(new Request("http://localhost/api/datasets/dataset-cascade/simulations", { method: "POST", body: "{" }), context);
    expect((await missing.json()).error.code).toBe("INVALID_REQUEST");
    const unknown = await simulate(new Request("http://localhost/api/datasets/unknown/simulations", { method: "POST", body: JSON.stringify({ ...fullFundingScenario, datasetId: "unknown" }) }), { params: Promise.resolve({ datasetId: "unknown" }) });
    expect(unknown.status).toBe(404);
  });

  it("checks twin and workspace query errors without changing the fixture", async () => {
    const queryCases = [
      [twin, "twin?contractVersion=2.0.0", 400, "UNSUPPORTED_CONTRACT_VERSION"],
      [twin, "twin?snapshotId=missing", 404, "NOT_FOUND"],
      [workspace, "workspace?contractVersion=2.0.0", 400, "UNSUPPORTED_CONTRACT_VERSION"],
    ] as const;
    for (const [handler, path, status, code] of queryCases) {
      const response = await handler(new Request(`http://localhost/api/datasets/dataset-cascade/${path}`), context);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ ok: false, error: { code }, meta: { contractVersion: "1.0.0" } });
    }
    const after = await (await twin(new Request("http://localhost/api/datasets/dataset-cascade/twin"), context)).json();
    expect(after.data.projection).toEqual(cascadeBaselineProjection);
  });
});
