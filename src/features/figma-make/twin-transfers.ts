import type { ExampleTransaction } from "@/contracts";
import type { PolicyEvaluation, ReviewTransfer } from "@/lib/policy/evaluation";

export interface TransferAudit {
  id: string;
  transactionId: string;
  occurredAt: string;
  decision: "approve" | "reject";
  reviewerId: string;
  reason: string;
  evaluation: PolicyEvaluation;
}

export interface TransferReviews {
  transfers: (ReviewTransfer & { evaluation: PolicyEvaluation })[];
  audit: TransferAudit[];
}

export type TwinTransfer =
  | { kind: "request"; transaction: ExampleTransaction; review: TransferReviews["transfers"][number]; audit?: TransferAudit }
  | { kind: "sample"; transaction: ExampleTransaction };

export const requestStatuses = ["Pending approval", "Approved for processing", "Rejected"] as const;

export function joinTwinTransfers(transactions: ExampleTransaction[], reviews: TransferReviews): TwinTransfer[] {
  const byId = new Map(reviews.transfers.map(review => [review.id, review]));
  const auditById = new Map<string, TransferAudit>();
  for (const event of reviews.audit) {
    if (!auditById.has(event.transactionId)) auditById.set(event.transactionId, event);
  }
  return transactions.map(transaction => {
    const review = byId.get(transaction.id);
    return review && requestStatuses.some(status => status === review.status)
      ? { kind: "request", transaction, review, audit: auditById.get(transaction.id) }
      : { kind: "sample", transaction };
  });
}

export function policyResultLabel(result: PolicyEvaluation["checks"][number]["result"]): string {
  return result;
}
