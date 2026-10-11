import { createHash } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import { getAuthenticationOtpSecret } from "@/lib/data/repository";

export const runtime = "nodejs";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().regex(/^[\da-fA-F]{64}$/),
  otpCode: z.string().regex(/^\d{3}-?\d{3}$/),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_REQUEST", "Provide a username, a SHA-256 password hash, and a six-digit OTP code.", 400);
  }

  const { username, password, otpCode } = parsed.data;
  const otpSecret = await getAuthenticationOtpSecret(username, password.toLowerCase());
  if (!otpSecret) {
    return apiError("PERMISSION_DENIED", "Invalid username, password, or OTP code.", 401);
  }

  const totp = new TOTP({ secret: Secret.fromBase32(otpSecret) });
  const isValidOtp = totp.validate({ token: otpCode.replace("-", ""), window: 1 }) !== null;
  if (!isValidOtp) {
    return apiError("PERMISSION_DENIED", "Invalid username, password, or OTP code.", 401);
  }

  return apiSuccess({ userId: username });
}
