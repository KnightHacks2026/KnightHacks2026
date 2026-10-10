export default async function globalTeardown() {
  try {
    await fetch("http://127.0.0.1:3100/__playwright_stop", { method: "POST" });
  } catch {
    // The server may have exited during test failure.
  }
}
