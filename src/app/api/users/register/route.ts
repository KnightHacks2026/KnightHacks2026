import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { createPendingRegistration } from "@/lib/auth/registration";
import { hasAuthenticationUser } from "@/lib/data/repository";

export const runtime = "nodejs";

const registerSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().regex(/^[\da-fA-F]{64}$/),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_REQUEST", "Provide a username and a SHA-256 password hash.", 400);
  }

  const username = parsed.data.username;
  if (await hasAuthenticationUser(username)) {
    return apiError("VALIDATION_FAILED", "An account with this username already exists.", 409);
  }

  return apiSuccess(createPendingRegistration(username, parsed.data.password.toLowerCase()), 201);
}
