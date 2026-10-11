export type PolicyResult = "Passed" | "Failed" | "Requires evidence" | "Approval required";

export interface PolicyCheck {
  id: string;
  label: string;
  result: PolicyResult;
  mandatory: boolean;
  detail: string;
}

export interface ReviewTransfer {
  id: string;
  userId: string;
  asset: string;
  amount: string;
  source: string;
  destination: string;
  createdAt: string;
  status: "Pending approval" | "Approved for processing" | "Rejected";
  revision: number;
}

export interface PolicyEvaluation {
  scenario: "Synthetic demo" | "Institutional evidence required";
  checks: PolicyCheck[];
  canApprove: boolean;
}

export interface AmountThresholdPolicy {
  name: string;
  asset: string;
  threshold: string;
}

function decimalGreaterThan(left: string, right: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(left) || !/^\d+(?:\.\d+)?$/.test(right)) return false;
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftWhole + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightWhole + rightFraction.padEnd(scale, "0"));
  return leftValue > rightValue;
}

function validPositiveAmount(amount: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return false;
  return /[1-9]/.test(amount);
}

export function evaluateTransfer(transfer: ReviewTransfer, sourceOwned: boolean, amountPolicies: AmountThresholdPolicy[] = []): PolicyEvaluation {
  const demoRoute = transfer.destination === "Demo Treasury";
  const checks: PolicyCheck[] = [
    { id: "source", label: "Source in demo inventory", result: sourceOwned ? "Passed" : "Failed", mandatory: true,
      detail: sourceOwned ? "The source asset is present in this user's local demo inventory." : "The source asset is absent from this user's local demo inventory." },
    { id: "amount", label: "Valid positive asset amount", result: validPositiveAmount(transfer.amount) ? "Passed" : "Failed", mandatory: true,
      detail: "The request amount must be a positive decimal value. Available-balance validation remains a separate control." },
    { id: "route", label: "Synthetic Demo Treasury route", result: demoRoute ? "Passed" : "Requires evidence", mandatory: true,
      detail: demoRoute ? "Destination exactly matches the server-defined synthetic demo route." : "This destination has no verified account or allowlist evidence." },
    { id: "institutional", label: "Institutional signer and compliance evidence", result: "Requires evidence", mandatory: !demoRoute,
      detail: demoRoute ? "Out of scope for the synthetic demo route. No signer, sanctions, or allowlist verification is claimed." : "Signer quorum, screening, and allowlist evidence are unavailable; approval is blocked." },
  ];
  for (const policy of amountPolicies) {
    if (policy.asset !== transfer.asset) continue;
    const matched = decimalGreaterThan(transfer.amount, policy.threshold);
    checks.push({
      id: `custom:${policy.name}`,
      label: policy.name,
      result: matched ? "Approval required" : "Passed",
      mandatory: false,
      detail: matched
        ? `Matched enforced rule: ${transfer.asset} amount ${transfer.amount} exceeds ${policy.threshold}. Human approval is required.`
        : `Amount does not exceed the enforced threshold of ${policy.threshold} ${transfer.asset}.`,
    });
  }
  return { scenario: demoRoute ? "Synthetic demo" : "Institutional evidence required", checks,
    canApprove: checks.every(check => !check.mandatory || check.result === "Passed") };
}
