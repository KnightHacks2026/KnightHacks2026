import { z } from "zod";
import { CONTRACT_VERSION } from "@/contracts";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { decideTransfer } from "@/lib/data/repository";

const schema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  decision: z.enum(["approve", "reject"]),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().max(500).default(""),
}).superRefine((value, context) => {
  if (value.decision === "reject" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A rejection reason is required." });
  }
});

/** Decisions are explicitly confined to the unauthenticated local demo user. */
export async function POST(request: Request, context: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await context.params;
  if (!transactionId || transactionId.length > 128) return apiError("INVALID_REQUEST", "Invalid transfer ID.", 400);
  let input: unknown;
  try { input = await request.json(); }
  catch { return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid decision.", 400);
  const result = await decideTransfer({ ...parsed.data, userId: "demo-user", transactionId });
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return apiError("NOT_FOUND", "Transfer request not found.", 404);
    if (result.reason === "EVIDENCE_REQUIRED") return apiError("APPROVAL_REQUIRED", "Mandatory policy checks have failed or require evidence.", 409);
    return apiError("REVISION_CONFLICT", "This transfer was already decided or its revision changed.", 409);
  }
  return apiSuccess({ transfer: result.transfer, audit: result.audit });
}
