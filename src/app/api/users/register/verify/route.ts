import { Secret, TOTP } from "otpauth";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/envelope";
import {
  deletePendingRegistration,
  getPendingRegistration,
  recordFailedVerification,
} from "@/lib/auth/registration";
import { createAuthenticationUser } from "@/lib/data/repository";

export const runtime = "nodejs";

const verifySchema = z.object({
  registrationId: z.string().uuid(),
  otpCode: z.string().regex(/^\d{3}-?\d{3}$/),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Expected a JSON request body.", 400);
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_REQUEST", "Provide a registration ID and a six-digit OTP code.", 400);
  }

  const { registrationId, otpCode } = parsed.data;
  const registration = getPendingRegistration(registrationId);
  if (!registration) {
    return apiError("NOT_FOUND", "Registration was not found or has expired.", 410);
  }

  const totp = new TOTP({ secret: Secret.fromBase32(registration.otpSecret) });
  const isValidOtp = totp.validate({ token: otpCode.replace("-", ""), window: 1 }) !== null;
  if (!isValidOtp) {
    const attemptsExhausted = recordFailedVerification(registrationId, registration);
    return apiError(
      "PERMISSION_DENIED",
      attemptsExhausted ? "Verification attempts exceeded; start registration again." : "Invalid one-time password.",
      401,
    );
  }

  const created = await createAuthenticationUser(
    registration.username,
    registration.passwordHash,
    registration.otpSecret,
  );
  deletePendingRegistration(registrationId);
  if (!created) {
    return apiError("VALIDATION_FAILED", "An account with this username already exists.", 409);
  }

  return apiSuccess({ userId: registration.username });
}
