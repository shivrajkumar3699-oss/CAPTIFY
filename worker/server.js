// worker/server.js

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const {
  transcribeWithTimestamps,
} = require("./lib/transcribe");

const {
  detectHookSegments,
} = require("./lib/detectHooks");

const {
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
]);

const activeJobStatuses = new Map();
const activeSmartRenders = new Set();

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
    activeJobStatuses.get(jobId) || {};

  activeJobStatuses.set(jobId, {
    ...previous,
    jobId,
    ...statusUpdate,
  });

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
      activeJobStatuses.get(jobId);

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

    runSmartRender(
      cleanJobId,
      segments,
      metadata,
      options || metadata.options || {},
      callbackStatusUrl
    ).catch(
      async (err) => {
        console.error(
          `[${cleanJobId}] Smart render crashed:`,
          err
        );

        await pushStatus(
          cleanJobId,
          {
            status: "error",
            progress: 0,
            message:
              "Rendering failed",
            error:
              err?.message ||
              "Unknown rendering error",
          },
          callbackStatusUrl
        );
      }
    ).finally(() => {
      activeSmartRenders.delete(cleanJobId);
    });
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
    options.framing === "fill"
      ? "fill"
      : "fit";

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
          50 +
          Math.round(
            (i / total) * 45
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
      // The uploaded browser-trimmed hook becomes the raw clip.
      // NO original 3 GB video is used here.
      // ------------------------------------------------------

      const uploadedClipInfo =
        await getVideoInfo(uploadedClipPath);

      // FAST PATH:
      // A normal square-pixel 9:16 browser clip is already render-ready.
      // Do not encode it a second time just to normalize metadata.
      // This removes one full FFmpeg encode from the common path.
      const sarParts = String(
        uploadedClipInfo.sampleAspectRatio || "1:1"
      ).split(":");

      const sarNum =
        Number(sarParts[0]) || 1;

      const sarDen =
        Number(sarParts[1]) || 1;

      const displayWidth =
        uploadedClipInfo.codedWidth *
        (sarNum / sarDen);

      const displayHeight =
        uploadedClipInfo.codedHeight;

      const displayRatio =
        displayHeight > 0
          ? displayWidth / displayHeight
          : 0;

      const isNormalNineBySixteen =
        uploadedClipInfo.sampleAspectRatio === "1:1" &&
        !uploadedClipInfo.applyRotation &&
        Number.isFinite(displayRatio) &&
        displayRatio >= 0.555 &&
        displayRatio <= 0.57;

      // PHASE 7: do not encode a normalized intermediate.
      // The final FFmpeg render now fixes SAR/rotation/framing/captions in one pass.
      // Keep rawUrl behavior by linking the uploaded browser clip when possible.
      console.log(
        `[${jobId}] smart clip ${clipNum}: PHASE 7 — one-pass render (no normalization encode)`
      );

      try {
        fs.linkSync(uploadedClipPath, rawOutPath);
      } catch (linkError) {
        console.warn(
          `[${jobId}] smart clip ${clipNum}: hard link unavailable, falling back to copy:`,
          linkError?.message || linkError
        );
        fs.copyFileSync(uploadedClipPath, rawOutPath);
      }

      const normalizedClipInfo = uploadedClipInfo;

      // ------------------------------------------------------
      // Captions
      //
      // captionWords still contain ORIGINAL VIDEO timestamps.
      // buildAssCaptions shifts them relative to startTime.
      // Pass the uploaded clip dimensions so captions sit just
      // above the visible source video instead of below it.
      // ------------------------------------------------------

      buildAssCaptions(
        captionWords,
        startTime,
        endTime,
        captionColor,
        assPath,
        1080,
        1920
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
        normalizedClipInfo
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
          50 +
          Math.round(
            ((i + 1) / total) * 45
          ),
        message:
          `Clip ${clipNum} of ${total} completed`,
        clips,
      });
    }

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
  }
);