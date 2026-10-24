const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function main() {
  const port = await reservePort();
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "captify-worker-smoke-"));
  const secret = crypto.randomBytes(24).toString("hex");
  const workerEntry = path.resolve(__dirname, "../worker/server.js");
  const child = spawn(process.execPath, [workerEntry], {
    cwd: path.dirname(workerEntry),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOST: "127.0.0.1",
      STORAGE_DIR: storage,
      WORKER_SECRET: secret,
      GROQ_API_KEY: "gsk_local_smoke_test_key_not_used",
      GEMINI_API_KEY: "",
      GEMINI_API_KEY_2: "",
      NEXT_APP_URL: "",
      CAPTIFY_DESKTOP: "1",
      FFMPEG_THREADS: "2"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    const base = "http://127.0.0.1:" + port;
    const deadline = Date.now() + 25000;
    let health = null;
    let lastError = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("Worker exited early with code " + child.exitCode);
      try {
        const response = await fetch(base + "/health", { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch (error) { lastError = error; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!health || health.ok !== true || health.service !== "captify-worker") {
      throw new Error("Worker health endpoint failed. " + (lastError ? lastError.message : ""));
    }

    const versionResponse = await fetch(base + "/version", { signal: AbortSignal.timeout(2000) });
    if (!versionResponse.ok) throw new Error("Worker version endpoint failed.");
    const version = await versionResponse.json();
    if (!version.output || version.output.width !== 1080 || version.output.height !== 1920) {
      throw new Error("Unexpected output dimensions from local worker.");
    }

    const unauthorized = await fetch(base + "/status/smoke-test");
    if (unauthorized.status !== 401) throw new Error("Worker secret guard did not reject unauthenticated status requests.");

    console.log("[desktop-smoke] Worker startup, health, version, and auth checks passed.");
  } finally {
    try { child.kill(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { fs.rmSync(storage, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error("[desktop-smoke] Failed:", error.message);
  process.exitCode = 1;
});
