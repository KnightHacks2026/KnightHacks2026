import { z } from "zod";
import { CONTRACT_VERSION } from "@/contracts";
import { apiError } from "./envelope";

export const versionedRequestSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
});

export async function readVersionedJson(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return { ok: false as const, response: apiError("INVALID_REQUEST", "Expected a JSON request body.", 400) };
  }

  if (typeof input !== "object" || input === null || Array.isArray(input) ||
    !("contractVersion" in input) || typeof input.contractVersion !== "string") {
    return { ok: false as const, response: apiError("INVALID_REQUEST", "A contract version is required.", 400) };
  }
  const parsed = versionedRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: apiError("UNSUPPORTED_CONTRACT_VERSION", `Expected contract version ${CONTRACT_VERSION}.`, 400),
    };
  }

  return { ok: true as const, input };
}
