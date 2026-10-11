import { createAuthenticationSession, createAuthenticationUser } from "../src/lib/data/repository";

export async function authenticatedRequest(url: string, init: RequestInit = {}, userId = "demo-user") {
  await createAuthenticationUser(userId, "0".repeat(64), "JBSWY3DPEHPK3PXP");
  const token = await createAuthenticationSession(userId);
  const headers = new Headers(init.headers);
  headers.set("cookie", `custodyos_session=${token}`);
  return new Request(url, { ...init, headers });
}
