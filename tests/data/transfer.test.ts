import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as transfer } from "../../src/app/api/transfer/route";
import { getExampleData } from "../../src/lib/data/repository";

const testRoutes = ["Transfer test sender → Bitcoin", "Test sender → Bitcoin"];
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
  senderName: "Transfer test sender",
};

describe("POST /api/transfer", () => {
  it("adds a pending transfer for an asset the user owns", async () => {
    const response = await request(validTransfer);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.transaction).toMatchObject({
      type: "Transfer",
      asset: "BTC",
      amount: "1.25 BTC",
      value: "—",
      route: "Transfer test sender → Bitcoin",
      status: "Pending approval",
    });
    expect((await getExampleData(testUserId)).transactions).toContainEqual(body.data.transaction);
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
  });
});
