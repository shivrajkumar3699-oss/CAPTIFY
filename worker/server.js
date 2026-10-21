// worker/server.js

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Transform } = require("stream");

const {
  transcribeWithTimestamps,
} = require("./lib/transcribe");

const {
  detectHookSegments,
} = require("./lib/detectHooks");

const {
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
  buildEditedClip,
  getVideoInfo,
} = require("./lib/pipeline");

const {
  buildAssCaptions,
} = require("./lib/captions");

const {
  chooseBgmForSegment,
} = require("./lib/bgmMap");

const {
  convertWords,
} = require("./lib/convertWords");

const app = express();

app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT) || 8080;
const WORKER_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const WORKER_SECRET = process.env.WORKER_SECRET;
const STORAGE_DIR = process.env.STORAGE_DIR;

const NEXT_APP_URL =
  process.env.NEXT_APP_URL || "http://localhost:3000";

const BGM_DIR = path.join(__dirname, "assets", "bgm");

// ------------------------------------------------------------
// CONSTANTS
// ------------------------------------------------------------

const MAX_UPLOAD_SIZE = 3 * 1024 * 1024 * 1024;
const MAX_CHUNK_SIZE = 32 * 1024 * 1024;

const MAX_ANALYSIS_AUDIO_SIZE = 512 * 1024 * 1024;
const MAX_HOOK_CLIP_SIZE = 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "mp4",
  "mkv",
  "mov",
]);

const activeJobStatuses = new Map();
const activeSmartRenders = new Set();

// Render Free has very limited CPU/RAM. Keep selected-clip renders
// serialized so simultaneous users/jobs cannot spawn multiple heavy FFmpeg
// encoders and cause the worker process to be restarted.
const smartRenderQueue = [];
let smartRenderRunning = false;

function drainSmartRenderQueue() {
  if (smartRenderRunning) return;

  const job = smartRenderQueue.shift();
  if (!job) return;

  smartRenderRunning = true;
  console.log(
    `[${job.jobId}] Starting queued render; waiting jobs=${smartRenderQueue.length}`
  );

  (async () => {
    try {
      await runSmartRender(
        job.jobId,
        job.segments,
        job.metadata,
        job.options,
        job.callbackStatusUrl
      );
    } catch (err) {
      console.error(
        `[${job.jobId}] Smart render crashed:`,
        err
      );

      await pushStatus(
        job.jobId,
        {
          status: "error",
          progress: 0,
          message: "Rendering failed",
          error: err?.message || "Unknown rendering error",
        },
        job.callbackStatusUrl
      );
    } finally {
      activeSmartRenders.delete(job.jobId);
      smartRenderRunning = false;
      // Yield before starting the next job, letting Node flush callbacks/logs.
      setImmediate(drainSmartRenderQueue);
    }
  })();
}

const BUILD_COMMIT =
  process.env.RENDER_GIT_COMMIT ||
  process.env.RENDER_GIT_COMMIT_SHA ||
  "unknown";

const PIPELINE_VERSION =
  "2026-10-single-pass-logo-overlay-v3";

const STATUS_DIR = path.join(
  STORAGE_DIR || "",
  "status"
);

function getPersistentStatusPath(jobId) {
  return path.join(
    STATUS_DIR,
    String(jobId) + ".json"
  );
}

function savePersistentStatus(jobId, status) {
  if (!STORAGE_DIR) return;

  fs.mkdirSync(
    STATUS_DIR,
    { recursive: true }
  );

  const target =
    getPersistentStatusPath(jobId);

  const temp =
    target + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify(status, null, 2),
    "utf8"
  );

  fs.renameSync(
    temp,
    target
  );
}

function loadPersistentStatus(jobId) {
  if (!STORAGE_DIR) return null;

  const target =
    getPersistentStatusPath(jobId);

  if (!fs.existsSync(target)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        target,
        "utf8"
      )
    );
  } catch (error) {
    console.warn(
      "[status] Could not read persistent status:",
      error?.message || error
    );
    return null;
  }
}

// ------------------------------------------------------------
// STARTUP VALIDATION
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
// AUTHENTICATION
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
// JOB PATHS
// ------------------------------------------------------------

function getJobRoot(jobId) {
  return path.join(
    STORAGE_DIR || "",
    "smart",
    jobId
  );
}

function getAnalysisPath(jobId) {
  return path.join(
    getJobRoot(jobId),
    "analysis",
    "audio.mp3"
  );
}

function getHookUploadDir(jobId) {
  return path.join(
    getJobRoot(jobId),
    "hooks"
  );
}

function getHookUploadPath(jobId, clipNumber) {
  return path.join(
    getHookUploadDir(jobId),
    `clip-${clipNumber}.mp4`
  );
}

function getMetadataPath(jobId) {
  return path.join(
    getJobRoot(jobId),
    "analysis.json"
  );
}

function getResultsDir(jobId) {
  return path.join(
    STORAGE_DIR || "",
    "results",
    jobId
  );
}

function getTmpDir(jobId) {
  return path.join(
    STORAGE_DIR || "",
    "tmp",
    `smart-${jobId}`
  );
}

// ------------------------------------------------------------
// METADATA HELPERS
// ------------------------------------------------------------

