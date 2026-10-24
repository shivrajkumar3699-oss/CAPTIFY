const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, utilityProcess, safeStorage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

protocol.registerSchemesAsPrivileged([{
  scheme: "captify-local",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const APP_URL = process.env.CAPTIFY_DESKTOP_URL || (app.isPackaged
  ? "https://captify-git-feature-windows-desktop-electron-loc-069361-ritikai.vercel.app"
  : "https://captifyy.vercel.app");
const USER_DATA_DIR = app.getPath("userData");
const SETTINGS_PATH = path.join(USER_DATA_DIR, "settings.bin");
const STORAGE_DIR = path.join(app.getPath("videos"), "CAPTIFY");
let mainWindow = null;
let settingsWindow = null;
let workerProcess = null;
let workerPort = 0;
let workerSecret = "";
let workerUrl = "";
let isSavingSettings = false;

function isTrustedSender(event) {
  try {
    const senderUrl = new URL(event.senderFrame.url);
    if (senderUrl.protocol === "file:") return true;
    return senderUrl.origin === new URL(APP_URL).origin;
  } catch { return false; }
}
function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error("Blocked an IPC request from an untrusted page.");
}
function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH) || !safeStorage.isEncryptionAvailable()) return {};
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(SETTINGS_PATH)));
    return {
      GROQ_API_KEY: String(parsed.GROQ_API_KEY || ""),
      GEMINI_API_KEY: String(parsed.GEMINI_API_KEY || ""),
      GEMINI_API_KEY_2: String(parsed.GEMINI_API_KEY_2 || "")
    };
  } catch (error) {
    console.warn("[desktop] Could not read encrypted settings:", error.message);
    return {};
  }
}
function getWorkerEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "worker", "server.js")
    : path.resolve(__dirname, "..", "worker", "server.js");
}
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
async function waitForWorker(timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (!workerProcess) throw new Error("The local video worker stopped unexpectedly.");
    try {
      const response = await fetch(workerUrl + "/version", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("CAPTIFY's local FFmpeg worker did not start. " + (lastError ? lastError.message : ""));
}
async function startWorker() {
  const settings = readSettings();
  if (!settings.GROQ_API_KEY) throw new Error("A Groq API key is required for speech transcription. Open Settings to add it.");
  const workerEntry = getWorkerEntry();
  if (!fs.existsSync(workerEntry)) throw new Error("Local worker files are missing: " + workerEntry + ". Rebuild the Windows installer.");
  await fs.promises.mkdir(STORAGE_DIR, { recursive: true });
  workerPort = await reservePort();
  workerSecret = crypto.randomBytes(32).toString("hex");
  workerUrl = "http://127.0.0.1:" + workerPort;
  const child = utilityProcess.fork(workerEntry, [], {
    cwd: path.dirname(workerEntry),
    serviceName: "CAPTIFY Local FFmpeg Worker",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(workerPort),
      HOST: "127.0.0.1",
      STORAGE_DIR,
      WORKER_SECRET: workerSecret,
      NEXT_APP_URL: "",
      CAPTIFY_DESKTOP: "1",
      GROQ_API_KEY: settings.GROQ_API_KEY,
      GEMINI_API_KEY: settings.GEMINI_API_KEY,
      GEMINI_API_KEY_2: settings.GEMINI_API_KEY_2,
      GEMINI_API_KEY2: settings.GEMINI_API_KEY_2,
      FFMPEG_THREADS: "2"
    }
  });
  workerProcess = child;
  child.on("exit", (code) => {
    console.warn("[desktop] Local worker exited with code", code);
    if (workerProcess === child) {
      workerProcess = null;
      workerUrl = "";
      workerPort = 0;
      workerSecret = "";
    }
  });
  try { await waitForWorker(); } catch (error) { await stopWorker(); throw error; }
}
async function stopWorker() {
  const child = workerProcess;
  workerProcess = null;
  workerUrl = "";
  workerPort = 0;
  workerSecret = "";
  if (!child) return;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    child.once("exit", finish);
    const timeout = setTimeout(finish, 2500);
    try { child.kill(); } catch { finish(); }
  });
}
function workerHeaders(extra = {}) {
  return { "x-worker-secret": workerSecret, ...extra };
}
function safeJobId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid job ID.");
  return id;
}
function safeWorkerPath(value, allowedPaths) {
  const pathname = String(value || "");
  if (!allowedPaths.some((pattern) => pattern.test(pathname))) throw new Error("This local worker endpoint is not allowed.");
  return pathname;
}
async function requestWorker(pathname, body) {
  const safePath = safeWorkerPath(pathname, [/^\/analyze$/, /^\/render-selected$/, /^\/health$/, /^\/version$/]);
  const isRead = safePath === "/health" || safePath === "/version";
  const response = await fetch(workerUrl + safePath, {
    method: isRead ? "GET" : "POST",
    headers: workerHeaders({ "Content-Type": "application/json" }),
    body: isRead ? undefined : JSON.stringify({ ...(body || {}), statusUrl: "" }),
    signal: AbortSignal.timeout(isRead ? 8000 : 15000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 1000) }; }
  return { ok: response.ok, status: response.status, data };
}
function toLocalClipUrl(jobId, originalUrl) {
  const match = String(originalUrl || "").match(/(?:\/api\/download|\/download)\/[a-zA-Z0-9_-]+\/(clip-\d+-(?:raw|edited)\.mp4)$/i);
  if (!match) return originalUrl;
  return "captify-local://download/" + encodeURIComponent(jobId) + "/" + encodeURIComponent(match[1]);
}
function normalizeStatus(status, jobId) {
  if (!status || typeof status !== "object") return status;
  const id = safeJobId(status.jobId || jobId);
  return {
    ...status,
    clips: Array.isArray(status.clips) ? status.clips.map((clip) => ({
      ...clip,
      rawUrl: toLocalClipUrl(id, clip.rawUrl),
      editedUrl: toLocalClipUrl(id, clip.editedUrl)
    })) : status.clips
  };
}
async function getWorkerStatus(jobId) {
  const id = safeJobId(jobId);
  const response = await fetch(workerUrl + "/status/" + encodeURIComponent(id), {
    headers: workerHeaders(), cache: "no-store", signal: AbortSignal.timeout(8000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 1000) }; }
  if (response.status === 404) {
    return { ok: true, status: 200, data: { jobId: id, status: "queued", progress: 0, message: "Waiting for the local worker..." } };
  }
  return { ok: response.ok, status: response.status, data: normalizeStatus(data, id) };
}
async function uploadChunk(payload) {
  const pathname = safeWorkerPath(payload.pathname, [
    /^\/upload-analysis\/[a-zA-Z0-9_-]{1,128}$/,
    /^\/upload-clip\/[a-zA-Z0-9_-]{1,128}\/[1-7]$/
  ]);
  const bytes = Buffer.from(payload.bytes);
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error("Upload chunks must be between 1 byte and 32 MB.");
  const contentRange = String(payload.contentRange || "");
  if (!/^bytes \d+-\d+\/\d+$/.test(contentRange)) throw new Error("Invalid upload range.");
  const contentType = String(payload.contentType || "application/octet-stream").slice(0, 120);
  const response = await fetch(workerUrl + pathname, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(bytes.length), "Content-Range": contentRange },
    body: bytes,
    signal: AbortSignal.timeout(120000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 1000) }; }
  return { ok: response.ok, status: response.status, data };
}
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 640, height: 650, minWidth: 560, minHeight: 560, title: "CAPTIFY Settings",
    parent: mainWindow || undefined, modal: Boolean(mainWindow), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; if (!mainWindow && !isSavingSettings) app.quit(); });
}
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1040, minHeight: 700, backgroundColor: "#030303",
    title: "CAPTIFY", autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).origin !== new URL(APP_URL).origin) shell.openExternal(url); } catch {}
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    try { if (new URL(targetUrl).origin !== new URL(APP_URL).origin) event.preventDefault(); } catch { event.preventDefault(); }
  });
  mainWindow.loadURL(APP_URL);
  mainWindow.on("closed", () => { mainWindow = null; });
}
async function openLocalClip(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parsed.hostname !== "download" || parts.length !== 2) return new Response("Not found", { status: 404 });
  const jobId = safeJobId(decodeURIComponent(parts[0]));
  const filename = decodeURIComponent(parts[1]);
  if (!/^clip-\d+-(raw|edited)\.mp4$/i.test(filename)) return new Response("Invalid filename", { status: 400 });
  const response = await fetch(workerUrl + "/download/" + encodeURIComponent(jobId) + "/" + encodeURIComponent(filename), {
    headers: workerHeaders(), signal: AbortSignal.timeout(120000)
  });
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

