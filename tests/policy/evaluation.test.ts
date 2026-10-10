import { describe, expect, it } from "vitest";
import { evaluateTransfer, type ReviewTransfer } from "../../src/lib/policy/evaluation";

const transfer: ReviewTransfer = {
  id: "TX-DEMO", userId: "demo-user", asset: "BTC", amount: "10.000", source: "BTC",
  destination: "Demo Treasury", createdAt: "2026-10-10T12:00:00.000Z",
  status: "Pending approval", revision: 1,
};

describe("local demo policy evaluation", () => {
  it("allows only the explicitly defined synthetic case without claiming institutional evidence", () => {
    const result = evaluateTransfer(transfer, true);
    expect(result.canApprove).toBe(true);
    expect(result.checks.map(check => check.result)).toEqual(["Passed", "Passed", "Passed", "Requires evidence"]);
    expect(result.checks[3].mandatory).toBe(false);
  });

  it("blocks over-limit and absent-source requests", () => {
    expect(evaluateTransfer({ ...transfer, amount: "10.0001" }, true).checks[1].result).toBe("Failed");
    expect(evaluateTransfer({ ...transfer, amount: "9.999999999999999999" }, true).canApprove).toBe(true);
    expect(evaluateTransfer(transfer, false).canApprove).toBe(false);
  });

  it("requires evidence for destinations outside the synthetic fixture", () => {
    const result = evaluateTransfer({ ...transfer, destination: "Unknown Counterparty" }, true);
    expect(result.canApprove).toBe(false);
    expect(result.checks[2].result).toBe("Requires evidence");
    expect(result.checks[3]).toMatchObject({ result: "Requires evidence", mandatory: true });
  });
});
