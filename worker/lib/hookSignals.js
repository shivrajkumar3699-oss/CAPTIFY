const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

function detectAudioEvents(audioPath) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !audioPath) return resolve([]);
    let stderr = "";
    let settled = false;
    const finish = (events) => {
      if (settled) return;
      settled = true;
      resolve(events.slice(0, 80));
    };
    let child;
    try {
      child = spawn(ffmpegPath, [
        "-hide_banner", "-nostats", "-i", audioPath,
        "-af", "silencedetect=noise=-34dB:d=0.35",
        "-f", "null", "-"
      ], { stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      return finish([]);
    }
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    child.on("error", () => finish([]));
    child.on("close", () => {
      const events = [];
      const startPattern = /silence_start:\s*([0-9.]+)/g;
      const endPattern = /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g;
      let match;
      while ((match = startPattern.exec(stderr)) !== null) {
        const time = Number(match[1]);
        if (Number.isFinite(time)) events.push({ time, strength: 0.35, type: "silence-start" });
      }
      while ((match = endPattern.exec(stderr)) !== null) {
        const time = Number(match[1]);
        const duration = Number(match[2]);
        if (Number.isFinite(time)) events.push({ time, strength: Math.min(1, Math.max(0.35, duration / 1.8)), type: "silence-end" });
      }
      events.sort((a, b) => a.time - b.time);
      finish(events);
    });
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish([]);
    }, 20000);
    child.on("close", () => clearTimeout(timeout));
    child.on("error", () => clearTimeout(timeout));
  });
}
module.exports = { detectAudioEvents };
