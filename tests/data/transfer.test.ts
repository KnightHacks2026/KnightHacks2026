import { beforeAll, describe, expect, it } from "vitest";
import { POST as transfer } from "../../src/app/api/transfer/route";
import { GET as financialData } from "../../src/app/api/users/[userId]/financial-data/route";
import { createAuthenticationUser, getExampleData } from "../../src/lib/data/repository";
import { authenticatedRequest } from "../authenticated-request";

const testUserId = "demo-user";

beforeAll(async () => {
  await getExampleData(testUserId);
  await createAuthenticationUser(testUserId, "0".repeat(64), "JBSWY3DPEHPK3PXP");
});

const request = async (body: unknown) => transfer(await authenticatedRequest("http://localhost/api/transfer", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}, typeof body === "object" && body !== null && "userId" in body && typeof body.userId === "string" ? body.userId : testUserId));

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
    const reload = await financialData(await authenticatedRequest(`http://localhost/api/users/${testUserId}/financial-data`), { params: Promise.resolve({ userId: testUserId }) });
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
