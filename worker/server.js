// worker/server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const { extractAudio, transcribeWithTimestamps } = require("./lib/transcribe");
const { detectHookSegments } = require("./lib/detectHooks");
const {
  getVideoDuration,
  cutRawClip,
  buildEditedClip,
} = require("./lib/pipeline");
const { buildAssCaptions } = require("./lib/captions");
const { chooseBgmForSegment } = require("./lib/bgmMap");
const { convertWords } = require("./lib/convertWords");

const app = express();

app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT) || 8080;
const WORKER_SECRET = process.env.WORKER_SECRET;
const STORAGE_DIR = process.env.STORAGE_DIR;
const NEXT_APP_URL =
  process.env.NEXT_APP_URL || "http://localhost:3000";

const BGM_DIR = path.join(__dirname, "assets", "bgm");

// Active job status is kept in memory on the worker as a live source of truth.
// The browser can read this through the protected status endpoint, while the
// database callback remains as a durable fallback.
const activeJobStatuses = new Map();

const ALLOWED_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "mp4",
  "mkv",
]);

// ------------------------------------------------------------
// Startup validation
// ------------------------------------------------------------

if (!WORKER_SECRET) {
  console.warn(
    "WARNING: WORKER_SECRET is not configured."
  );
}

if (!STORAGE_DIR) {
  console.warn(
    "WARNING: STORAGE_DIR is not configured."
  );
}

// ------------------------------------------------------------
// Authentication
// ------------------------------------------------------------

function checkSecret(req, res, next) {
  const secret = req.headers["x-worker-secret"];

  if (!WORKER_SECRET || secret !== WORKER_SECRET) {
    return res.status(401).json({
      error: "unauthorized",
    });
  }

  next();
}

// ------------------------------------------------------------
// Push status back to Next.js
// ------------------------------------------------------------

async function pushStatus(jobId, statusUpdate, statusBaseUrl = NEXT_APP_URL) {
  // Always update the worker's live status first. This prevents the UI from
  // depending entirely on a remote callback while a job is actively running.
  const previous = activeJobStatuses.get(jobId) || {};
  activeJobStatuses.set(jobId, {
    ...previous,
    jobId,
    ...statusUpdate,
  });

  if (!statusBaseUrl) {
    console.error(`[${jobId}] NEXT_APP_URL is not configured`);
    return false;
  }

  const url = `${statusBaseUrl.replace(/\/+$/, "")}/api/internal/status`;
  const payload = { jobId, ...statusUpdate };

  // The UI depends on these callbacks. Retry transient Vercel/network
  // failures so the browser cannot remain stuck while rendering succeeds.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": WORKER_SECRET || "",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return true;
      }

      const body = await response.text().catch(() => "");
      console.error(
        `[${jobId}] Status callback failed (attempt ${attempt}/3): HTTP ${response.status}${body ? ` — ${body.slice(0, 300)}` : ""}`
      );
    } catch (err) {
      clearTimeout(timeout);
      console.error(
        `[${jobId}] Status callback failed (attempt ${attempt}/3):`,
        err?.message || err
      );
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  return false;
}

// ------------------------------------------------------------
// LIVE STATUS ENDPOINT
// ------------------------------------------------------------

app.get("/status/:jobId", checkSecret, (req, res) => {
  const jobId = String(req.params.jobId || "").trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return res.status(400).json({ error: "Invalid jobId" });
  }

  const status = activeJobStatuses.get(jobId);

  if (!status) {
    return res.status(404).json({ error: "Job status not found" });
  }

  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.json(status);
});

// ------------------------------------------------------------
// SNAP
// ------------------------------------------------------------