function saveSmartMetadata(jobId, data) {
  const metadataPath = getMetadataPath(jobId);

  fs.mkdirSync(
    path.dirname(metadataPath),
    { recursive: true }
  );

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function loadSmartMetadata(jobId) {
  const metadataPath = getMetadataPath(jobId);

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(metadataPath, "utf8")
    );
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// PUSH STATUS
// ------------------------------------------------------------

async function pushStatus(
  jobId,
  statusUpdate,
  statusBaseUrl = NEXT_APP_URL
) {
  const previous =
    activeJobStatuses.get(jobId) ||
    loadPersistentStatus(jobId) ||
    {};

  const nextStatus = {
    ...previous,
    jobId,
    ...statusUpdate,
    updatedAt:
      new Date().toISOString(),
  };

  activeJobStatuses.set(
    jobId,
    nextStatus
  );

  try {
    savePersistentStatus(
      jobId,
      nextStatus
    );
  } catch (error) {
    console.warn(
      "[" +
      jobId +
      "] Could not persist status:",
      error?.message || error
    );
  }

  if (!statusBaseUrl) {
    console.error(
      `[${jobId}] NEXT_APP_URL is not configured`
    );
    return false;
  }

  const cleanStatusBaseUrl = String(statusBaseUrl).endsWith("/")
    ? String(statusBaseUrl).slice(0, -1)
    : String(statusBaseUrl);

  const url =
    `${cleanStatusBaseUrl}/api/internal/status`;

  const payload = {
    jobId,
    ...statusUpdate,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      15000
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret":
            WORKER_SECRET || "",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return true;
      }

      const body =
        await response.text().catch(() => "");

      console.error(
        `[${jobId}] Status callback failed ` +
        `(attempt ${attempt}/3): HTTP ${response.status}` +
        `${body ? ` — ${body.slice(0, 300)}` : ""}`
      );
    } catch (err) {
      clearTimeout(timeout);

      console.error(
        `[${jobId}] Status callback failed ` +
        `(attempt ${attempt}/3):`,
        err?.message || err
      );
    }

    if (attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          1000 * attempt
        )
      );
    }
  }

  return false;
}

// ------------------------------------------------------------
// BUILD VERSION
// ------------------------------------------------------------

app.get(
  "/version",
  (req, res) => {
    return res.json({
      ok: true,
      commit: BUILD_COMMIT,
      pipeline: PIPELINE_VERSION,
      output: {
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
      },
      instanceId:
        WORKER_INSTANCE_ID,
    });
  }
);

// ------------------------------------------------------------
// LIVE STATUS ENDPOINT
// ------------------------------------------------------------

app.get(
  "/status/:jobId",
  checkSecret,
  (req, res) => {
    const jobId =
      String(req.params.jobId || "").trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return res.status(400).json({
        error: "Invalid jobId",
      });
    }

    const status =
      activeJobStatuses.get(jobId) ||
      loadPersistentStatus(jobId);

    if (!status) {
      return res.status(404).json({
        error: "Job status not found",
      });
    }

    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    return res.json(status);
  }
);

// ------------------------------------------------------------
// WORD-SAFE SEGMENT SNAP
// ------------------------------------------------------------

function snapSegmentToWords(
  seg,
  words,
  videoDuration
) {
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
  const MIN_LENGTH = 10;
  const MAX_LENGTH = 90;

  const safeDuration =
    Number.isFinite(videoDuration) &&
    videoDuration > 0
      ? videoDuration
      : Infinity;

  start = Math.max(0, start);
  end = Math.min(
    safeDuration,
    end
  );

  // ----------------------------------------------------------
  // Snap start to the first overlapping word
  // ----------------------------------------------------------

  if (Array.isArray(words) && words.length) {
    const firstWord = words.find(
      (w) =>
        Number(w.end) > start &&
        Number.isFinite(Number(w.start))
    );

    if (firstWord) {
      start = Math.max(
        0,
        Number(firstWord.start) - PRE_ROLL
      );
    }

    // --------------------------------------------------------
    // Snap end to the final overlapping word
    // --------------------------------------------------------

    let lastWord = null;

    for (
      let i = words.length - 1;
      i >= 0;
      i--
    ) {
      const word = words[i];

      if (
        Number.isFinite(Number(word.start)) &&
        Number(word.start) < end
      ) {
        lastWord = word;
        break;
      }
    }

    if (lastWord) {
      end =
        Number(lastWord.end) +
        TAIL;
    }
  }

  end = Math.min(
    safeDuration,
    end
  );

  // ----------------------------------------------------------
  // Guarantee minimum 10 seconds
  // ----------------------------------------------------------

  if (end - start < MIN_LENGTH) {
    const needed =
      MIN_LENGTH - (end - start);

    const roomAfter =
      safeDuration - end;

    const extendAfter =
      Math.min(
        needed,
        Math.max(0, roomAfter)
      );

    end += extendAfter;

    const remaining =
      MIN_LENGTH - (end - start);

    if (remaining > 0) {
      const extendBefore =
        Math.min(
          remaining,
          start
        );

      start -= extendBefore;
    }
  }

  // ----------------------------------------------------------
  // Guarantee maximum 90 seconds
  // ----------------------------------------------------------

  if (end - start > MAX_LENGTH) {
    end =
      start + MAX_LENGTH;

    if (end > safeDuration) {
      end = safeDuration;
      start =
        Math.max(
          0,
          end - MAX_LENGTH
        );
    }
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return seg;
  }

  return {
    ...seg,
    startTime: start,
    endTime: end,
  };
}

// ------------------------------------------------------------
// UPLOAD CORS
// ------------------------------------------------------------

function uploadCors(req, res, next) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Vary",
    "Origin"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "PUT, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Content-Range, X-Upload-Total, X-Upload-Offset, X-Chunk-Index, X-Total-Chunks"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
}

function parseContentRange(req) {
  const value = String(req.headers["content-range"] || "").trim();
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value);

  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= 0
  ) {
    return null;
  }

  return {
    offset: start,
    contentLength: end - start + 1,
    total,
  };
}

