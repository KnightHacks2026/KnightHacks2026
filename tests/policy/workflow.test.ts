import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createExampleTransfer, decideTransfer, getExampleData, getTransferReviews } from "../../src/lib/data/repository";

describe("persisted local demo review lifecycle", () => {
  it("commits one decision, status change, and append-only audit without changing balances", async () => {
    await getExampleData();
    const userId = `policy-test-${randomUUID()}`;
    const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH ?? "data/test.sqlite");
    database.prepare(`INSERT INTO example_assets (user_id, position, symbol, name, balance, value, change, share)
      VALUES (?, 0, 'BTC', 'Bitcoin', '100.00', '$1M', '0%', 100)`).run(userId);
    database.close();
    const created = await createExampleTransfer({ userId, assetType: "BTC", assetAmount: "2.5",
      assetSource: "BTC", senderName: "Demo Treasury" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.transaction.id;
    const before = await getExampleData(userId);
    const result = await decideTransfer({ userId, transactionId: id, expectedRevision: 1,
      decision: "approve", reason: "Synthetic demo route" });
    expect(result.ok).toBe(true);
    expect(await decideTransfer({ userId, transactionId: id, expectedRevision: 1,
      decision: "reject", reason: "Late rejection" })).toEqual({ ok: false, reason: "CONFLICT" });
    const after = await getExampleData(userId);
    expect(after.assets).toEqual(before.assets);
    expect(after.transactions[0].status).toBe("Approved for processing");
    const reviews = await getTransferReviews(userId);
    expect(reviews.audit.filter(event => event.transactionId === id)).toHaveLength(1);
    expect(reviews.audit.find(event => event.transactionId === id)).toMatchObject({
      reviewerId: "local-demo-reviewer", decision: "approve", revisionBefore: 1, revisionAfter: 2,
    });
    const verification = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH ?? "data/test.sqlite");
    expect(() => verification.prepare("UPDATE example_transfer_audit SET reason = 'tampered' WHERE transaction_id = ?").run(id)).toThrow();
    verification.close();
  });

  it("blocks unverifiable approval while allowing a reasoned rejection", async () => {
    await getExampleData();
    const userId = `policy-test-${randomUUID()}`;
    const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH ?? "data/test.sqlite");
    database.prepare(`INSERT INTO example_assets (user_id, position, symbol, name, balance, value, change, share)
      VALUES (?, 0, 'BTC', 'Bitcoin', '100.00', '$1M', '0%', 100)`).run(userId);
    database.close();
    const created = await createExampleTransfer({ userId, assetType: "BTC", assetAmount: "11",
      assetSource: "BTC", senderName: "Outside Counterparty" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.transaction.id;
    expect(await decideTransfer({ userId, transactionId: id, expectedRevision: 1,
      decision: "approve", reason: "" })).toEqual({ ok: false, reason: "EVIDENCE_REQUIRED" });
    expect((await getTransferReviews(userId)).audit).toHaveLength(0);
    const rejection = await decideTransfer({ userId, transactionId: id, expectedRevision: 1,
      decision: "reject", reason: "No route evidence" });
    expect(rejection.ok).toBe(true);
    expect((await getExampleData(userId)).transactions[0].status).toBe("Rejected");
  });
});
