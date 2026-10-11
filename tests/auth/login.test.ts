import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret, TOTP } from "otpauth";
import { POST as login } from "../../src/app/api/users/login/route";
import { POST as register } from "../../src/app/api/users/register/route";
import { POST as verify } from "../../src/app/api/users/register/verify/route";
import { getExampleData } from "../../src/lib/data/repository";
import { DatabaseSync } from "node:sqlite";

const userId = `login-test-${randomUUID()}`;
const registrationUserPrefix = `register-test-${randomUUID()}`;
const passwordHash = createHash("sha256").update("test-password").digest("hex");
const otpSecret = "JBSWY3DPEHPK3PXP";
const databasePath = process.env.CUSTODYOS_DATABASE_PATH ?? "data/custodyos.sqlite";
let database: DatabaseSync;

const post = (body: unknown) => login(new Request("http://localhost/api/users/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

const postTo = (handler: (request: Request) => Promise<Response>, body: unknown) => handler(new Request("http://localhost", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

describe("POST /api/users/login", () => {
  beforeAll(async () => {
    await getExampleData();
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA busy_timeout = 5000");
    database.prepare(`
      INSERT INTO custody_authenticate (user_id, password, otp_secret)
      VALUES (?, ?, ?)
    `).run(userId, passwordHash, otpSecret);
  });

  afterAll(() => {
    database.prepare("DELETE FROM custody_sessions WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM custody_authenticate WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM custody_authenticate WHERE user_id LIKE ?").run(`${registrationUserPrefix}%`);
    database.close();
  });

  it("authenticates a matching user, SHA-256 hash, and hyphenated TOTP", async () => {
    const totp = new TOTP({ secret: Secret.fromBase32(otpSecret) });
    const token = totp.generate();
    const response = await post({ username: userId, password: passwordHash, otpCode: `${token.slice(0, 3)}-${token.slice(3)}` });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ userId });
    expect(response.headers.get("set-cookie")).toContain("custodyos_session=");
  });

  it("rejects credentials that do not match the stored password hash", async () => {
    const response = await post({
      username: userId,
      password: createHash("sha256").update("wrong-password").digest("hex"),
      otpCode: "123456",
    });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects an invalid OTP code", async () => {
    const response = await post({ username: userId, password: passwordHash, otpCode: "000-000" });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects a malformed login request", async () => {
    const response = await post({ username: userId, password: "not-a-sha256-hash", otpCode: "123456" });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("keeps registrations pending in memory until OTP verification, then permits login", async () => {
    const username = `${registrationUserPrefix}-success`;
    const registerResponse = await postTo(register, { username, password: passwordHash });
    const registrationData = (await registerResponse.json()).data;

    expect(registerResponse.status).toBe(201);
    expect(registrationData).toEqual({
      registrationId: expect.any(String),
      otpSecret: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(database.prepare("SELECT 1 FROM custody_authenticate WHERE user_id = ?").get(username)).toBeUndefined();

    const otpCode = new TOTP({ secret: Secret.fromBase32(registrationData.otpSecret) }).generate();
    const verifyResponse = await postTo(verify, { registrationId: registrationData.registrationId, otpCode });

    expect(verifyResponse.status).toBe(200);
    expect((await verifyResponse.json()).data).toEqual({ userId: username });
    expect(database.prepare("SELECT password, otp_secret FROM custody_authenticate WHERE user_id = ?").get(username)).toEqual({
      password: passwordHash,
      otp_secret: registrationData.otpSecret,
    });

    const loginResponse = await postTo(login, { username, password: passwordHash, otpCode });
    expect(loginResponse.status).toBe(200);

    const replayResponse = await postTo(verify, { registrationId: registrationData.registrationId, otpCode });
    expect(replayResponse.status).toBe(410);
  });

  it("allows retrying an invalid registration OTP without creating an account", async () => {
    const username = `${registrationUserPrefix}-retry`;
    const registration = (await (await postTo(register, { username, password: passwordHash })).json()).data;
    const validOtpCode = new TOTP({ secret: Secret.fromBase32(registration.otpSecret) }).generate();
    const invalidOtpCode = validOtpCode === "000000" ? "000001" : "000000";

    const invalidResponse = await postTo(verify, {
      registrationId: registration.registrationId,
      otpCode: invalidOtpCode,
    });
    expect(invalidResponse.status).toBe(401);
    expect(database.prepare("SELECT 1 FROM custody_authenticate WHERE user_id = ?").get(username)).toBeUndefined();

    const validResponse = await postTo(verify, {
      registrationId: registration.registrationId,
      otpCode: validOtpCode,
    });
    expect(validResponse.status).toBe(200);
  });

  it("rejects malformed registration requests", async () => {
    const response = await postTo(register, { username: "invalid", password: "plaintext" });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });
});