// ------------------------------------------------------------
// GENERIC CHUNK UPLOAD
// ------------------------------------------------------------

function pipelineRequest(
  req,
  destination
) {
  return new Promise(
    (resolve, reject) => {
      req.on("error", reject);
      destination.on("error", reject);

      destination.on(
        "finish",
        resolve
      );

      req.pipe(destination);
    }
  );
}

async function handleChunkUpload({
  req,
  res,
  filePath,
  total,
  offset,
  contentLength,
  maxTotalSize,
}) {
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    total > maxTotalSize
  ) {
    return res.status(400).json({
      error: "Invalid upload total size.",
    });
  }

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return res.status(400).json({
      error: "Invalid upload offset.",
    });
  }

  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_CHUNK_SIZE
  ) {
    return res.status(400).json({
      error: "Invalid upload chunk.",
    });
  }

  if (
    offset + contentLength > total
  ) {
    return res.status(400).json({
      error: "Upload chunk exceeds total size.",
    });
  }

  const range =
    String(
      req.headers["content-range"] || ""
    );

  const expectedRange =
    `bytes ${offset}-${offset + contentLength - 1}/${total}`;

  if (range !== expectedRange) {
    return res.status(400).json({
      error: "Invalid Content-Range.",
      expected: expectedRange,
    });
  }

  fs.mkdirSync(
    path.dirname(filePath),
    { recursive: true }
  );

  try {
    // A new upload/restart always begins at byte 0.
    // Recreate the preallocated file even if a partial/stale file
    // from an interrupted attempt is still present.
    if (offset === 0) {
      const fd =
        fs.openSync(
          filePath,
          "w"
        );

      try {
        fs.ftruncateSync(
          fd,
          total
        );
      } finally {
        fs.closeSync(fd);
      }
    } else if (
      !fs.existsSync(filePath)
    ) {
      // The worker may have restarted between chunks because Render's
      // free instance uses ephemeral /tmp storage. Tell the browser to
      // restart this upload from chunk 0 instead of failing the whole job.
      return res.status(409).json({
        error:
          "Upload state was lost. Restarting from the first chunk is required.",
        code: "UPLOAD_RESTART_REQUIRED",
        restartFrom: 0,
      });
    }

    const writeStream =
      fs.createWriteStream(
        filePath,
        {
          flags: "r+",
          start: offset,
        }
      );

    await pipelineRequest(
      req,
      writeStream
    );

    const complete =
      offset + contentLength === total;

    if (complete) {
      return res.status(201).json({
        ok: true,
        complete: true,
        bytes: total,
      });
    }

    return res.sendStatus(204);
  } catch (error) {
    console.error(
      "Chunk upload failed:",
      error?.message || error
    );

    return res.status(500).json({
      error: "Upload chunk failed.",
    });
  }
}

// ------------------------------------------------------------
// SMART AUDIO UPLOAD
// ------------------------------------------------------------

app.options(
  "/upload-analysis/:jobId",
  uploadCors
);

app.put(
  "/upload-analysis/:jobId",
  uploadCors,
  async (req, res) => {
    const jobId =
      String(
        req.params.jobId || ""
      ).trim();

    if (
      !/^[a-zA-Z0-9_-]+$/.test(jobId)
    ) {
      return res.status(400).json({
        error: "Invalid jobId.",
      });
    }

    const range = parseContentRange(req);

    const headerTotal =
      Number(req.headers["x-upload-total"]);

    const headerOffset =
      Number(req.headers["x-upload-offset"]);

    const total =
      range?.total ??
      (Number.isSafeInteger(headerTotal)
        ? headerTotal
        : NaN);

    const offset =
      range?.offset ??
      (Number.isSafeInteger(headerOffset)
        ? headerOffset
        : NaN);

    const contentLength =
      range?.contentLength ??
      Number(req.headers["content-length"]);

    if (!STORAGE_DIR) {
      return res.status(500).json({
        error:
          "STORAGE_DIR is not configured.",
      });
    }

    return handleChunkUpload({
      req,
      res,
      filePath:
        getAnalysisPath(jobId),
      total,
      offset,
      contentLength,
      maxTotalSize:
        MAX_ANALYSIS_AUDIO_SIZE,
    });
  }
);

// ------------------------------------------------------------
// SMART SELECTED CLIP UPLOAD
// ------------------------------------------------------------

app.options(
  "/upload-clip/:jobId/:clipNumber",
  uploadCors
);

app.put(
  "/upload-clip/:jobId/:clipNumber",
  uploadCors,
  async (req, res) => {
    const jobId =
      String(
        req.params.jobId || ""
      ).trim();

    const clipNumber =
      Number(
        req.params.clipNumber
      );

    if (
      !/^[a-zA-Z0-9_-]+$/.test(jobId)
    ) {
      return res.status(400).json({
        error: "Invalid jobId.",
      });
    }

    if (
      !Number.isInteger(clipNumber) ||
      clipNumber < 1 ||
      clipNumber > 7
    ) {
      return res.status(400).json({
        error:
          "clipNumber must be between 1 and 7.",
      });
    }

    const range = parseContentRange(req);

    const headerTotal =
      Number(req.headers["x-upload-total"]);

    const headerOffset =
      Number(req.headers["x-upload-offset"]);

    const total =
      range?.total ??
      (Number.isSafeInteger(headerTotal)
        ? headerTotal
        : NaN);

    const offset =
      range?.offset ??
      (Number.isSafeInteger(headerOffset)
        ? headerOffset
        : NaN);

    const contentLength =
      range?.contentLength ??
      Number(req.headers["content-length"]);

    if (!STORAGE_DIR) {
      return res.status(500).json({
        error:
          "STORAGE_DIR is not configured.",
      });
    }

    return handleChunkUpload({
      req,
      res,
      filePath:
        getHookUploadPath(
          jobId,
          clipNumber
        ),
      total,
      offset,
      contentLength,
      maxTotalSize:
        MAX_HOOK_CLIP_SIZE,
    });
  }
);

