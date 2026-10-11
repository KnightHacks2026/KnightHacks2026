import { randomUUID } from "node:crypto";
import { Secret } from "otpauth";

const registrationTtlMs = 5 * 60 * 1000;
const maxVerificationAttempts = 5;

interface PendingRegistration {
  username: string;
  passwordHash: string;
  otpSecret: string;
  expiresAt: number;
  verificationAttempts: number;
  expirationTimer: NodeJS.Timeout;
}

const pendingRegistrations = new Map<string, PendingRegistration>();

export function createPendingRegistration(username: string, passwordHash: string) {
  const registrationId = randomUUID();
  const otpSecret = new Secret().base32;
  const expiresAt = Date.now() + registrationTtlMs;
  const expirationTimer = setTimeout(() => pendingRegistrations.delete(registrationId), registrationTtlMs);
  expirationTimer.unref();

  pendingRegistrations.set(registrationId, {
    username,
    passwordHash,
    otpSecret,
    expiresAt,
    verificationAttempts: 0,
    expirationTimer,
  });

  return { registrationId, otpSecret, expiresAt: new Date(expiresAt).toISOString() };
}

export function getPendingRegistration(registrationId: string): PendingRegistration | undefined {
  const registration = pendingRegistrations.get(registrationId);
  if (!registration) return undefined;
  if (registration.expiresAt <= Date.now()) {
    deletePendingRegistration(registrationId);
    return undefined;
  }
  return registration;
}

export function recordFailedVerification(registrationId: string, registration: PendingRegistration): boolean {
  registration.verificationAttempts += 1;
  if (registration.verificationAttempts < maxVerificationAttempts) return false;
  deletePendingRegistration(registrationId);
  return true;
}

export function deletePendingRegistration(registrationId: string): void {
  const registration = pendingRegistrations.get(registrationId);
  if (!registration) return;
  clearTimeout(registration.expirationTimer);
  pendingRegistrations.delete(registrationId);
}
