import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup() {
  const directory = mkdtempSync(join(tmpdir(), "custodyos-unit-"));
  process.env.CUSTODYOS_UNIT_DATABASE_DIR = directory;

  return () => {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    delete process.env.CUSTODYOS_UNIT_DATABASE_DIR;
  };
}