// ------------------------------------------------------------
// SMART ANALYSIS
//
// Browser sends ONLY the small extracted MP3.
// Original video never reaches this endpoint.
// ------------------------------------------------------------

app.post(
  "/analyze",
  checkSecret,
  (req, res) => {
    const {
      jobId,
      options,
      statusUrl,
      videoDuration,
    } = req.body || {};

    const cleanJobId =
      String(jobId || "").trim();

    if (
      !/^[a-zA-Z0-9_-]+$/.test(
        cleanJobId
      )
    ) {
      return res.status(400).json({
        error: "Invalid jobId.",
      });
    }

    const duration =
      Number(videoDuration);

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return res.status(400).json({
        error:
          "videoDuration is required.",
      });
    }

    const analysisPath =
      getAnalysisPath(cleanJobId);

    if (
      !fs.existsSync(analysisPath)
    ) {
      return res.status(404).json({
        error:
          "Analysis audio has not been uploaded yet.",
      });
    }

    const stats =
      fs.statSync(analysisPath);

    if (
      !stats.isFile() ||
      stats.size <= 0
    ) {
      return res.status(400).json({
        error:
          "Analysis audio is invalid.",
      });
    }

    res.status(202).json({
      received: true,
      jobId: cleanJobId,
      status: "queued",
    });

    const callbackStatusUrl =
      typeof statusUrl === "string" &&
      /^https?:\/\//i.test(statusUrl)
        ? statusUrl.replace(
            /\/+$/,
            ""
          )
        : NEXT_APP_URL.replace(
            /\/+$/,
            ""
          );

    runSmartAnalysis(
      cleanJobId,
      analysisPath,
      options || {},
      duration,
      callbackStatusUrl
    ).catch(
      async (err) => {
        console.error(
          `[${cleanJobId}] Smart analysis crashed:`,
          err
        );

        activeSmartRenders.delete(cleanJobId);

        await pushStatus(
          cleanJobId,
          {
            status: "error",
            progress: 0,
            message:
              "Analysis failed",
            error:
              err?.message ||
              "Unknown analysis error",
          },
          callbackStatusUrl
        );
      }
    );
  }
);

// ------------------------------------------------------------
// SMART ANALYSIS PIPELINE
// ------------------------------------------------------------

async function runSmartAnalysis(
  jobId,
  analysisPath,
  options,
  videoDuration,
  statusBaseUrl
) {
  const reportStatus =
    (update) =>
      pushStatus(
        jobId,
        update,
        statusBaseUrl
      );

  try {
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

    const audioLanguage =
      options.audioLanguage ||
      "auto";

    const captionLanguage =
      options.captionLanguage ||
      "same";

    // --------------------------------------------------------
    // 1. Transcription
    // --------------------------------------------------------

    await reportStatus({
      status: "transcribing",
      progress: 10,
      message:
        "Transcribing extracted audio",
    });

    const transcription =
      await transcribeWithTimestamps(
        analysisPath,
        audioLanguage
      );

    const text =
      transcription?.text;

    const words =
      transcription?.words;

    if (
      typeof text !== "string" ||
      !text.trim()
    ) {
      throw new Error(
        "Transcription returned no transcript text."
      );
    }

    if (
      !Array.isArray(words) ||
      words.length === 0
    ) {
      throw new Error(
        "Transcription returned no words. Check the audio and GROQ_API_KEY."
      );
    }

    console.log(
      `[${jobId}] Transcript received: ` +
      `${text.length} characters, ` +
      `${words.length} words`
    );

    // --------------------------------------------------------
    // 2. Caption language conversion
    // --------------------------------------------------------

    let captionWords = words;

    if (
      captionLanguage !== "same"
    ) {
      await reportStatus({
        status: "transcribing",
        progress: 25,
        message:
          "Preparing caption language",
      });

      captionWords =
        await convertWords(
          words,
          captionLanguage,
          audioLanguage
        );

      if (
        !Array.isArray(
          captionWords
        ) ||
        captionWords.length === 0
      ) {
        throw new Error(
          "Caption conversion returned no words."
        );
      }
    }

    // --------------------------------------------------------
    // 3. Hook detection
    // --------------------------------------------------------

    await reportStatus({
      status: "detecting_hooks",
      progress: 40,
      message:
        "Finding complete hooks",
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
        "No hook segments were detected."
      );
    }

    // --------------------------------------------------------
    // 4. Snap + enforce 10–90 seconds
    // --------------------------------------------------------

    const normalizedSegments =
      segments
        .map((segment) =>
          snapSegmentToWords(
            segment,
            words,
            videoDuration
          )
        )
        .filter((segment) => {
          const start =
            Number(
              segment.startTime
            );

          const end =
            Number(
              segment.endTime
            );

          const duration =
            end - start;

          return (
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            duration >= 10 &&
            duration <= 90 &&
            start >= 0 &&
            end <= videoDuration
          );
        })
        .slice(
          0,
          clipCount
        );

    if (
      normalizedSegments.length === 0
    ) {
      throw new Error(
        "No valid hooks between 10 and 90 seconds were found."
      );
    }

    console.log(
      `[${jobId}] Smart hooks detected:`,
      normalizedSegments.map(
        (segment, index) => ({
          index: index + 1,
          title: segment.title,
          start:
            Number(
              segment.startTime
            ).toFixed(2),
          end:
            Number(
              segment.endTime
            ).toFixed(2),
        })
      )
    );

    // --------------------------------------------------------
    // 5. Persist small analysis metadata
    // --------------------------------------------------------

    saveSmartMetadata(
      jobId,
      {
        jobId,
        videoDuration,
        clipCount,
        options,
        transcript: text,
        words,
        captionWords,
        segments:
          normalizedSegments,
        createdAt:
          new Date().toISOString(),
      }
    );

    await reportStatus({
      status: "detecting_hooks",
      progress: 50,
      message:
        `${normalizedSegments.length} complete hooks found`,
      clips:
        normalizedSegments.map(
          (segment, index) => ({
            index,
            title:
              segment.title ||
              `Clip ${index + 1}`,
            hookReason:
              segment.hookReason ||
              "",
            startTime:
              Number(
                segment.startTime
              ),
            endTime:
              Number(
                segment.endTime
              ),
            rawUrl: "",
            editedUrl: "",
          })
        ),
    });

    console.log(
      `[${jobId}] Smart analysis completed`
    );
  } catch (err) {
    throw err;
  }
}