function snapSegmentToWords(seg, words, videoDuration) {
  let start = Number(seg.startTime);
  let end = Number(seg.endTime);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return seg;
  }

  const PRE_ROLL = 0.12;
  const TAIL = 0.35;
  const MIN_LENGTH = 5;

  // Find first word that overlaps the requested start.
  const firstWord = words.find(
    (w) => Number(w.end) > start
  );

  if (
    firstWord &&
    Number(firstWord.start) < end - MIN_LENGTH
  ) {
    start = Math.max(
      0,
      Number(firstWord.start) - PRE_ROLL
    );
  }

  // Find the last word that starts before requested end.
  let lastWord = null;

  for (let i = words.length - 1; i >= 0; i--) {
    if (Number(words[i].start) < end) {
      lastWord = words[i];
      break;
    }
  }

  if (
    lastWord &&
    Number(lastWord.end) + TAIL >
      start + MIN_LENGTH
  ) {
    end =
      Number(lastWord.end) +
      TAIL;
  }

  end = Math.min(
    end,
    videoDuration
  );

  if (end - start < 1) {
    return seg;
  }

  return {
    ...seg,
    startTime: start,
    endTime: end,
  };
}

// ------------------------------------------------------------
// DIRECT CHUNKED UPLOAD
// ------------------------------------------------------------

const MAX_UPLOAD_SIZE = 3 * 1024 * 1024 * 1024;
const MAX_CHUNK_SIZE = 32 * 1024 * 1024;

function uploadCors(req, res, next) {
  // Upload endpoint is intentionally unauthenticated so the browser can
  // stream multi-GB chunks directly to Render without exposing WORKER_SECRET.
  // The jobId is a cryptographically random UUID created by the authenticated app.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Content-Range, X-Upload-Total, X-Upload-Offset"
  );

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

app.options("/upload/:jobId/:ext", uploadCors);

app.put("/upload/:jobId/:ext", uploadCors, async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  const ext = String(req.params.ext || "").trim().toLowerCase();

  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) return res.status(400).json({ error: "Invalid jobId." });
  if (!ALLOWED_EXTENSIONS.has(ext)) return res.status(400).json({ error: "Unsupported file type." });

  const total = Number(req.headers["x-upload-total"]);
  const offset = Number(req.headers["x-upload-offset"]);
  const contentLength = Number(req.headers["content-length"]);

  if (
    !Number.isSafeInteger(total) || total <= 0 || total > MAX_UPLOAD_SIZE ||
    !Number.isSafeInteger(offset) || offset < 0 ||
    !Number.isSafeInteger(contentLength) || contentLength <= 0 ||
    contentLength > MAX_CHUNK_SIZE || offset + contentLength > total
  ) {
    return res.status(400).json({ error: "Invalid upload chunk." });
  }

  const range = String(req.headers["content-range"] || "");
  const expectedRange = `bytes ${offset}-${offset + contentLength - 1}/${total}`;
  if (range !== expectedRange) {
    return res.status(400).json({ error: "Invalid Content-Range.", expected: expectedRange });
  }

  if (!STORAGE_DIR) return res.status(500).json({ error: "STORAGE_DIR is not configured." });

  const sourcePath = path.join(STORAGE_DIR, "uploads", jobId, `source.${ext}`);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });

  try {
    if (offset === 0 && !fs.existsSync(sourcePath)) {
      const fd = fs.openSync(sourcePath, "w");
      try { fs.ftruncateSync(fd, total); } finally { fs.closeSync(fd); }
    } else if (!fs.existsSync(sourcePath)) {
      return res.status(409).json({ error: "Upload must start with the first chunk." });
    }

    const writeStream = fs.createWriteStream(sourcePath, { flags: "r+", start: offset });
    await pipelineRequest(req, writeStream);

    const complete = offset + contentLength === total;
    return res.status(complete ? 201 : 204).json(
      complete ? { ok: true, complete: true, bytes: total } : undefined
    );
  } catch (error) {
    console.error(`[upload:${jobId}] Chunk failed:`, error?.message || error);
    return res.status(500).json({ error: "Upload chunk failed." });
  }
});

function pipelineRequest(req, destination) {
  return new Promise((resolve, reject) => {
    req.on("error", reject);
    destination.on("error", reject);
    destination.on("finish", resolve);
    req.pipe(destination);
  });
}

// ------------------------------------------------------------
// PROCESS ENDPOINT
// ------------------------------------------------------------

