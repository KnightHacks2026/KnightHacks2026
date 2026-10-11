import { describe, expect, it } from "vitest";
import type { RunSimulationRequest } from "../../src/contracts";
import { cascadeImport, fullFundingScenario, partialFundingScenario } from "../../src/contracts/fixtures";
import { baselineEvidence, custodyEvidence, explain, recommend, replayEvidence } from "../../src/lib/ai/intelligence";
import { getSimulationDataset } from "../../src/lib/simulation/dataset";
import { POST as explanationRoute } from "../../src/app/api/datasets/[datasetId]/explanations/route";
import { GET as recommendationsRoute } from "../../src/app/api/datasets/[datasetId]/recommendations/route";
import { POST as importRoute } from "../../src/app/api/datasets/import/route";
import { POST as simulationRoute } from "../../src/app/api/datasets/[datasetId]/simulations/route";
import { authenticatedRequest } from "../authenticated-request";

const context = { params: Promise.resolve({ datasetId: "dataset-cascade" }) };
const post = async (body: unknown, datasetId = "dataset-cascade") => explanationRoute(await authenticatedRequest(`http://localhost/api/datasets/${datasetId}/explanations`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ datasetId }) });

describe("grounded settlement intelligence", () => {
  it("explains exact cash shortfall and dependency cascade from source evidence", async () => {
    const source = (await getSimulationDataset("dataset-cascade"))!;
    const assessment = custodyEvidence(source);
    const baseline = baselineEvidence(source);
    const first = explain(source, { kind: "obligation", id: "obligation-1" }, assessment, baseline)!;
    expect(first.summary).toContain("available settled inventory at acct-a: 9000000000 USD minor units");
    expect(first.reasonCodes).toContain("CASH_SHORTFALL");
    expect(first.sourceRecordIds).toEqual(["source-1"]);
    const downstream = explain(source, { kind: "obligation", id: "obligation-3" }, assessment, baseline)!;
    expect(downstream.reasonCodes).toContain("UPSTREAM_SETTLEMENT_BLOCKED");
    expect(downstream.summary).toContain("Predecessors: obligation-2");
    const exception = explain(source, { kind: "exception", id: "custody:snapshot-cascade-1:obligation-1:CASH_SHORTFALL" }, assessment, baseline)!;
    expect(exception.reasonCodes).toEqual(["CASH_SHORTFALL"]);
  });

  it("reports only engine-derived scenario outcomes and deterministic fallback", async () => {
    const source = (await getSimulationDataset("dataset-cascade"))!;
    const result = replayEvidence(source, fullFundingScenario);
    const assessment = custodyEvidence(source), baseline = baselineEvidence(source);
    const explanation = explain(source, { kind: "simulation", id: result.id }, assessment, baseline, result)!;
    expect(explanation.model).toBe("deterministic-rules-v1");
    expect(explanation.summary).toContain("3 blocked obligations before and 0 after");
    expect(explanation.summary).toContain("obligation-1, obligation-2, obligation-3");
    expect(explanation).toMatchObject({ id: explain(source, { kind: "simulation", id: result.id }, assessment, baseline, result)?.id, summary: explain(source, { kind: "simulation", id: result.id }, assessment, baseline, result)?.summary });
    expect(Date.parse(explanation.generatedAt)).toBeGreaterThan(Date.parse(source.snapshot.asOf));
    const partial = replayEvidence(source, partialFundingScenario);
    expect(explain(source, { kind: "simulation", id: partial.id }, assessment, baseline, partial)?.summary).toContain("3 blocked obligations before and 3 after");
    expect(explain(source, { kind: "simulation", id: "forged" }, assessment, baseline, result)).toBeNull();
  });

  it("offers only feasible, verified interventions and does not mutate inventory", async () => {
    const source = (await getSimulationDataset("dataset-cascade"))!;
    const before = structuredClone(source.snapshot);
    const suggestions = recommend(source, baselineEvidence(source));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].intervention).toMatchObject({ kind: "cash_transfer", sourceAccountId: "acct-reserve", targetAccountId: "acct-a", amount: { currency: "USD", minorUnits: "1000000000" } });
    expect(suggestions[0].comparison.newlySettledObligationIds).toEqual(["obligation-1", "obligation-2", "obligation-3"]);
    expect(suggestions[0].requiresHumanReview).toBe(true);
    const projected = replayEvidence(source, { ...fullFundingScenario, interventions: [suggestions[0].intervention] });
    expect(projected.status).toBe("valid");
    if (projected.status === "valid") {
      const cashTotal = (balances: typeof source.snapshot.cashBalances) => balances.reduce((sum, balance) => sum + BigInt(balance.settledMinorUnits), 0n);
      expect(cashTotal(projected.projected.cashBalances)).toBe(cashTotal(source.snapshot.cashBalances));
    }
    expect(source.snapshot).toEqual(before);
    source.snapshot.cashBalances.find(item => item.accountId === "acct-reserve")!.reservedMinorUnits = "2000000000";
    expect(recommend(source, baselineEvidence(source))).toEqual([]);
    source.snapshot.cashBalances.find(item => item.accountId === "acct-reserve")!.reservedMinorUnits = "0";
    source.accounts.find(item => item.id === "acct-reserve")!.status = "restricted";
    expect(recommend(source, baselineEvidence(source))).toEqual([]);
    source.accounts.find(item => item.id === "acct-reserve")!.status = "open";
    source.sourceRecords.find(item => item.id === "source-1")!.amount!.minorUnits = "9000000000";
    expect(custodyEvidence(source).obligations.find(item => item.obligationId === "obligation-1")?.reasonCodes).toContain("AMOUNT_MISMATCH");
    expect(recommend(source, baselineEvidence(source))).toEqual([]);
  });

  it("suggests priority only when engine settlement and blocked-count evidence improves", async () => {
    const source = (await getSimulationDataset("dataset-cascade"))!;
    source.snapshot.cashBalances.find(item => item.accountId === "acct-a")!.settledMinorUnits = "10000000000";
    source.snapshot.cashBalances.find(item => item.accountId === "acct-reserve")!.settledMinorUnits = "0";
    const competing = { ...source.snapshot.obligations[0], id: "obligation-0", externalId: "competing", requiredUnits: "9000000000" as const, sourceRecordIds: ["source-competing"] };
    source.snapshot.obligations.push(competing);
    source.sourceRecords.push({ ...source.sourceRecords[0], id: "source-competing", externalId: "competing", amount: { currency: "USD", minorUnits: "9000000000" } });
    const baseline = baselineEvidence(source);
    expect(baseline.obligations.find(item => item.obligationId === "obligation-1")?.status).toBe("blocked");
    const suggestions = recommend(source, baseline);
    const priority = suggestions.find(item => item.kind === "settlement_priority" && item.intervention.kind === "settlement_priority" && item.intervention.obligationId === "obligation-1");
    expect(priority).toBeDefined();
    expect(priority?.comparison.newlySettledObligationIds).toEqual(expect.arrayContaining(["obligation-1", "obligation-2", "obligation-3"]));
    expect(priority!.comparison.blockedCountAfter).toBeLessThan(priority!.comparison.blockedCountBefore);
    expect(priority!.comparison.newlyAtRiskObligationIds).toEqual([]);
  });

  it("validates requests, missing data, stale revisions, and route errors", async () => {
    const body = { contractVersion: "1.0.0", datasetId: "dataset-cascade", subject: { kind: "obligation", id: "obligation-1" } };
    const good = await post(body);
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ ok: true, data: { explanation: { requiresHumanReview: true } }, meta: { datasetRevision: "1" } });
    const cases: [unknown, number, string][] = [
      [{ ...body, contractVersion: "2.0.0" }, 400, "UNSUPPORTED_CONTRACT_VERSION"],
      [{ ...body, subject: { kind: "obligation", id: "missing" } }, 404, "NOT_FOUND"],
      [{ ...body, datasetId: "wrong" }, 400, "INVALID_REQUEST"],
      [{ ...body, subject: { kind: "simulation", id: "fake" } }, 400, "INVALID_REQUEST"],
      [{ ...body, subject: { kind: "simulation", id: "fake" }, simulationRequest: { ...fullFundingScenario, expectedDatasetRevision: "2" } }, 409, "REVISION_CONFLICT"],
    ];
    for (const [input, status, code] of cases) {
      const response = await post(input);
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    const result = replayEvidence((await getSimulationDataset("dataset-cascade"))!, fullFundingScenario);
    const simulation = await post({ ...body, subject: { kind: "simulation", id: result.id }, simulationRequest: fullFundingScenario });
    expect((await simulation.json()).data.explanation.simulationResultId).toBe(result.id);
    const missing = await post({ ...body, datasetId: "unknown" }, "unknown");
    expect(missing.status).toBe(404);
    const recommendations = await recommendationsRoute(await authenticatedRequest("http://localhost/api/datasets/dataset-cascade/recommendations"), context);
    expect((await recommendations.json()).data.recommendations).toHaveLength(1);
    const invalidVersion = await recommendationsRoute(await authenticatedRequest("http://localhost/api/datasets/dataset-cascade/recommendations?contractVersion=2.0.0"), context);
    expect((await invalidVersion.json()).error.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
    const missingRecommendations = await recommendationsRoute(await authenticatedRequest("http://localhost/api/datasets/missing/recommendations"), { params: Promise.resolve({ datasetId: "missing" }) });
    expect(missingRecommendations.status).toBe(404);
    expect((await missingRecommendations.json()).error.code).toBe("NOT_FOUND");
    const malformed = await explanationRoute(await authenticatedRequest("http://localhost/api/datasets/dataset-cascade/explanations", { method: "POST", body: "{" }), context);
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects fabricated IDs and reports invalid interventions without projected outcomes", async () => {
    const body = { contractVersion: "1.0.0", datasetId: "dataset-cascade", subject: { kind: "simulation", id: "fabricated" }, simulationRequest: fullFundingScenario };
    const forged = await post(body);
    expect(forged.status).toBe(404);
    const oversized = { ...fullFundingScenario, interventions: [{ ...fullFundingScenario.interventions[0], amount: { currency: "USD", minorUnits: "3000000000" } }] };
    const simulation = await simulationRoute(await authenticatedRequest("http://localhost/api/datasets/dataset-cascade/simulations", { method: "POST", body: JSON.stringify(oversized) }), context);
    const result = (await simulation.json()).data.result;
    expect(result.status).toBe("invalid");
    const response = await post({ ...body, subject: { kind: "simulation", id: result.id }, simulationRequest: oversized });
    expect(response.status).toBe(200);
    const explanation = (await response.json()).data.explanation;
    expect(explanation.summary).toContain("INSUFFICIENT_AVAILABLE_CASH");
    expect(explanation.summary).toContain("No projected outcome exists");
    expect(explanation.summary).not.toContain("Newly settled");
    const mismatchedIntervention: RunSimulationRequest = { ...fullFundingScenario, interventions: [{ ...fullFundingScenario.interventions[0], datasetId: "elsewhere" }] };
    const mismatched = replayEvidence((await getSimulationDataset("dataset-cascade"))!, mismatchedIntervention);
    expect(mismatched.status).toBe("invalid");
    expect(mismatched.validationIssues.map(item => item.code)).toContain("SNAPSHOT_MISMATCH");
  });

  it("supports imported datasets and isolates their evidence and simulation IDs", async () => {
    const importedId = `ai-review-${crypto.randomUUID()}`;
    const imported = structuredClone(cascadeImport);
    imported.dataset.id = importedId;
    for (const key of ["institutions", "accounts", "instruments", "sourceRecords", "obligations", "dependencies"] as const) {
      for (const item of imported[key]) item.datasetId = importedId;
    }
    const importedResponse = await importRoute(await authenticatedRequest("http://localhost/api/datasets/import", { method: "POST", body: JSON.stringify(imported) }));
    expect(importedResponse.status).toBe(201);
    const snapshotId = (await importedResponse.json()).data.snapshotId as string;
    const importedContext = { params: Promise.resolve({ datasetId: importedId }) };
    const request = { ...fullFundingScenario, datasetId: importedId, baseSnapshotId: snapshotId, interventions: [{ ...fullFundingScenario.interventions[0], datasetId: importedId, baseSnapshotId: snapshotId }] };
    const explained = await post({ contractVersion: "1.0.0", datasetId: importedId, subject: { kind: "obligation", id: "obligation-1" } }, importedId);
    expect(explained.status).toBe(200);
    expect((await explained.json()).data.explanation.datasetId).toBe(importedId);
    const recommendationResponse = await recommendationsRoute(await authenticatedRequest(`http://localhost/api/datasets/${importedId}/recommendations`), importedContext);
    expect(recommendationResponse.status).toBe(200);
    expect((await recommendationResponse.json()).data.recommendations[0].intervention.datasetId).toBe(importedId);
    const simulated = await simulationRoute(await authenticatedRequest(`http://localhost/api/datasets/${importedId}/simulations`, { method: "POST", body: JSON.stringify(request) }), importedContext);
    const simulationId = (await simulated.json()).data.result.id as string;
    expect(simulationId).not.toBe(replayEvidence((await getSimulationDataset("dataset-cascade"))!, fullFundingScenario).id);
    const explainedSimulation = await post({ contractVersion: "1.0.0", datasetId: importedId, subject: { kind: "simulation", id: simulationId }, simulationRequest: request }, importedId);
    expect(explainedSimulation.status).toBe(200);
    const crossDataset = await post({ contractVersion: "1.0.0", datasetId: importedId, subject: { kind: "simulation", id: simulationId }, simulationRequest: fullFundingScenario }, importedId);
    expect(crossDataset.status).toBe(400);
    const stale = await post({ contractVersion: "1.0.0", datasetId: importedId, subject: { kind: "simulation", id: simulationId }, simulationRequest: { ...request, expectedDatasetRevision: "2" } }, importedId);
    expect(stale.status).toBe(409);
    const repeated = await post({ contractVersion: "1.0.0", datasetId: importedId, subject: { kind: "simulation", id: simulationId }, simulationRequest: request }, importedId);
    expect((await repeated.json()).data.explanation.summary).toBe((await explainedSimulation.json()).data.explanation.summary);
  });
});
