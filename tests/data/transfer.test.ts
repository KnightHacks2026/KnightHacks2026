import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as transfer } from "../../src/app/api/transfer/route";
import { GET as financialData } from "../../src/app/api/users/[userId]/financial-data/route";
import { getExampleData } from "../../src/lib/data/repository";

const testRoutes = ["Bitcoin → Transfer test destination"];
const testUserId = "demo-user";
const cleanupTestTransfer = async () => {
  await getExampleData(testUserId);
  const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH ?? "data/custodyos.sqlite");
  try {
    const removeTestTransaction = database.prepare("DELETE FROM example_transactions WHERE user_id = ? AND route = ?");
    for (const route of testRoutes) removeTestTransaction.run(testUserId, route);
  } finally {
    database.close();
  }
};

beforeAll(cleanupTestTransfer);
afterAll(cleanupTestTransfer);

const request = (body: unknown) => transfer(new Request("http://localhost/api/transfer", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

const validTransfer = {
  contractVersion: "1.0.0",
  userId: testUserId,
  assetType: "btc",
  assetAmount: "1.25",
  assetSource: "Bitcoin",
  senderName: "Transfer test destination",
};

describe("POST /api/transfer", () => {
  it("adds a pending transfer for an asset the user owns", async () => {
    const before = await getExampleData(testUserId);
    const response = await request(validTransfer);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.transaction).toMatchObject({
      type: "Transfer",
      asset: "BTC",
      amount: "1.25 BTC",
      value: "—",
      route: "Bitcoin → Transfer test destination",
      status: "Pending approval",
    });
    const after = await getExampleData(testUserId);
    expect(after.transactions[0]).toEqual(body.data.transaction);
    expect(after.assets).toEqual(before.assets);
    const reload = await financialData(new Request(`http://localhost/api/users/${testUserId}/financial-data`), { params: Promise.resolve({ userId: testUserId }) });
    expect(reload.status).toBe(200);
    expect((await reload.json()).data.transactions[0]).toEqual(body.data.transaction);
  });

  it("rejects a source that is not an asset owned by that user", async () => {
    const response = await request({ ...validTransfer, userId: "unknown-user" });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a mismatched asset type and malformed amount", async () => {
    const mismatch = await request({ ...validTransfer, assetType: "ETH" });
    expect(mismatch.status).toBe(400);

    const malformed = await request({ ...validTransfer, assetAmount: "0" });
    expect(malformed.status).toBe(400);
    expect((await request({ ...validTransfer, assetAmount: "1e3" })).status).toBe(400);
    expect((await request({ ...validTransfer, senderName: " " })).status).toBe(400);
  });
});
