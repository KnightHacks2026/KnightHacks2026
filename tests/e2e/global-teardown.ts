import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export default async function globalTeardown() {
  try {
    await fetch("http://127.0.0.1:3100/__playwright_stop", { method: "POST" });
  } catch {
    // The server may have exited during test failure.
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await fetch("http://127.0.0.1:3100/api/health"); await delay(100); }
    catch { break; }
  }
  const path = process.env.CUSTODYOS_DATABASE_PATH;
  if (path && dirname(resolve(path)) === resolve(tmpdir()) && /^custodyos-e2e-[a-f0-9-]+\.sqlite$/.test(basename(path))) {
    for (const suffix of ["", "-wal", "-shm"]) {
      for (let attempt = 0; attempt < 30; attempt++) {
        try { await unlink(path + suffix); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") break;
          if (code !== "EBUSY" || attempt === 29) throw error;
          await delay(100);
        }
      }
    }
  }
}