ipcMain.handle("desktop:runtime", async (event) => {
  assertTrustedSender(event);
  return { isDesktop: true, platform: process.platform, workerReady: Boolean(workerProcess && workerUrl), workerUrl: workerUrl ? "local" : "", version: app.getVersion() };
});
ipcMain.handle("desktop:worker-request", async (event, pathname, body) => {
  assertTrustedSender(event);
  if (!workerProcess || !workerUrl) throw new Error("The local video worker is not running.");
  return requestWorker(pathname, body);
});
ipcMain.handle("desktop:upload-chunk", async (event, payload) => {
  assertTrustedSender(event);
  if (!workerProcess || !workerUrl) throw new Error("The local video worker is not running.");
  return uploadChunk(payload || {});
});
ipcMain.handle("desktop:job-status", async (event, jobId) => {
  assertTrustedSender(event);
  if (!workerProcess || !workerUrl) throw new Error("The local video worker is not running.");
  return getWorkerStatus(jobId);
});
ipcMain.handle("desktop:settings-status", async (event) => {
  assertTrustedSender(event);
  const settings = readSettings();
  return { hasGroqKey: Boolean(settings.GROQ_API_KEY), hasGeminiKey: Boolean(settings.GEMINI_API_KEY || settings.GEMINI_API_KEY_2) };
});
ipcMain.handle("desktop:save-settings", async (event, input) => {
  assertTrustedSender(event);
  const existing = readSettings();
  const submittedGroq = String(input && input.groqApiKey || "").trim();
  const submittedGemini1 = String(input && input.geminiApiKey || "").trim();
  const submittedGemini2 = String(input && input.geminiApiKey2 || "").trim();
  const groq = submittedGroq || existing.GROQ_API_KEY || "";
  const gemini1 = submittedGemini1 || existing.GEMINI_API_KEY || "";
  const gemini2 = submittedGemini2 || existing.GEMINI_API_KEY_2 || "";
  if (groq.length < 10) throw new Error("Enter a valid Groq API key to enable speech transcription.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable on this device.");
  await fs.promises.mkdir(USER_DATA_DIR, { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify({ GROQ_API_KEY: groq, GEMINI_API_KEY: gemini1, GEMINI_API_KEY_2: gemini2 }));
  const temporarySettingsPath = SETTINGS_PATH + ".tmp";
  await fs.promises.writeFile(temporarySettingsPath, encrypted, { mode: 0o600 });
  await fs.promises.rename(temporarySettingsPath, SETTINGS_PATH);
  isSavingSettings = true;
  try { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); } catch {}
  try {
    await stopWorker();
    await startWorker();
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else mainWindow.reload();
    return { ok: true };
  } catch (error) {
    createSettingsWindow();
    throw new Error(error.message || "Could not start the local worker.");
  } finally {
    isSavingSettings = false;
  }
});
ipcMain.handle("desktop:open-settings", async (event) => {
  assertTrustedSender(event);
  createSettingsWindow();
  return { ok: true };
});

app.whenReady().then(async () => {
  protocol.handle("captify-local", async (request) => {
    try {
      if (!workerProcess || !workerUrl) return new Response("Local worker is not running", { status: 503 });
      return await openLocalClip(request.url);
    } catch (error) { return new Response(error.message || "Local download failed", { status: 500 }); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "CAPTIFY", submenu: [{ label: "Settings", click: () => createSettingsWindow() }, { label: "Open Output Folder", click: () => { void shell.openPath(STORAGE_DIR); } }, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }
  ]));
  if (!readSettings().GROQ_API_KEY) { createSettingsWindow(); return; }
  try { await startWorker(); createMainWindow(); }
  catch (error) { dialog.showErrorBox("CAPTIFY local worker could not start", error.message || String(error)); createSettingsWindow(); }
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createSettingsWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void stopWorker(); });
