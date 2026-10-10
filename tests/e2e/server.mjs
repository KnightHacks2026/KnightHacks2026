import { createServer } from "node:http";
import next from "next";

const app = next({ dev: false, dir: process.cwd() });
await app.prepare();
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