// ------------------------------------------------------------
// SMART RENDER SELECTED CLIPS
//
// Browser sends ONLY the selected hook MP4 files.
// Original 3 GB source is never needed here.
// ------------------------------------------------------------

app.post(
  "/render-selected",
  checkSecret,
  (req, res) => {
    const {
      jobId,
      selectedSegments,
      options,
      statusUrl,
    } = req.body || {};

    const cleanJobId =
      String(jobId || "").trim();

    if (
      !/^[a-zA-Z0-9_-]+$/.test(
        cleanJobId
      )
    ) {
      return res.status(400).json({
        error: "Invalid jobId.",
      });
    }

    const metadata =
      loadSmartMetadata(
        cleanJobId
      );

    if (activeSmartRenders.has(cleanJobId)) {
      return res.status(409).json({
        error:
          "This job is already rendering. Please wait for the current render to finish.",
      });
    }

    if (!metadata) {
      return res.status(404).json({
        error:
          "Smart analysis data not found. Analyze the audio first.",
      });
    }

    if (
      !Array.isArray(
        selectedSegments
      ) ||
      selectedSegments.length === 0
    ) {
      return res.status(400).json({
        error:
          "selectedSegments are required.",
      });
    }

    const segments =
      selectedSegments
        .slice(0, 7)
        .map((segment, index) => ({
          index,
          title:
            String(
              segment?.title ||
              metadata.segments?.[index]
                ?.title ||
              `Clip ${index + 1}`
            ),
          hookReason:
            String(
              segment?.hookReason ||
              metadata.segments?.[index]
                ?.hookReason ||
              ""
            ),
          startTime:
            Number(
              segment?.startTime ??
              metadata.segments?.[index]
                ?.startTime
            ),
          endTime:
            Number(
              segment?.endTime ??
              metadata.segments?.[index]
                ?.endTime
            ),
        }));

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const clipPath =
        getHookUploadPath(
          cleanJobId,
          i + 1
        );

      if (
        !fs.existsSync(clipPath)
      ) {
        return res.status(400).json({
          error:
            `Selected clip ${i + 1} has not been uploaded.`,
        });
      }

      const stats =
        fs.statSync(clipPath);

      if (
        !stats.isFile() ||
        stats.size <= 0
      ) {
        return res.status(400).json({
          error:
            `Selected clip ${i + 1} is invalid.`,
        });
      }
    }

    res.status(202).json({
      received: true,
      jobId: cleanJobId,
      status: "queued",
    });

    const callbackStatusUrl =
      typeof statusUrl === "string" &&
      /^https?:\/\//i.test(statusUrl)
        ? statusUrl.replace(
            /\/+$/,
            ""
          )
        : NEXT_APP_URL.replace(
            /\/+$/,
            ""
          );

    activeSmartRenders.add(cleanJobId);

    smartRenderQueue.push({
      jobId: cleanJobId,
      segments,
      metadata,
      options: options || metadata.options || {},
      callbackStatusUrl,
    });

    console.log(
      `[${cleanJobId}] Render queued; waiting jobs=${smartRenderQueue.length - (smartRenderRunning ? 0 : 1)}`
    );

    void pushStatus(
      cleanJobId,
      {
        status: "queued",
        progress: 0,
        message: smartRenderRunning
          ? "Waiting for another render to finish"
          : "Starting render",
      },
      callbackStatusUrl
    );

    drainSmartRenderQueue();
  }
);

// ------------------------------------------------------------
// SMART RENDER PIPELINE
// ------------------------------------------------------------

