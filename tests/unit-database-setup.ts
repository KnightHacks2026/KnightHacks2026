import { randomUUID } from "node:crypto";
import { join } from "node:path";

const directory = process.env.CUSTODYOS_UNIT_DATABASE_DIR;
if (!directory) throw new Error("Unit test database directory was not provisioned.");
process.env.CUSTODYOS_DATABASE_PATH = join(directory, `${randomUUID()}.sqlite`);
