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
app.use(express.json());

const PORT = process.env.PORT || 8080;
const WORKER_SECRET = process.env.WORKER_SECRET;
const STORAGE_DIR = process.env.STORAGE_DIR;
const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://localhost:3000";
const BGM_DIR = path.join(__dirname, "assets", "bgm");

function checkSecret(req, res, next) {
  const secret = req.headers["x-worker-secret"];

  if (secret !== WORKER_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

async function pushStatus(jobId, statusUpdate) {
  try {
    await fetch(`${NEXT_APP_URL}/api/internal/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": WORKER_SECRET,
      },
      body: JSON.stringify({ jobId, ...statusUpdate }),
    });
  } catch (err) {
    console.error(
      `[${jobId}] Failed to push status update:`,
      err.message
    );
  }
}

// SNAP_START
// Moves a clip's start/end so it begins and ends cleanly on word boundaries:
// no half-cut words, and no dead air at the start or end of the clip.
function snapSegmentToWords(seg, words, videoDuration) {
  let start = Number(seg.startTime);
  let end = Number(seg.endTime);

  if (!isFinite(start) || !isFinite(end) || end <= start) {
    return seg;
  }

  const PRE_ROLL = 0.12;
  const TAIL = 0.35;
  const MIN_LENGTH = 5;

  // START: first word that has not already finished before the requested start
  const firstWord = words.find((w) => w.end > start);

  if (firstWord && firstWord.start < end - MIN_LENGTH) {
    start = Math.max(0, firstWord.start - PRE_ROLL);
  }

  // END: last word that begins before the requested end
  let lastWord = null;

  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].start < end) {
      lastWord = words[i];
      break;
    }
  }

  if (lastWord && lastWord.end + TAIL > start + MIN_LENGTH) {
    end = lastWord.end + TAIL;
  }

  end = Math.min(end, videoDuration);

  if (end - start < 1) {
    return seg;
  }

  return {
    ...seg,
    startTime: start,
    endTime: end,
  };
}
// SNAP_END

app.post("/process", checkSecret, (req, res) => {
  const { jobId, ext, options } = req.body || {};

  if (!jobId || !ext) {
    return res.status(400).json({
      error: "jobId and ext are required",
    });
  }

  // Respond immediately, do the real work in the background.
  res.json({ received: true });

  runPipeline(jobId, ext, options || {}).catch((err) => {
    console.error(`[${jobId}] Pipeline crashed:`, err);

    pushStatus(jobId, {
      status: "error",
      error: err.message || "Unknown error",
    });
  });
});

async function runPipeline(jobId, ext, options) {
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

  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const clipCount =
    options.clipCount ||
    options.numClips ||
    6;

  const useBgm = !!(
    options.useBgm ||
    options.bgm
  );

  const captionColor =
    options.captionColor ||
    "#FFD700";

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

  // Tracks which BGM files have already been used in THIS job,
  // so the same song doesn't repeat unnecessarily across clips.
  const usedBgmFiles = new Set();

  try {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Source file not found at ${sourcePath}`
      );
    }

    // ------------------------------------------------------------
    // Step 1: Extract audio
    // ------------------------------------------------------------

    await pushStatus(jobId, {
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

    // ------------------------------------------------------------
    // Step 2: Transcribe with word-level timestamps
    // ------------------------------------------------------------

    await pushStatus(jobId, {
      status: "transcribing",
      progress: 20,
      message: "Transcribing audio",
    });

    // IMPORTANT:
    // We need BOTH:
    //   text  -> Gemini hook detection
    //   words -> precise caption timing + clip snapping
    const transcription =
      await transcribeWithTimestamps(
        audioPath,
        audioLanguage
      );

    const text = transcription?.text;
    const words = transcription?.words;

    if (
      !words ||
      !Array.isArray(words) ||
      words.length === 0
    ) {
      throw new Error(
        "Transcription returned no words -- check the audio/GROQ_API_KEY"
      );
    }

    if (
      !text ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      throw new Error(
        "Transcription returned no transcript text -- check the transcription service response."
      );
    }

    console.log(
      `[${jobId}] Transcript received: ${text.length} characters, ${words.length} words`
    );

    // ------------------------------------------------------------
    // Step 2.5: Convert transcript words to chosen caption language
    // ------------------------------------------------------------

    // Hooks/snap still use ORIGINAL words so clip timing remains precise.
    // Only captions use converted words.
    let captionWords = words;

    if (captionLanguage !== "same") {
      await pushStatus(jobId, {
        status: "transcribing",
        progress: 30,
        message:
          "Caption language me convert kar rahe hain...",
      });

      captionWords = await convertWords(
        words,
        captionLanguage,
        audioLanguage
      );
    }

    // ------------------------------------------------------------
    // Step 3: Get video duration
    // ------------------------------------------------------------

    const videoDuration =
      await getVideoDuration(sourcePath);

    // ------------------------------------------------------------
    // Step 4: Detect hook segments via Gemini
    // ------------------------------------------------------------

    await pushStatus(jobId, {
      status: "detecting_hooks",
      progress: 40,
    });

    /*
     * IMPORTANT FIX:
     *
     * detectHooks.js now expects the actual transcript TEXT.
     *
     * OLD:
     * detectHookSegments(words, clipCount, videoDuration)
     *
     * NEW:
     * detectHookSegments(text)
     *
     * clipCount/videoDuration are no longer passed here because
     * the current detectHooks.js handles Gemini hook extraction
     * from the transcript itself.
     */
    const segments = await detectHookSegments(
  text,
  clipCount,
  videoDuration,
  words
);

    if (
      !segments ||
      segments.length === 0
    ) {
      throw new Error(
        "No hook segments were detected"
      );
    }

    // Respect requested clip count.
    const selectedSegments =
      segments.slice(0, clipCount);

    // ------------------------------------------------------------
    // Step 5: Process each segment
    // ------------------------------------------------------------

    const clips = [];
    const total = selectedSegments.length;

    for (let i = 0; i < total; i++) {
      // Snap AI's rough start/end to clean word boundaries.
      const seg = snapSegmentToWords(
        selectedSegments[i],
        words,
        videoDuration
      );

      const clipNum = i + 1;

      const baseProgress =
        45 +
        Math.round(
          (i / total) * 50
        );

      await pushStatus(jobId, {
        status: "rendering",
        progress: baseProgress,
        message:
          `Rendering clip ${clipNum} of ${total}`,
      });

      const rawFilename =
        `clip-${clipNum}-raw.mp4`;

      const editedFilename =
        `clip-${clipNum}-edited.mp4`;

      const rawOutPath = path.join(
        resultsDir,
        rawFilename
      );

      const editedOutPath = path.join(
        resultsDir,
        editedFilename
      );

      const assPath = path.join(
        tmpDir,
        `captions-${clipNum}.ass`
      );

      const clipDuration = Math.max(
        0.1,
        seg.endTime - seg.startTime
      );

      console.log(
        `[${jobId}] clip ${clipNum}: ` +
          `${seg.startTime.toFixed(1)}s - ` +
          `${seg.endTime.toFixed(1)}s ` +
          `(${clipDuration.toFixed(1)}s) ` +
          `"${seg.title || ""}"`
      );

      // ----------------------------------------------------------
      // Cut raw clip
      // ----------------------------------------------------------

      await cutRawClip(
        sourcePath,
        seg.startTime,
        seg.endTime,
        rawOutPath
      );

      // ----------------------------------------------------------
      // Build captions
      // ----------------------------------------------------------

      buildAssCaptions(
        captionWords,
        seg.startTime,
        seg.endTime,
        captionColor,
        assPath
      );

      // ----------------------------------------------------------
      // Pick BGM
      // ----------------------------------------------------------

      const bgmPath = useBgm
        ? chooseBgmForSegment(
            seg.title,
            seg.hookReason,
            usedBgmFiles,
            BGM_DIR
          )
        : null;

      // ----------------------------------------------------------
      // Build edited clip
      // ----------------------------------------------------------

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
          seg.hookReason || "",

        startTime: seg.startTime,
        endTime: seg.endTime,

        rawUrl:
          `/api/download/${jobId}/${rawFilename}`,

        editedUrl:
          `/api/download/${jobId}/${editedFilename}`,
      });
    }

    // ------------------------------------------------------------
    // Step 6: Cleanup tmp directory
    // ------------------------------------------------------------

    try {
      fs.rmSync(
        tmpDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch (e) {
      console.error(
        `[${jobId}] tmp cleanup failed (non-fatal):`,
        e.message
      );
    }

    // ------------------------------------------------------------
    // Step 7: Done
    // ------------------------------------------------------------

    await pushStatus(jobId, {
      status: "done",
      progress: 100,
      clips,
    });
  } catch (err) {
    try {
      fs.rmSync(
        tmpDir,
        {
          recursive: true,
          force: true,
        }
      );
    } catch (e) {}

    throw err;
  }
}

app.listen(PORT, () => {
  console.log(
    `Captify worker listening on port ${PORT}`
  );

  console.log(
    `STORAGE_DIR = ${STORAGE_DIR}`
  );
});