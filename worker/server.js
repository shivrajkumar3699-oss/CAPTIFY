// worker/server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

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
  try {
    if (!statusBaseUrl) {
      console.error(
        `[${jobId}] NEXT_APP_URL is not configured`
      );
      return;
    }

    await fetch(
      `${statusBaseUrl.replace(/\/+$/, "")}/api/internal/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": WORKER_SECRET || "",
        },
        body: JSON.stringify({
          jobId,
          ...statusUpdate,
        }),
      }
    );
  } catch (err) {
    console.error(
      `[${jobId}] Failed to push status update:`,
      err.message
    );
  }
}

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
// PROCESS ENDPOINT
// ------------------------------------------------------------

app.post("/process", checkSecret, (req, res) => {
  const {
    jobId,
    ext,
    sourceUrl,
    options,
    statusUrl,
  } = req.body || {};

  if (!jobId || !ext || !sourceUrl) {
    return res.status(400).json({
      error:
        "jobId, ext, and sourceUrl are required",
    });
  }

  if (
    typeof sourceUrl !== "string" ||
    !/^https?:\/\//i.test(sourceUrl)
  ) {
    return res.status(400).json({
      error: "Invalid sourceUrl",
    });
  }

  const cleanJobId = String(jobId).trim();
  const cleanExt = String(ext)
    .trim()
    .toLowerCase();

  if (
    !/^[a-zA-Z0-9_-]+$/.test(cleanJobId)
  ) {
    return res.status(400).json({
      error: "Invalid jobId",
    });
  }

  if (!ALLOWED_EXTENSIONS.has(cleanExt)) {
    return res.status(400).json({
      error:
        "Unsupported file type. Use MP3, WAV, MP4, or MKV.",
    });
  }

  // Respond immediately.
  res.status(202).json({
    received: true,
    jobId: cleanJobId,
    status: "queued",
  });

  // Process in background.
  const callbackStatusUrl =
    typeof statusUrl === "string" && /^https?:\/\//i.test(statusUrl)
      ? statusUrl
      : NEXT_APP_URL;

  runPipeline(
    cleanJobId,
    cleanExt,
    sourceUrl,
    options || {},
    callbackStatusUrl
  ).catch(async (err) => {
    console.error(
      `[${cleanJobId}] Pipeline crashed:`,
      err
    );

    const message =
      err?.message ||
      "Unknown processing error";

    await pushStatus(
      cleanJobId,
      {
        status: "error",
        progress: 0,
        message: "Processing failed",
        error: message,
      },
      callbackStatusUrl
    );
  });
});

// ------------------------------------------------------------
// MAIN PIPELINE
// ------------------------------------------------------------

async function runPipeline(
  jobId,
  ext,
  sourceUrl,
  options,
  statusBaseUrl = NEXT_APP_URL
) {
  if (!STORAGE_DIR) {
    throw new Error(
      "STORAGE_DIR is not configured"
    );
  }

  const sourcePath = path.join(
    STORAGE_DIR,
    "uploads",
    jobId,
    `source.${ext}`
  );

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
      20,
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
    // Download source from Vercel Blob
    // ----------------------------------------------------------

    if (!sourceUrl) {
      throw new Error("Source URL is required");
    }

    console.log(
      `[${jobId}] Downloading source from Blob`
    );

    fs.mkdirSync(
      path.dirname(sourcePath),
      { recursive: true }
    );

    const blobResponse = await fetch(sourceUrl);

    if (!blobResponse.ok || !blobResponse.body) {
      throw new Error(
        `Failed to download source from Blob (HTTP ${blobResponse.status})`
      );
    }

    await pipeline(
      Readable.fromWeb(blobResponse.body),
      fs.createWriteStream(sourcePath)
    );

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

  if (!/^clip-\\d+-(raw|edited)\\.mp4$/i.test(filename)) {
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