import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

it("rolls back both status updates when the decision audit INSERT fails, then commits once on retry", async () => {
  // Import after setting the path: the repository caches its SQLite connection.
  const databasePath = join(mkdtempSync(join(tmpdir(), "custodyos-policy-rollback-")), "policy.sqlite");
  vi.stubEnv("CUSTODYOS_DATABASE_PATH", databasePath);
  vi.resetModules();
  try {
    const { createExampleTransfer, decideTransfer, getExampleData } = await import("../../src/lib/data/repository");
    await getExampleData();
    const userId = `rollback-test-${randomUUID()}`;
    const setup = new DatabaseSync(databasePath);
    setup.prepare(`INSERT INTO example_assets (user_id, position, symbol, name, balance, value, change, share)
      VALUES (?, 0, 'BTC', 'Bitcoin', '100.00', '$1M', '0%', 100)`).run(userId);
    setup.close();

    const created = await createExampleTransfer({ userId, assetType: "BTC", assetAmount: "2.5",
      assetSource: "BTC", senderName: "Demo Treasury" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const transactionId = created.transaction.id;
    const decision = { userId, transactionId, expectedRevision: 1, decision: "approve" as const,
      reason: "Synthetic demo route" };

    // Each snapshot uses a new connection so it reads persisted state, not the repository connection.
    function snapshot() {
      const database = new DatabaseSync(databasePath);
      try {
        return {
          transaction: database.prepare("SELECT status FROM example_transactions WHERE user_id = ? AND id = ?")
            .get(userId, transactionId),
          review: database.prepare("SELECT status, revision FROM example_transfer_requests WHERE user_id = ? AND transaction_id = ?")
            .get(userId, transactionId),
          audit: database.prepare("SELECT decision, revision_before, revision_after FROM example_transfer_audit WHERE user_id = ? AND transaction_id = ?")
            .all(userId, transactionId),
        };
      } finally { database.close(); }
    }

    const before = snapshot();
    expect(before).toEqual({ transaction: { status: "Pending approval" },
      review: { status: "Pending approval", revision: 1 }, audit: [] });

    const failure = new DatabaseSync(databasePath);
    failure.exec(`CREATE TRIGGER fail_decision_audit_insert BEFORE INSERT ON example_transfer_audit
      BEGIN SELECT RAISE(ABORT, 'injected decision audit insert failure'); END;`);
    failure.close();

    await expect(decideTransfer(decision)).rejects.toThrow("injected decision audit insert failure");
    expect(snapshot()).toEqual(before);

    const recovery = new DatabaseSync(databasePath);
    recovery.exec("DROP TRIGGER fail_decision_audit_insert");
    recovery.close();

    const approved = await decideTransfer(decision);
    expect(approved.ok).toBe(true);
    expect(snapshot()).toEqual({
      transaction: { status: "Approved for processing" },
      review: { status: "Approved for processing", revision: 2 },
      audit: [{ decision: "approve", revision_before: 1, revision_after: 2 }],
    });

    expect(await decideTransfer(decision)).toEqual({ ok: false, reason: "CONFLICT" });
    expect(snapshot().audit).toHaveLength(1);
  } finally {
    vi.unstubAllEnvs();
  }
});