async function runSmartRender(
  jobId,
  selectedSegments,
  metadata,
  options,
  statusBaseUrl
) {
  const resultsDir =
    getResultsDir(jobId);

  const tmpDir =
    getTmpDir(jobId);

  fs.mkdirSync(
    resultsDir,
    { recursive: true }
  );

  fs.mkdirSync(
    tmpDir,
    { recursive: true }
  );

  const captionColor =
    typeof options.captionColor === "string" &&
    options.captionColor.trim()
      ? options.captionColor.trim()
      : "#FFD700";

  const framing =
    options.framing === "fit" || options.framing === "fit-black"
      ? options.framing
      : "fill";

  const useBgm =
    Boolean(
      options.useBgm ||
      options.bgm
    );

  const captionWords =
    Array.isArray(
      metadata.captionWords
    )
      ? metadata.captionWords
      : metadata.words;

  console.log(
    "[worker] build",
    BUILD_COMMIT,
    "pipeline",
    PIPELINE_VERSION
  );

  console.log(
    "[" +
      jobId +
      "] render start target=" +
      VIDEO_WIDTH +
      "x" +
      VIDEO_HEIGHT +
      " framing=" +
      framing
  );

  const usedBgmFiles =
    new Set();

  const reportStatus =
    (update) =>
      pushStatus(
        jobId,
        update,
        statusBaseUrl
      );

  try {
    const total =
      selectedSegments.length;

    const clips = [];

    for (
      let i = 0;
      i < total;
      i++
    ) {
      const segment =
        selectedSegments[i];

      const clipNum =
        i + 1;

      const uploadedClipPath =
        getHookUploadPath(
          jobId,
          clipNum
        );

      if (
        !fs.existsSync(
          uploadedClipPath
        )
      ) {
        throw new Error(
          `Selected hook clip ${clipNum} is missing.`
        );
      }

      const startTime =
        Number(
          segment.startTime
        );

      const endTime =
        Number(
          segment.endTime
        );

      const clipDuration =
        endTime - startTime;

      if (
        !Number.isFinite(
          startTime
        ) ||
        !Number.isFinite(
          endTime
        ) ||
        clipDuration < 10 ||
        clipDuration > 90
      ) {
        throw new Error(
          `Clip ${clipNum} has an invalid duration. Hooks must be 10–90 seconds.`
        );
      }

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

      await reportStatus({
        status: "rendering",
        progress:
          75 +
          Math.round(
            (i / total) * 25
          ),
        message:
          `Rendering clip ${clipNum} of ${total}`,
      });

      console.log(
        `[${jobId}] smart clip ${clipNum}: ` +
        `${startTime.toFixed(2)}s - ` +
        `${endTime.toFixed(2)}s ` +
        `(${clipDuration.toFixed(2)}s) ` +
        `"${segment.title || ""}"`
      );

      // ------------------------------------------------------
      // Single-pass rendering.
      //
      // Keep the browser-trimmed input as the downloadable raw clip.
      // The final FFmpeg graph corrects SAR/rotation, caps frames at
      // 1280px before expensive filters, and encodes the 1080x1920 output
      // once. This avoids the previous extra decode/scale/H.264 encode.
      // ------------------------------------------------------

      const uploadedClipInfo =
        await getVideoInfo(
          uploadedClipPath
        );

      console.log(
        "[" +
          jobId +
          "] smart clip " +
          clipNum +
          ": source=" +
          uploadedClipInfo.width +
          "x" +
          uploadedClipInfo.height +
          " sar=" +
          uploadedClipInfo.sampleAspectRatio +
          " rotation=" +
          uploadedClipInfo.rotation
      );

      // Prefer a hard link so the raw download does not duplicate a large
      // upload on Render's small ephemeral disk. Fall back to copying when
      // hard links are unavailable.
      try {
        fs.linkSync(
          uploadedClipPath,
          rawOutPath
        );
      } catch {
        fs.copyFileSync(
          uploadedClipPath,
          rawOutPath
        );
      }

      const normalizedClipInfo =
        uploadedClipInfo;

      await reportStatus({
        status: "rendering",
        progress:
          75 +
          Math.round(
            (i / total) * 25
          ),
        message:
          `Rendering clip ${clipNum} of ${total}`,
        clips,
      });

      // ------------------------------------------------------
      // Captions
      //
      // buildAssCaptions uses the same OUT_W/OUT_H constants as FFmpeg,
      // so PlayResX/PlayResY, font size and margins scale together.
      // ------------------------------------------------------

      buildAssCaptions(
        captionWords,
        startTime,
        endTime,
        captionColor,
        assPath,
        VIDEO_WIDTH,
        VIDEO_HEIGHT
      );

      // ------------------------------------------------------
      // BGM
      // ------------------------------------------------------

      const bgmPath =
        useBgm
          ? chooseBgmForSegment(
              segment.title,
              segment.hookReason,
              usedBgmFiles,
              BGM_DIR
            )
          : null;

      // ------------------------------------------------------
      // Final edited clip
      // ------------------------------------------------------

      // PHASE 5: throttle progress callbacks sent back to Vercel.
      // FFmpeg can emit many progress events while the actual render work
      // is unchanged. Reporting every integer percentage adds network/fetch
      // overhead without improving the rendered video. Keep UI updates
      // responsive while reducing unnecessary status requests.
      let lastRenderProgress =
        75 +
        Math.round(
          (i / total) * 25
        );
      let lastReportedRenderProgress =
        lastRenderProgress;
      let lastRenderReportAt = 0;

      const logoOptions = resolveLogoOptions(options);

      await buildEditedClip(
        rawOutPath,
        assPath,
        clipDuration,
        bgmPath,
        editedOutPath,
        framing,
        (ffmpegProgress) => {
          const clipStartProgress =
            75 +
            (i / total) * 25;

          const clipEndProgress =
            75 +
            ((i + 1) / total) * 25;

          const renderProgress =
            Math.round(
              clipStartProgress +
              (Math.max(
                0,
                Math.min(100, Number(ffmpegProgress) || 0)
              ) /
                100) *
                (clipEndProgress - clipStartProgress)
            );

          if (
            renderProgress >
            lastRenderProgress
          ) {
            lastRenderProgress =
              renderProgress;

            const now = Date.now();
            const progressDelta =
              renderProgress -
              lastReportedRenderProgress;
            const enoughProgress =
              progressDelta >= 2;
            const enoughTime =
              now - lastRenderReportAt >= 800;
            const clipFinished =
              renderProgress >= Math.floor(clipEndProgress);

            if (
              enoughProgress ||
              enoughTime ||
              clipFinished
            ) {
              lastReportedRenderProgress =
                renderProgress;
              lastRenderReportAt =
                now;

              void reportStatus({
                status: "rendering",
                progress: renderProgress,
                message:
                  `Rendering clip ${clipNum} of ${total}`,
                clips,
              });
            }
          }
        },
        normalizedClipInfo,
        logoOptions
      );

      clips.push({
        index: i,
        title:
          segment.title ||
          `Clip ${clipNum}`,
        hookReason:
          segment.hookReason ||
          "",
        startTime,
        endTime,
        rawUrl:
          `/api/download/${jobId}/${rawFilename}`,
        editedUrl:
          `/api/download/${jobId}/${editedFilename}`,
      });

      await reportStatus({
        status: "rendering",
        progress:
          75 +
          Math.round(
            ((i + 1) / total) * 25
          ),
        message:
          `Clip ${clipNum} of ${total} completed`,
        clips,
      });
    }

    cleanupLogoUpload(options);

    // --------------------------------------------------------
    // Cleanup temporary files
    // --------------------------------------------------------

    try {
      fs.rmSync(
        tmpDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch (cleanupError) {
      console.warn(
        `[${jobId}] smart tmp cleanup failed:`,
        cleanupError?.message ||
          cleanupError
      );
    }

    // --------------------------------------------------------
    // Keep results, delete uploaded analysis + hook inputs
    // --------------------------------------------------------

    try {
      fs.rmSync(
        getJobRoot(jobId),
        {
          recursive: true,
          force: true,
        }
      );
    } catch (cleanupError) {
      console.warn(
        `[${jobId}] smart input cleanup failed:`,
        cleanupError?.message ||
          cleanupError
      );
    }

    // --------------------------------------------------------
    // DONE
    // --------------------------------------------------------

    await reportStatus({
      status: "done",
      progress: 100,
      message:
        `${clips.length} clip${clips.length === 1 ? "" : "s"} ready`,
      clips,
    });

    console.log(
      `[${jobId}] Smart pipeline completed successfully`
    );
  } catch (err) {
    cleanupLogoUpload(options);
    try {
      fs.rmSync(
        tmpDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch {}

    throw err;
  }
}

// ------------------------------------------------------------
// LEGACY PROCESS ENDPOINT
//
// Kept so the old flow does not instantly break while the new
// browser smart-flow is being wired into app/page.tsx.
// ------------------------------------------------------------

app.post(
  "/process",
  checkSecret,
  (req, res) => {
    return res.status(410).json({
      error:
        "Legacy full-source processing is disabled. Use the smart analysis and selected-clip rendering flow.",
    });
  }
);

// ------------------------------------------------------------
// DOWNLOAD ENDPOINT
// ------------------------------------------------------------

app.get(
  "/download/:jobId/:filename",
  checkSecret,
  (req, res) => {
    const jobId =
      String(
        req.params.jobId || ""
      ).trim();

    const filename =
      String(
        req.params.filename || ""
      ).trim();

    if (
      !/^[a-zA-Z0-9_-]+$/.test(
        jobId
      )
    ) {
      return res.status(400).json({
        error: "Invalid jobId",
      });
    }

    if (
      !/^clip-\d+-(raw|edited)\.mp4$/i.test(
        filename
      )
    ) {
      return res.status(400).json({
        error: "Invalid filename",
      });
    }

    if (!STORAGE_DIR) {
      return res.status(500).json({
        error:
          "STORAGE_DIR is not configured",
      });
    }

    const resultsRoot =
      path.resolve(
        STORAGE_DIR,
        "results",
        jobId
      );

    const filePath =
      path.resolve(
        resultsRoot,
        filename
      );

    if (
      !filePath.startsWith(
        resultsRoot + path.sep
      )
    ) {
      return res.status(400).json({
        error:
          "Invalid file path",
      });
    }

    if (
      !fs.existsSync(filePath)
    ) {
      return res.status(404).json({
        error: "File not found",
      });
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`
    );
    res.setHeader(
      "Cache-Control",
      "private, no-store, max-age=0"
    );
    res.setHeader(
      "Accept-Ranges",
      "bytes"
    );

    return res.sendFile(filePath);
  }
);

// ------------------------------------------------------------
// AI VIDEO DIRECTOR — short, structured editing instructions
// ------------------------------------------------------------

function cleanupLogoUpload(options) {
  const logoId = String(options?.logoId || "").trim();
  if (!/^[a-f0-9-]{16,80}$/i.test(logoId)) return;
  const logoDir = path.join(STORAGE_DIR || "", "tmp", "logos");
  for (const ext of [".png", ".jpg", ".webp"]) {
    try {
      fs.rmSync(path.join(logoDir, logoId + ext), { force: true });
    } catch (error) {
      console.warn("[logo-upload] cleanup failed:", error?.message || error);
    }
  }
}

function resolveLogoOptions(options) {
  const logoId = String(options?.logoId || "").trim();
  if (!logoId) return null;
  if (!/^[a-f0-9-]{16,80}$/i.test(logoId)) {
    throw new Error("Invalid logo upload reference.");
  }

  const logoDir = path.join(STORAGE_DIR || "", "tmp", "logos");
  const candidates = [".png", ".jpg", ".webp"];
  const logoPath = candidates
    .map((ext) => path.join(logoDir, logoId + ext))
    .find((candidate) => fs.existsSync(candidate));

  if (!logoPath) {
    throw new Error("Uploaded logo is missing or expired. Upload it again.");
  }

  const validPositions = new Set(["top-right", "top-left", "bottom-right", "bottom-left"]);
  const validSizes = new Set(["small", "medium", "large"]);

  return {
    path: logoPath,
    position: validPositions.has(options?.logoPosition) ? options.logoPosition : "top-right",
    size: validSizes.has(options?.logoSize) ? options.logoSize : "small",
  };
}

app.put(
  "/upload-logo/:logoId",
  checkSecret,
  async (req, res) => {
    const logoId = String(req.params.logoId || "").trim();
    if (!/^[a-f0-9-]{16,80}$/i.test(logoId)) {
      return res.status(400).json({ error: "Invalid logo upload reference." });
    }

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
      return res.status(415).json({ error: "Use a PNG, JPEG, or WebP image." });
    }

    const maxBytes = 100 * 1024 * 1024;
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (declaredLength > maxBytes) {
      return res.status(413).json({ error: "Logo images must be 100 MB or smaller." });
    }

    const logoDir = path.join(STORAGE_DIR || "", "tmp", "logos");
    const tempPath = path.join(logoDir, logoId + ".uploading-" + WORKER_INSTANCE_ID);
    let receivedBytes = 0;

    try {
      fs.mkdirSync(logoDir, { recursive: true });
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes) {
            callback(new Error("LOGO_TOO_LARGE"));
            return;
          }
          callback(null, chunk);
        },
      });
      const destination = fs.createWriteStream(tempPath, { flags: "wx" });

      await new Promise((resolve, reject) => {
        req.on("error", reject);
        limiter.on("error", (error) => {
          destination.destroy(error);
          reject(error);
        });
        destination.on("error", reject);
        destination.on("finish", resolve);
        req.pipe(limiter).pipe(destination);
      });

      if (receivedBytes === 0) {
        throw new Error("LOGO_EMPTY");
      }

      const signature = Buffer.alloc(12);
      const fd = fs.openSync(tempPath, "r");
      let bytesRead = 0;
      try {
        bytesRead = fs.readSync(fd, signature, 0, signature.length, 0);
      } finally {
        fs.closeSync(fd);
      }

      let extension = null;
      if (
        bytesRead >= 8 &&
        signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ) {
        extension = ".png";
      } else if (
        bytesRead >= 3 &&
        signature[0] === 0xff &&
        signature[1] === 0xd8 &&
        signature[2] === 0xff
      ) {
        extension = ".jpg";
      } else if (
        bytesRead >= 12 &&
        signature.toString("ascii", 0, 4) === "RIFF" &&
        signature.toString("ascii", 8, 12) === "WEBP"
      ) {
        extension = ".webp";
      }

      if (!extension) {
        throw new Error("LOGO_UNSUPPORTED");
      }

      for (const ext of [".png", ".jpg", ".webp"]) {
        fs.rmSync(path.join(logoDir, logoId + ext), { force: true });
      }
      const finalPath = path.join(logoDir, logoId + extension);
      fs.renameSync(tempPath, finalPath);

      let imageInfo;
      try {
        imageInfo = await getVideoInfo(finalPath);
      } catch {
        fs.rmSync(finalPath, { force: true });
        return res.status(415).json({ error: "The uploaded file is not a readable image." });
      }

      if (
        imageInfo.width > 8192 ||
        imageInfo.height > 8192 ||
        imageInfo.width * imageInfo.height > 40000000
      ) {
        fs.rmSync(finalPath, { force: true });
        return res.status(413).json({ error: "Logo dimensions are too large. Use an image no larger than 8192px per side or 40 megapixels." });
      }

      return res.status(201).json({
        ok: true,
        logoId,
        bytes: receivedBytes,
        width: imageInfo.width,
        height: imageInfo.height,
      });
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      const message = String(error?.message || "");
      if (message === "LOGO_TOO_LARGE") {
        return res.status(413).json({ error: "Logo images must be 100 MB or smaller." });
      }
      if (message === "LOGO_EMPTY") {
        return res.status(400).json({ error: "The image upload was empty." });
      }
      if (message === "LOGO_UNSUPPORTED") {
        return res.status(415).json({ error: "The file content is not a supported PNG, JPEG, or WebP image." });
      }
      console.error("[logo-upload] save failed:", message || "unknown error");
      return res.status(500).json({ error: "Could not save the logo image." });
    }
  }
);

const { interpretVideoEditRequest } = require("./lib/aiEdit");

app.post("/ai-edit", checkSecret, async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const result = await interpretVideoEditRequest(message);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = String(error?.message || "Could not interpret the edit request.");
    const status = /1–2000 characters/.test(message) ? 400 : 502;
    console.error("[ai-edit] request failed:", message);
    return res.status(status).json({ error: status === 400 ? message : "AI editing helper is temporarily unavailable." });
  }
});

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "captify-worker",
      instanceId:
        WORKER_INSTANCE_ID,
    });
  }
);

// ------------------------------------------------------------
// START WORKER
// ------------------------------------------------------------

app.listen(
  PORT,
  () => {
    console.log(
      `Captify worker listening on port ${PORT}`
    );

    console.log(
      `STORAGE_DIR = ${STORAGE_DIR}`
    );

    console.log(
      `NEXT_APP_URL = ${NEXT_APP_URL}`
    );

    console.log(
      "SMART FLOW = browser audio extraction + selected hook uploads"
    );

    console.log(
      "[worker] build",
      BUILD_COMMIT,
      "pipeline",
      PIPELINE_VERSION
    );

    console.log(
      "[worker] target",
      VIDEO_WIDTH + "x" + VIDEO_HEIGHT
    );
  }
);