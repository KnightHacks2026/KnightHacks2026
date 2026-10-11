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

  it("accepts positive amounts and blocks absent-source requests", () => {
    expect(evaluateTransfer({ ...transfer, amount: "5000000" }, true).checks[1].result).toBe("Passed");
    expect(evaluateTransfer({ ...transfer, amount: "0" }, true).checks[1].result).toBe("Failed");
    expect(evaluateTransfer(transfer, false).canApprove).toBe(false);
  });

  it("matches thresholds only for the configured asset", () => {
    const policies = [{ name: "BTC threshold", asset: "BTC", threshold: "4" }];
    expect(evaluateTransfer({ ...transfer, amount: "5" }, true, policies).checks.at(-1)?.result).toBe("Approval required");
    expect(evaluateTransfer({ ...transfer, asset: "USDC", amount: "5000000" }, true, policies).checks).toHaveLength(4);
  });

  it("requires evidence for destinations outside the synthetic fixture", () => {
    const result = evaluateTransfer({ ...transfer, destination: "Unknown Counterparty" }, true);
    expect(result.canApprove).toBe(false);
    expect(result.checks[2].result).toBe("Requires evidence");
    expect(result.checks[3]).toMatchObject({ result: "Requires evidence", mandatory: true });
  });
});