app.post("/process", checkSecret, (req, res) => {
  const { jobId, ext, sourcePath, options, statusUrl } = req.body || {};

  if (!jobId || !ext || !sourcePath) {
    return res.status(400).json({ error: "jobId, ext, and sourcePath are required" });
  }

  const cleanJobId = String(jobId).trim();
  const cleanExt = String(ext).trim().toLowerCase();
  const cleanSourcePath = String(sourcePath).trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(cleanJobId)) return res.status(400).json({ error: "Invalid jobId" });
  if (!ALLOWED_EXTENSIONS.has(cleanExt)) return res.status(400).json({ error: "Unsupported file type." });

  const expectedSource = `uploads/${cleanJobId}/source.${cleanExt}`;
  if (cleanSourcePath !== expectedSource) return res.status(400).json({ error: "Invalid sourcePath" });

  const localSourcePath = path.join(STORAGE_DIR || "", "uploads", cleanJobId, `source.${cleanExt}`);
  if (!STORAGE_DIR || !fs.existsSync(localSourcePath)) {
    return res.status(404).json({ error: "Uploaded source file is not ready." });
  }

  const sourceStats = fs.statSync(localSourcePath);
  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    return res.status(400).json({ error: "Uploaded source file is invalid." });
  }

  res.status(202).json({ received: true, jobId: cleanJobId, status: "queued" });

  // Pass the site origin to pushStatus(). pushStatus() itself appends
  // /api/internal/status. Passing the endpoint here would create the old
  // /api/internal/status/api/internal/status bug.
  const callbackStatusUrl =
    typeof statusUrl === "string" && /^https?:\/\//i.test(statusUrl)
      ? statusUrl.replace(/\/+$/, "")
      : NEXT_APP_URL.replace(/\/+$/, "");

  runPipeline(cleanJobId, cleanExt, localSourcePath, options || {}, callbackStatusUrl).catch(async (err) => {
    console.error(`[${cleanJobId}] Pipeline crashed:`, err);
    await pushStatus(cleanJobId, {
      status: "error",
      progress: 0,
      message: "Processing failed",
      error: err?.message || "Unknown processing error",
    }, callbackStatusUrl);
  });
});

// ------------------------------------------------------------
// MAIN PIPELINE
// ------------------------------------------------------------

