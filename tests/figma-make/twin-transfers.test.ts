import { describe, expect, it } from "vitest";
import type { ExampleTransaction } from "../../src/contracts";
import { joinTwinTransfers, policyResultLabel, type TransferReviews } from "../../src/features/figma-make/twin-transfers";

const transaction = (id: string, status: string): ExampleTransaction => ({
  id, time: "12:00:00", type: "Transfer", asset: "BTC", amount: "1 BTC", value: "—", route: "BTC → Demo Treasury", status,
});
const evaluation: TransferReviews["transfers"][number]["evaluation"] = {
  scenario: "Synthetic demo", canApprove: true,
  checks: [
    { id: "source", label: "Source", result: "Passed", mandatory: true, detail: "Owned demo asset" },
    { id: "amount", label: "Amount", result: "Failed", mandatory: true, detail: "Over limit" },
    { id: "institutional", label: "Institutional evidence", result: "Requires evidence", mandatory: false, detail: "Unverified" },
  ],
};
const reviews = (status: "Pending approval" | "Approved for processing" | "Rejected"): TransferReviews => ({
  transfers: [{ id: "TX-REQUEST", userId: "demo-user", asset: "BTC", amount: "1", source: "BTC", destination: "Demo Treasury",
    createdAt: "2026-10-10T12:00:00Z", status, revision: 1, evaluation }],
  audit: status === "Pending approval" ? [] : [{ id: "audit-1", transactionId: "TX-REQUEST", occurredAt: "2026-10-10T12:01:00Z",
    decision: status === "Rejected" ? "reject" : "approve", reviewerId: "local-demo-reviewer", reason: "Reviewed", evaluation }],
});

describe("Digital Twin transfer join", () => {
  it.each(["Pending approval", "Approved for processing", "Rejected"] as const)("joins a %s request and its decision history", status => {
    const [item] = joinTwinTransfers([transaction("TX-REQUEST", status)], reviews(status));
    expect(item.kind).toBe("request");
    if (item.kind !== "request") return;
    expect(item.review.status).toBe(status);
    expect(item.audit?.decision).toBe(status === "Rejected" ? "reject" : status === "Pending approval" ? undefined : "approve");
  });

  it("keeps seeded and unlinked transactions as samples without fabricating policy results", () => {
    const items = joinTwinTransfers([transaction("TX-SEED", "Completed"), transaction("TX-REQUEST", "Pending approval")], { transfers: [], audit: [] });
    expect(items.map(item => item.kind)).toEqual(["sample", "sample"]);
    expect(items.every(item => !("review" in item))).toBe(true);
  });

  it("uses the review status when two endpoint reads straddle a decision", () => {
    const [item] = joinTwinTransfers([transaction("TX-REQUEST", "Pending approval")], reviews("Rejected"));
    expect(item.kind).toBe("request");
    if (item.kind === "request") expect(item.review.status).toBe("Rejected");
  });

  it("preserves exact policy result labels", () => {
    expect(evaluation.checks.map(check => policyResultLabel(check.result))).toEqual(["Passed", "Failed", "Requires evidence"]);
  });
});
