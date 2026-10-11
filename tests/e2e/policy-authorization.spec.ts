import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test as unauthenticatedTest } from "@playwright/test";
import { test } from "./authenticated-test";

const policy = (name: string) => ({ name, scope: "Treasury wallet requests", rule: "Human review required" });

unauthenticatedTest("policy creation rejects callers without a server session", async ({ request }) => {
  const response = await request.post("/api/users/demo-user/policies", { data: policy(`Unauthorized ${randomUUID()}`) });
  expect(response.status()).toBe(401);
});

test("policy creation rejects cross-user and malformed requests", async ({ page }) => {
  const otherUser = `other-${randomUUID()}`;
  const crossUser = await page.request.post(`/api/users/${otherUser}/policies`, { data: policy(`Cross user ${randomUUID()}`) });
  expect(crossUser.status()).toBe(403);
  const malformed = await page.request.post("/api/users/demo-user/policies", { data: { name: "x", scope: "", rule: "x", state: "Enforced" } });
  expect(malformed.status()).toBe(400);
});

test("authorized policy creation is persisted for the signed-in user", async ({ page }) => {
  const name = `Authorized ${randomUUID()}`;
  const response = await page.request.post("/api/users/demo-user/policies", { data: policy(name) });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.data).toMatchObject({ name, state: "Draft", coverage: 0 });
  const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH!);
  try {
    const stored = database.prepare("SELECT name, state FROM example_policies WHERE user_id = ? AND name = ?")
      .get("demo-user", name) as { name: string; state: string } | undefined;
    expect(stored).toEqual({ name, state: "Draft" });
    database.prepare("DELETE FROM example_policies WHERE user_id = ? AND name = ?").run("demo-user", name);
  } finally { database.close(); }
});