async function runPipeline(
  jobId,
  ext,
  sourcePath,
  options,
  statusBaseUrl = NEXT_APP_URL
) {
  if (!STORAGE_DIR) {
    throw new Error(
      "STORAGE_DIR is not configured"
    );
  }

  const resultsDir = path.join(
    STORAGE_DIR,
    "results",
    jobId
  );

  const tmpDir = path.join(
    STORAGE_DIR,
    "tmp",
    jobId
  );

  fs.mkdirSync(
    resultsDir,
    { recursive: true }
  );

  fs.mkdirSync(
    tmpDir,
    { recursive: true }
  );

  const clipCount = Math.max(
    1,
    Math.min(
      7,
      Number(
        options.clipCount ||
        options.numClips ||
        6
      ) || 6
    )
  );

  const useBgm = Boolean(
    options.useBgm ||
    options.bgm
  );

  const captionColor =
    typeof options.captionColor === "string" &&
    options.captionColor.trim()
      ? options.captionColor.trim()
      : "#FFD700";

  const framing =
    options.framing === "fill"
      ? "fill"
      : "fit";

  const audioLanguage =
    options.audioLanguage ||
    "auto";

  const captionLanguage =
    options.captionLanguage ||
    "same";

  const usedBgmFiles = new Set();
  const reportStatus = (update) => pushStatus(jobId, update, statusBaseUrl);

  try {
    // ----------------------------------------------------------
    // Validate source
    // ----------------------------------------------------------

    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Source file not found at ${sourcePath}`
      );
    }

    const sourceStats =
      fs.statSync(sourcePath);

    if (
      !sourceStats.isFile() ||
      sourceStats.size <= 0
    ) {
      throw new Error(
        "Uploaded source file is empty or invalid"
      );
    }

    console.log(
      `[${jobId}] Source: ${sourcePath}`
    );

    console.log(
      `[${jobId}] Size: ${sourceStats.size} bytes`
    );

    // ----------------------------------------------------------
    // Step 1: Extract audio
    // ----------------------------------------------------------

    await reportStatus({
      status: "transcribing",
      progress: 5,
      message: "Extracting audio",
    });

    const audioPath = path.join(
      tmpDir,
      "audio.mp3"
    );

    await extractAudio(
      sourcePath,
      audioPath
    );

    // ----------------------------------------------------------
    // Step 2: Transcribe
    // ----------------------------------------------------------

    await reportStatus({
      status: "transcribing",
      progress: 20,
      message: "Transcribing audio",
    });

    const transcription =
      await transcribeWithTimestamps(
        audioPath,
        audioLanguage
      );

    const text =
      transcription?.text;

    const words =
      transcription?.words;

    if (
      !Array.isArray(words) ||
      words.length === 0
    ) {
      throw new Error(
        "Transcription returned no words. Check the audio and GROQ_API_KEY."
      );
    }

    if (
      typeof text !== "string" ||
      !text.trim()
    ) {
      throw new Error(
        "Transcription returned no transcript text."
      );
    }

    console.log(
      `[${jobId}] Transcript received: ` +
      `${text.length} characters, ` +
      `${words.length} words`
    );

    // ----------------------------------------------------------
    // Step 2.5: Caption language conversion
    // ----------------------------------------------------------

    let captionWords = words;

    if (
      captionLanguage !== "same"
    ) {
      await reportStatus({
        status: "transcribing",
        progress: 30,
        message:
          "Converting captions to selected language",
      });

      captionWords =
        await convertWords(
          words,
          captionLanguage,
          audioLanguage
        );

      if (
        !Array.isArray(captionWords) ||
        captionWords.length === 0
      ) {
        throw new Error(
          "Caption conversion returned no words"
        );
      }
    }

    // ----------------------------------------------------------
    // Step 3: Video duration
    // ----------------------------------------------------------

    const videoDuration =
      await getVideoDuration(
        sourcePath
      );

    if (
      !Number.isFinite(videoDuration) ||
      videoDuration <= 0
    ) {
      throw new Error(
        "Could not determine source video duration"
      );
    }

    console.log(
      `[${jobId}] Video duration: ${videoDuration.toFixed(2)}s`
    );

    // ----------------------------------------------------------
    // Step 4: Hook detection
    // ----------------------------------------------------------

    await reportStatus({
      status: "detecting_hooks",
      progress: 40,
      message:
        "Finding the best hooks",
    });

    const segments =
      await detectHookSegments(
        text,
        clipCount,
        videoDuration,
        words
      );

    if (
      !Array.isArray(segments) ||
      segments.length === 0
    ) {
      throw new Error(
        "No hook segments were detected"
      );
    }

    const selectedSegments =
      segments.slice(
        0,
        clipCount
      );

    // ----------------------------------------------------------
    // Step 5: Render clips
    // ----------------------------------------------------------

    const clips = [];

    const total =
      selectedSegments.length;

    for (
      let i = 0;
      i < total;
      i++
    ) {
      const originalSegment =
        selectedSegments[i];

      const seg =
        snapSegmentToWords(
          originalSegment,
          words,
          videoDuration
        );

      const clipNum = i + 1;

      const baseProgress =
        45 +
        Math.round(
          (i / total) * 50
        );

      await reportStatus({
        status: "rendering",
        progress: baseProgress,
        message:
          `Rendering clip ${clipNum} of ${total}`,
      });

      const rawFilename =
        `clip-${clipNum}-raw.mp4`;

      const editedFilename =
        `clip-${clipNum}-edited.mp4`;

      const rawOutPath =
        path.join(
          resultsDir,
          rawFilename
        );

      const editedOutPath =
        path.join(
          resultsDir,
          editedFilename
        );

      const assPath =
        path.join(
          tmpDir,
          `captions-${clipNum}.ass`
        );

      const clipDuration =
        Math.max(
          0.1,
          Number(seg.endTime) -
            Number(seg.startTime)
        );

      console.log(
        `[${jobId}] clip ${clipNum}: ` +
        `${Number(seg.startTime).toFixed(1)}s - ` +
        `${Number(seg.endTime).toFixed(1)}s ` +
        `(${clipDuration.toFixed(1)}s) ` +
        `"${seg.title || ""}"`
      );

      // --------------------------------------------------------
      // Raw clip
      // --------------------------------------------------------

      await cutRawClip(
        sourcePath,
        Number(seg.startTime),
        Number(seg.endTime),
        rawOutPath
      );

      // --------------------------------------------------------
      // Captions
      // --------------------------------------------------------

      buildAssCaptions(
        captionWords,
        Number(seg.startTime),
        Number(seg.endTime),
        captionColor,
        assPath
      );

      // --------------------------------------------------------
      // BGM
      // --------------------------------------------------------

      const bgmPath = useBgm
        ? chooseBgmForSegment(
            seg.title,
            seg.hookReason,
            usedBgmFiles,
            BGM_DIR
          )
        : null;

      // --------------------------------------------------------
      // Edited clip
      // --------------------------------------------------------

      await buildEditedClip(
        rawOutPath,
        assPath,
        clipDuration,
        bgmPath,
        editedOutPath,
        framing
      );

      clips.push({
        index: i,
        title:
          seg.title ||
          `Clip ${clipNum}`,

        hookReason:
          seg.hookReason ||
          "",

        startTime:
          Number(seg.startTime),

        endTime:
          Number(seg.endTime),

        rawUrl:
          `/api/download/${jobId}/${rawFilename}`,

        editedUrl:
          `/api/download/${jobId}/${editedFilename}`,
      });

      // Give frontend a little more precise progress.
      await reportStatus({
        status: "rendering",
        progress:
          45 +
          Math.round(
            ((i + 1) / total) * 50
          ),
        message:
          `Clip ${clipNum} of ${total} completed`,
      });
    }

    // ----------------------------------------------------------
    // Step 6: Cleanup temporary files
    // ----------------------------------------------------------

    try {
      fs.rmSync(
        tmpDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch (cleanupError) {
      console.error(
        `[${jobId}] tmp cleanup failed (non-fatal):`,
        cleanupError.message
      );
    }

    // ----------------------------------------------------------
    // Step 7: Done
    // ----------------------------------------------------------

    await reportStatus({
      status: "done",
      progress: 100,
      message:
        `${clips.length} clip${clips.length === 1 ? "" : "s"} ready`,
      clips,
    });

    // Keep rendered results available so the browser can preview/download
    // the clips after the job reaches 100%. Source uploads are still removed.
    try {
      fs.rmSync(path.join(STORAGE_DIR, "uploads", jobId), {
        recursive: true,
        force: true,
      });
    } catch (cleanupError) {
      console.warn(
        `[${jobId}] source cleanup failed:`,
        cleanupError?.message || cleanupError
      );
    }

    console.log(
      `[${jobId}] Pipeline completed successfully`
    );
  } catch (err) {
    try {
      fs.rmSync(
        tmpDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch (cleanupError) {
      // Non-fatal.
    }

    try {
      fs.rmSync(path.join(STORAGE_DIR, "uploads", jobId), { recursive: true, force: true });
    } catch {}

    throw err;
  }
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// DOWNLOAD ENDPOINT
// ------------------------------------------------------------

app.get("/download/:jobId/:filename", checkSecret, (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  const filename = String(req.params.filename || "").trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return res.status(400).json({ error: "Invalid jobId" });
  }

  if (!/^clip-\d+-(raw|edited)\.mp4$/i.test(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  if (!STORAGE_DIR) {
    return res.status(500).json({ error: "STORAGE_DIR is not configured" });
  }

  const resultsRoot = path.resolve(STORAGE_DIR, "results", jobId);
  const filePath = path.resolve(resultsRoot, filename);

  if (!filePath.startsWith(resultsRoot + path.sep)) {
    return res.status(400).json({ error: "Invalid file path" });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  return res.download(filePath, filename);
});

// Health check
// ------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "captify-worker",
  });
});

// ------------------------------------------------------------
// Start worker
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `Captify worker listening on port ${PORT}`
  );

  console.log(
    `STORAGE_DIR = ${STORAGE_DIR}`
  );

  console.log(
    `NEXT_APP_URL = ${NEXT_APP_URL}`
  );
});