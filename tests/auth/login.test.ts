import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Secret, TOTP } from "otpauth";
import { POST as login } from "../../src/app/api/users/login/route";
import { getExampleData } from "../../src/lib/data/repository";
import { DatabaseSync } from "node:sqlite";

const userId = `login-test-${randomUUID()}`;
const passwordHash = createHash("sha256").update("test-password").digest("hex");
const otpSecret = "JBSWY3DPEHPK3PXP";
const databasePath = process.env.CUSTODYOS_DATABASE_PATH ?? "data/custodyos.sqlite";
let database: DatabaseSync;

const post = (body: unknown) => login(new Request("http://localhost/api/users/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));

describe("POST /api/users/login", () => {
  beforeAll(async () => {
    await getExampleData();
    database = new DatabaseSync(databasePath);
    database.prepare(`
      INSERT INTO custody_authenticate (user_id, password, otp_secret)
      VALUES (?, ?, ?)
    `).run(userId, passwordHash, otpSecret);
  });

  afterAll(() => {
    database.prepare("DELETE FROM custody_authenticate WHERE user_id = ?").run(userId);
    database.close();
  });

  it("authenticates a matching user, SHA-256 hash, and hyphenated TOTP", async () => {
    const totp = new TOTP({ secret: Secret.fromBase32(otpSecret) });
    const token = totp.generate();
    const response = await post({ username: userId, password: passwordHash, otpCode: `${token.slice(0, 3)}-${token.slice(3)}` });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ userId });
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
});
