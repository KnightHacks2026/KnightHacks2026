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
  effectiveAt: string;
}

function decimalGreaterThan(left: string, right: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(left) || !/^\d+(?:\.\d+)?$/.test(right)) return false;
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  return BigInt(leftWhole + leftFraction.padEnd(scale, "0")) > BigInt(rightWhole + rightFraction.padEnd(scale, "0"));
}

/** Exact decimal comparison. This is a demo request limit, not an inventory check. */
function withinDemoLimit(amount: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return false;
  const [whole, fraction = ""] = amount.split(".");
  const units = BigInt(whole);
  return (units < 10n || (units === 10n && !/[1-9]/.test(fraction))) && /[1-9]/.test(amount);
}

export function evaluateTransfer(transfer: ReviewTransfer, sourceOwned: boolean, amountPolicies: AmountThresholdPolicy[] = []): PolicyEvaluation {
  const demoRoute = transfer.destination === "Demo Treasury";
  const checks: PolicyCheck[] = [
    { id: "source", label: "Source in demo inventory", result: sourceOwned ? "Passed" : "Failed", mandatory: true,
      detail: sourceOwned ? "The source asset is present in this user's local demo inventory." : "The source asset is absent from this user's local demo inventory." },
    { id: "amount", label: "Synthetic request limit: 10 asset units", result: withinDemoLimit(transfer.amount) ? "Passed" : "Failed", mandatory: true,
      detail: "Exact decimal request amount must be greater than zero and no more than 10 units. This is a synthetic demo rule, not an available-balance check." },
    { id: "route", label: "Synthetic Demo Treasury route", result: demoRoute ? "Passed" : "Requires evidence", mandatory: true,
      detail: demoRoute ? "Destination exactly matches the server-defined synthetic demo route." : "This destination has no verified account or allowlist evidence." },
    { id: "institutional", label: "Institutional signer and compliance evidence", result: "Requires evidence", mandatory: !demoRoute,
      detail: demoRoute ? "Out of scope for the synthetic demo route. No signer, sanctions, or allowlist verification is claimed." : "Signer quorum, screening, and allowlist evidence are unavailable; approval is blocked." },
  ];
  for (const policy of amountPolicies) {
    if (policy.asset !== transfer.asset || transfer.createdAt < policy.effectiveAt) continue;
    const matched = decimalGreaterThan(transfer.amount, policy.threshold);
    checks.push({
      id: `custom:${policy.name}`,
      label: policy.name,
      result: matched ? "Approval required" : "Passed",
      // Transfers are already held for a human decision. A match is recorded as a
      // review reason; it does not authorize or block a human from deciding.
      mandatory: false,
      detail: matched
        ? `${transfer.asset} amount ${transfer.amount} exceeds the enforced threshold of ${policy.threshold}. Keep this request in the human review queue.`
        : `${transfer.asset} amount ${transfer.amount} does not exceed the enforced threshold of ${policy.threshold}.`,
    });
  }
  return { scenario: demoRoute ? "Synthetic demo" : "Institutional evidence required", checks,
    canApprove: checks.every(check => !check.mandatory || check.result === "Passed") };
}
