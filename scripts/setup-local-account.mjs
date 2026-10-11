import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

if (process.env.NODE_ENV === "production") {
  console.error("Local account setup is unavailable in production.");
  process.exit(1);
}

const userId = process.argv[2]?.trim();
if (!userId || userId.length > 128 || process.argv.length !== 3) {
  console.error("Usage: npm run auth:setup -- <username> (use demo-user for the sample dashboard)");
  process.exit(1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Run this command in an interactive terminal so the password can be entered privately.");
  process.exit(1);
}

const databasePath = resolve(process.env.CUSTODYOS_DATABASE_PATH ?? "data/custodyos.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
try {
  database.exec("CREATE TABLE IF NOT EXISTS custody_authenticate (user_id TEXT NOT NULL PRIMARY KEY, password TEXT NOT NULL, otp_secret TEXT NOT NULL)");
  if (database.prepare("SELECT 1 FROM custody_authenticate WHERE user_id = ?").get(userId)) {
    console.error(`Account ${userId} already exists in ${databasePath}. No changes made.`);
    process.exitCode = 1;
  } else {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const prompt = createInterface({ input: process.stdin, output, terminal: true });
    const readPassword = async (label) => {
      process.stdout.write(label);
      muted = true;
      const value = await new Promise((done) => prompt.question("", done));
      muted = false;
      process.stdout.write("\n");
      return value;
    };
    const password = await readPassword("New password: ");
    const confirmation = await readPassword("Confirm password: ");
    prompt.close();
    if (password.length < 12 || password !== confirmation) {
      console.error("Passwords must match and be at least 12 characters. No account created.");
      process.exitCode = 1;
    } else {
      const passwordHash = createHash("sha256").update(password).digest("hex");
      // TOTP secrets are stored in Base32 for the existing login verifier.
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      const bytes = randomBytes(20);
      let bits = 0;
      let value = 0;
      let otpSecret = "";
      for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
          otpSecret += alphabet[(value >>> (bits -= 5)) & 31];
        }
      }
      database.prepare("INSERT INTO custody_authenticate (user_id, password, otp_secret) VALUES (?, ?, ?)").run(userId, passwordHash, otpSecret);
      console.log(`Account created in ${databasePath}.`);
      console.log("Add this TOTP setup key to your authenticator app (time-based, 6 digits, 30 seconds):");
      console.log(otpSecret);
      console.log("Then sign in with this username, your password, and the current authenticator code.");
    }
  }
} finally {
  database.close();
}
