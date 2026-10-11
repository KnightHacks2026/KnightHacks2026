import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import next from "next";

const app = next({ dev: false, dir: process.cwd() });
await app.prepare();
const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH ?? "data/e2e.sqlite");
database.exec("CREATE TABLE IF NOT EXISTS custody_authenticate (user_id TEXT NOT NULL PRIMARY KEY, password TEXT NOT NULL, otp_secret TEXT NOT NULL)");
if (!process.env.CUSTODYOS_E2E_PASSWORD || !process.env.CUSTODYOS_E2E_OTP_SECRET) throw new Error("Playwright test credentials are missing.");
database.prepare("INSERT INTO custody_authenticate (user_id, password, otp_secret) VALUES (?, ?, ?)")
  .run("demo-user", createHash("sha256").update(process.env.CUSTODYOS_E2E_PASSWORD).digest("hex"), process.env.CUSTODYOS_E2E_OTP_SECRET);
database.close();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/__playwright_stop") {
    response.writeHead(204);
    response.end();
    server.close(() => {
      void app.close().then(() => process.exit(0));
    });
    return;
  }
  void handle(request, response);
});
server.listen(3100, "127.0.0.1");
