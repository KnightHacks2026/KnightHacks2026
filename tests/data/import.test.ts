import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { cascadeImport, fullFundingScenario } from "../../src/contracts/fixtures";
import { POST as importRoute } from "../../src/app/api/datasets/import/route";
import { GET as financialDataRoute } from "../../src/app/api/users/[userId]/financial-data/route";
import { GET as workspace } from "../../src/app/api/datasets/[datasetId]/workspace/route";
import { GET as twin } from "../../src/app/api/datasets/[datasetId]/twin/route";
import { POST as simulate } from "../../src/app/api/datasets/[datasetId]/simulations/route";
import { GET as custody } from "../../src/app/api/datasets/[datasetId]/custody/route";
import { POST as transfer } from "../../src/app/api/transfer/route";
import { getExampleData, getImportedDataset, saveExampleData } from "../../src/lib/data/repository";
import { exampleData } from "../../src/contracts";
import { authenticatedRequest } from "../authenticated-request";

const datasetId = `import-route-test-${crypto.randomUUID()}`;
const databasePath = process.env.CUSTODYOS_DATABASE_PATH;
if (!databasePath) throw new Error("Unit test database path was not provisioned.");
const context = { params: Promise.resolve({ datasetId }) };
const payload = (id = datasetId) => {
  const copy = structuredClone(cascadeImport);
  copy.dataset.id = id;
  for (const key of ["institutions", "accounts", "instruments", "sourceRecords", "obligations", "dependencies"] as const) {
    for (const item of copy[key]) item.datasetId = id;
  }
  return copy;
};
const post = async (body: unknown) => importRoute(await authenticatedRequest("http://localhost/api/datasets/import", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

describe("dataset import and retrieval", () => {
  it("returns structured validation failures for references, identifiers, and inventory", async () => {
    const invalid = payload();
    invalid.accounts[0].institutionId = "missing";
    invalid.accounts.push({ ...invalid.accounts[0] });
    invalid.accounts[1].externalId = invalid.accounts[0].externalId;
    invalid.sourceRecords[1].externalId = invalid.sourceRecords[0].externalId;
    invalid.dependencies[0].predecessorObligationId = "missing-obligation";
    invalid.initialCashBalances[0].reservedMinorUnits = "99999999999";
    const response = await post(invalid);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.validationIssues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining(["MISSING_REFERENCE", "DUPLICATE_ID", "DUPLICATE_SOURCE", "DUPLICATE_EXTERNAL_ID", "INVALID_BALANCE"]));
    expect(await getImportedDataset(datasetId)).toBeNull();
  });

  it("atomically imports and persists a revisioned snapshot for all read services", async () => {
    const response = await post(payload());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.dataset.revision).toBe("1");
    expect(body.data.imported.obligations).toBe(3);
    const source = await getImportedDataset(datasetId);
    expect(source?.snapshot.id).toBe(body.data.snapshotId);
    expect(source?.snapshot.datasetRevision).toBe("1");
    expect(source?.auditEvents[0].id).toBe(body.data.auditEventId);
    expect(source?.auditEvents[0].actorId).toBe("demo-user");
    const persisted = new DatabaseSync(databasePath);
    expect((persisted.prepare("SELECT dataset_revision FROM custody_snapshots WHERE user_id = ? AND id = ?").get("demo-user", body.data.snapshotId) as { dataset_revision: string }).dataset_revision).toBe("1");
    persisted.close();
    const fromNewProcess = execFileSync(process.execPath, ["-e", "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);process.stdout.write(String(db.prepare('SELECT COUNT(*) AS count FROM custody_snapshots WHERE user_id=? AND id=?').get(process.argv[2],process.argv[3]).count));db.close()", databasePath, "demo-user", body.data.snapshotId], { cwd: process.cwd(), encoding: "utf8" });
    expect(fromNewProcess).toBe("1");
    const work = await (await workspace(await authenticatedRequest(`http://localhost/api/datasets/${datasetId}/workspace`), context)).json();
    expect(work.data.snapshot).toEqual(source?.snapshot);
    expect(work.data.recentAuditEvents).toHaveLength(1);
    const graph = await (await twin(await authenticatedRequest(`http://localhost/api/datasets/${datasetId}/twin`), context)).json();
    expect(graph.data.projection.obligations).toHaveLength(3);
    expect(graph.data.projection.datasetId).toBe(datasetId);
    const assessment = await (await custody(await authenticatedRequest(`http://localhost/api/datasets/${datasetId}/custody`), context)).json();
    expect(assessment.data.assessment.obligations).toHaveLength(3);
    const simulationRequest = { contractVersion: "1.0.0", datasetId, expectedDatasetRevision: "1", baseSnapshotId: body.data.snapshotId,
      interventions: [{ id: "fund-test", kind: "cash_transfer", datasetId, baseSnapshotId: body.data.snapshotId, expectedDatasetRevision: "1", rationale: "test", sourceAccountId: "acct-reserve", targetAccountId: "acct-a", amount: { currency: "USD", minorUnits: "1000000000" }, effectiveAt: "2026-10-09T13:05:00Z" }] };
    const simulation = await (await simulate(await authenticatedRequest(`http://localhost/api/datasets/${datasetId}/simulations`, { method: "POST", body: JSON.stringify(simulationRequest) }), context)).json();
    expect(simulation.data.result.status).toBe("valid");
    expect(simulation.data.result.comparison.newlySettledObligationIds).toHaveLength(3);
    expect((await getImportedDataset(datasetId))?.snapshot).toEqual(source?.snapshot);
  });

  it("returns the requesting user's sample data and imported datasets", async () => {
    const authenticationDatabase = new DatabaseSync(databasePath);
    authenticationDatabase.prepare(`
      INSERT OR IGNORE INTO custody_authenticate (user_id, password, otp_secret)
      VALUES (?, ?, ?)
    `).run("demo-user", "0".repeat(64), "JBSWY3DPEHPK3PXP");
    const response = await financialDataRoute(await authenticatedRequest("http://localhost/api/users/demo-user/financial-data"), {
      params: Promise.resolve({ userId: "demo-user" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.userId).toBe("demo-user");
    expect(body.data.assets).toHaveLength(5);
    expect(body.data.transactions).toHaveLength(5);
    expect(body.data.policies).toHaveLength(4);
    expect(body.data.nodes).toHaveLength(8);
    expect(body.data.edges).toHaveLength(9);
    expect(body.data.datasets.map((dataset: { dataset: { id: string } }) => dataset.dataset.id)).toContain(datasetId);
    const otherUserId = `authenticated-user-${crypto.randomUUID()}`;
    authenticationDatabase.prepare(`
      INSERT INTO custody_authenticate (user_id, password, otp_secret) VALUES (?, ?, ?)
    `).run(otherUserId, "0".repeat(64), "JBSWY3DPEHPK3PXP");
    const otherUserResponse = await financialDataRoute(await authenticatedRequest(`http://localhost/api/users/${otherUserId}/financial-data`, {}, otherUserId), {
      params: Promise.resolve({ userId: otherUserId }),
    });
    const otherUser = await otherUserResponse.json();
    expect(otherUser.data.datasets).toEqual([]);
    expect(otherUser.data.assets).toHaveLength(5);
    expect(otherUser.data.transactions).toHaveLength(5);
    expect(otherUser.data.policies).toHaveLength(4);
    expect(otherUser.data.nodes).toHaveLength(8);
    expect(otherUser.data.edges).toHaveLength(9);

    const otherUserContext = { params: Promise.resolve({ datasetId: "dataset-cascade" }) };
    const twinResponse = await twin(await authenticatedRequest("http://localhost/api/datasets/dataset-cascade/twin", {}, otherUserId), otherUserContext);
    expect(twinResponse.status).toBe(200);
    expect((await twinResponse.json()).data.projection.obligations).toHaveLength(3);
    const simulationResponse = await simulate(await authenticatedRequest("http://localhost/api/datasets/dataset-cascade/simulations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fullFundingScenario),
    }, otherUserId), otherUserContext);
    expect(simulationResponse.status).toBe(200);
    expect((await simulationResponse.json()).data.result.comparison.newlySettledObligationIds).toHaveLength(3);
    const transferResponse = await transfer(await authenticatedRequest("http://localhost/api/transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: "1.0.0", userId: otherUserId, assetType: "BTC", assetAmount: "1.25", assetSource: "Bitcoin", senderName: "Fresh account test" }),
    }, otherUserId));
    expect(transferResponse.status).toBe(201);
    expect((await transferResponse.json()).data.transaction).toMatchObject({ asset: "BTC", status: "Pending approval" });

    // A prior initialization marker must not prevent missing demo surfaces from
    // being restored on a later request.
    authenticationDatabase.prepare("DELETE FROM example_twin_edges WHERE user_id = ?").run(otherUserId);
    authenticationDatabase.prepare("DELETE FROM example_twin_nodes WHERE user_id = ?").run(otherUserId);
    expect((await getExampleData(otherUserId)).nodes).toHaveLength(8);
    expect((await getExampleData(otherUserId)).edges).toHaveLength(9);
    authenticationDatabase.prepare("DELETE FROM custody_sessions WHERE user_id = ?").run(otherUserId);
    authenticationDatabase.prepare("DELETE FROM custody_authenticate WHERE user_id = ?").run(otherUserId);
    authenticationDatabase.close();

    const unknownUserResponse = await financialDataRoute(new Request("http://localhost/api/users/unknown-user/financial-data"), {
      params: Promise.resolve({ userId: "unknown-user" }),
    });
    expect(unknownUserResponse.status).toBe(401);
    expect((await unknownUserResponse.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects an empty user ID", async () => {
    const response = await financialDataRoute(new Request("http://localhost/api/users/%20/financial-data"), {
      params: Promise.resolve({ userId: " " }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  describe("user-keyed prototype sample tables", () => {
    it("round-trips the example collections in their existing object format", async () => {
      await saveExampleData(exampleData);
      expect(await getExampleData()).toEqual(exampleData);
      const database = new DatabaseSync(databasePath);
      expect((database.prepare("SELECT COUNT(*) AS count FROM example_assets WHERE user_id = ?").get("demo-user") as { count: number }).count).toBe(exampleData.assets.length);
      expect((database.prepare("SELECT COUNT(*) AS count FROM example_twin_edges WHERE user_id = ?").get("demo-user") as { count: number }).count).toBe(exampleData.edges.length);
      database.close();
    });

    it("keeps example rows scoped to the configured user and rolls back invalid replacements", async () => {
      const originalUserId = process.env.CUSTODYOS_DEMO_USER_ID;
      const changedData = structuredClone(exampleData);
      changedData.assets[0].balance = "42,000.00";
      await saveExampleData(changedData);
      const invalidData = structuredClone(changedData);
      invalidData.edges.push(["missing", "node"]);
      await expect(saveExampleData(invalidData)).rejects.toThrow();
      expect(await getExampleData()).toEqual(changedData);

      process.env.CUSTODYOS_DEMO_USER_ID = "other-demo-user";
      try {
        expect(await getExampleData()).toEqual(exampleData);
      } finally {
        if (originalUserId === undefined) delete process.env.CUSTODYOS_DEMO_USER_ID;
        else process.env.CUSTODYOS_DEMO_USER_ID = originalUserId;
      }
      expect(await getExampleData()).toEqual(changedData);
      await saveExampleData(exampleData);
    });
  });

  it("rejects a duplicate dataset as a revision conflict and preserves the original", async () => {
    const replacement = payload();
    replacement.dataset.name = "replacement";
    const response = await post(replacement);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REVISION_CONFLICT");
    expect((await getImportedDataset(datasetId))?.dataset.name).not.toBe("replacement");
  });

  it("reports missing datasets and stale simulation revisions", async () => {
    const missing = await workspace(await authenticatedRequest("http://localhost/api/datasets/missing/workspace"), { params: Promise.resolve({ datasetId: "missing" }) });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOT_FOUND");
    const source = await getImportedDataset(datasetId);
    const response = await simulate(await authenticatedRequest(`http://localhost/api/datasets/${datasetId}/simulations`, { method: "POST", body: JSON.stringify({
      contractVersion: "1.0.0", datasetId, expectedDatasetRevision: "2", baseSnapshotId: source?.snapshot.id,
      interventions: [{ id: "stale", kind: "cash_transfer", datasetId, baseSnapshotId: source?.snapshot.id, expectedDatasetRevision: "2", rationale: "test", sourceAccountId: "acct-reserve", targetAccountId: "acct-a", amount: { currency: "USD", minorUnits: "1000000000" }, effectiveAt: "2026-10-09T13:05:00Z" }],
    }) }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REVISION_CONFLICT");
  });

  it("keeps the cascade fixture ID reserved", async () => {
    const response = await post(cascadeImport);
    expect(response.status).toBe(409);
  });

  it("rejects unsupported DvP fields and inconsistent financial state", async () => {
    const unsupported = await post({ ...payload(), dvpPairs: [{ cashObligationId: "missing", securityObligationId: "missing" }] });
    expect(unsupported.status).toBe(422);
    expect((await unsupported.json()).error.validationIssues[0].field).toBe("");
    const invalid = payload();
    invalid.obligations[0].status = "settled";
    invalid.obligations[1].status = "cancelled";
    invalid.obligations[1].settledUnits = "1";
    invalid.sourceRecords[0].amount!.minorUnits = "-1";
    invalid.sourceRecords[0].receivedAt = "2026-10-09T14:00:00Z";
    invalid.initialCashBalances[0].accountId = "acct-b";
    invalid.initialSecuritiesBalances.push({ accountId: "acct-b", instrumentId: "instrument-demo", settledUnits: "1", reservedUnits: "0" });
    const response = await post(invalid);
    expect(response.status).toBe(422);
    const codes = (await response.json()).error.validationIssues.map((issue: { code: string }) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["INVALID_STATUS", "INVALID_UNITS", "INVALID_SOURCE_TIME", "ACCOUNT_POLICY"]));
    expect(await getImportedDataset(datasetId)).not.toBeNull();
  });

  it("isolates imports and safely handles concurrent duplicate IDs", async () => {
    const id = `isolation-${crypto.randomUUID()}`;
    const [first, second] = await Promise.all([post(payload(id)), post(payload(id))]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const isolated = await getImportedDataset(id);
    expect(isolated?.snapshot.datasetId).toBe(id);
    expect(isolated?.auditEvents).toHaveLength(1);
    expect((await getImportedDataset(datasetId))?.snapshot.datasetId).toBe(datasetId);
    const quotedId = `quote-'${crypto.randomUUID()}`;
    expect((await post(payload(quotedId))).status).toBe(201);
    expect((await getImportedDataset(quotedId))?.dataset.id).toBe(quotedId);
  });

  it("rolls back the dataset and snapshot if the audit write fails", async () => {
    const id = `rollback-${crypto.randomUUID()}`;
    const connection = new DatabaseSync(databasePath);
    connection.exec(`CREATE TRIGGER fail_import_audit BEFORE INSERT ON custody_audit_events WHEN NEW.dataset_id = '${id}' BEGIN SELECT RAISE(ABORT, 'audit failure'); END`);
    try {
      await expect(post(payload(id))).rejects.toThrow("audit failure");
      expect(await getImportedDataset(id)).toBeNull();
      expect((connection.prepare("SELECT COUNT(*) AS count FROM custody_snapshots WHERE dataset_id = ?").get(id) as { count: number }).count).toBe(0);
    } finally {
      connection.exec("DROP TRIGGER fail_import_audit");
      connection.close();
    }
  });
});
