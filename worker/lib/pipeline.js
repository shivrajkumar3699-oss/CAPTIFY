// worker/lib/pipeline.js

const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const VIDEO_WIDTH = Number(process.env.OUT_W) || 1080;
const VIDEO_HEIGHT = Number(process.env.OUT_H) || 1920;
const CAPTION_FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

const BGM_VOLUME = 0.1;
const DUCK_THRESHOLD = 0.03;
const DUCK_RATIO = 3;

// Render Free has only 512 MB RAM; use one encoder thread by default.
const requestedFfmpegThreads = Number(process.env.FFMPEG_THREADS);
const FFMPEG_THREADS = Number.isInteger(requestedFfmpegThreads)
  ? Math.max(1, Math.min(2, requestedFfmpegThreads))
  : 1;

const COMMON_FFMPEG_OPTIONS = [
  "-threads", String(FFMPEG_THREADS),
  "-filter_threads", "1",
  "-filter_complex_threads", "1",
  "-preset", "ultrafast",
];

function parseSar(value) {
  const text = String(value || "1:1").trim();

  if (!/^\d+(?::\d+)?$/.test(text)) {
    return {
      text: "1:1",
      value: 1,
    };
  }

  const parts = text.split(":").map(Number);
  const numerator = parts[0];
  const denominator = parts.length === 2 ? parts[1] : 1;

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return {
      text: "1:1",
      value: 1,
    };
  }

  return {
    text: parts.length === 2 ? numerator + ":" + denominator : numerator + ":1",
    value: numerator / denominator,
  };
}

function normalizeRotation(value) {
  let rotation = Number(value);

  if (!Number.isFinite(rotation)) {
    return 0;
  }

  rotation %= 360;

  if (rotation < 0) {
    rotation += 360;
  }

  if (rotation > 180) {
    rotation -= 360;
  }

  if (Math.abs(rotation) < 0.5) {
    return 0;
  }

  if (Math.abs(Math.abs(rotation) - 90) < 0.5) {
    return rotation > 0 ? 90 : -90;
  }

  if (Math.abs(Math.abs(rotation) - 180) < 0.5) {
    return rotation > 0 ? 180 : -180;
  }

  return rotation;
}

function getDisplayDimensions(width, height, sarValue, rotation) {
  let displayWidth = Math.max(1, Math.round(width * sarValue));
  let displayHeight = Math.max(1, Math.round(height));

  if (Math.abs(rotation) % 180 === 90) {
    [displayWidth, displayHeight] = [
      displayHeight,
      displayWidth,
    ];
  }

  return {
    width: displayWidth,
    height: displayHeight,
  };
}

// ------------------------------------------------------------
// Duration
// ------------------------------------------------------------

function getVideoDuration(sourcePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(sourcePath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(
            "Could not read video duration: " + err.message
          )
        );
      }

      const duration =
        metadata &&
        metadata.format &&
        Number(metadata.format.duration);

      if (!Number.isFinite(duration) || duration <= 0) {
        return reject(
          new Error("Could not read a valid video duration")
        );
      }

      resolve(duration);
    });
  });
}

// ------------------------------------------------------------
// Video information / probe
// ------------------------------------------------------------

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(
            "Could not read video information: " + err.message
          )
        );
      }

      const streams = (metadata && metadata.streams) || [];

      const stream = streams.find(
        (item) => item.codec_type === "video"
      );

      if (!stream || !stream.width || !stream.height) {
        return reject(new Error("Could not read video size"));
      }

      const hasAudio = streams.some(
        (item) => item.codec_type === "audio"
      );

      let rotation = 0;

      if (stream.tags && stream.tags.rotate != null) {
        rotation = Number(stream.tags.rotate) || 0;
      }

      if (Array.isArray(stream.side_data_list)) {
        for (const sideData of stream.side_data_list) {
          if (sideData && sideData.rotation != null) {
            rotation = Number(sideData.rotation) || rotation;
          }
        }
      }

      rotation = normalizeRotation(rotation);

      const codedWidth = Number(stream.width);
      const codedHeight = Number(stream.height);

      const parsedSar = parseSar(
        stream.sample_aspect_ratio || "1:1"
      );

      const display = getDisplayDimensions(
        codedWidth,
        codedHeight,
        parsedSar.value,
        rotation
      );

      const displayAspectRatio =
        stream.display_aspect_ratio ||
        (
          display.height > 0
            ? (display.width / display.height).toFixed(6)
            : null
        );

      const info = {
        width: display.width,
        height: display.height,
        codedWidth,
        codedHeight,
        sampleAspectRatio: parsedSar.text,
        sampleAspectRatioValue: parsedSar.value,
        displayAspectRatio,
        rotation,
        applyRotation: Math.abs(rotation) % 180 === 90,
        hasAudio,
      };

      console.log(
        "[probe] " +
        videoPath +
        ": " +
        codedWidth +
        "x" +
        codedHeight +
        " sar=" +
        parsedSar.text +
        " dar=" +
        (displayAspectRatio || "unknown") +
        " rot=" +
        rotation
      );

      resolve(info);
    });
  });
}

// ------------------------------------------------------------
// Raw clip normalization
// ------------------------------------------------------------

async function cutRawClip(
  sourcePath,
  startTime,
  endTime,
  outputPath,
  onProgress
) {
  const start = Math.max(0, Number(startTime) || 0);

  const duration = Math.max(
    0.1,
    (Number(endTime) || 0) - start
  );

  console.log("[cutRawClip] source=" + sourcePath);
  console.log(
    "[cutRawClip] start=" +
    start.toFixed(3) +
    " duration=" +
    duration.toFixed(3)
  );

  return new Promise((resolve, reject) => {
    const command = ffmpeg(sourcePath)
      .inputOptions([
        "-threads", "1",
        "-ss", start.toFixed(3),
        "-t", duration.toFixed(3),
      ])
      .videoFilters(
        "scale=w='trunc(iw*sar/2)*2':h=ih,setsar=1," +
        "scale='min(1280,iw)':'min(1280,ih)':" +
        "force_original_aspect_ratio=decrease:force_divisible_by=2"
      )
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        ...COMMON_FFMPEG_OPTIONS,
        "-x264-params", "rc-lookahead=0:ref=1:bframes=0",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-metadata:s:v:0", "rotate=0",
        "-avoid_negative_ts", "make_zero",
      ]);

    command
      .on("start", (commandLine) => {
        console.log("[cutRawClip] FFmpeg command:");
        console.log(commandLine);
      })
      .on("progress", (progress) => {
        const percent = Number(progress && progress.percent);

        if (Number.isFinite(percent)) {
          onProgress?.(
            Math.max(0, Math.min(100, percent))
          );
        }
      })
      .on("stderr", (line) => {
        const text = String(line);

        if (
          /Error|Invalid|failed|Killed|Conversion failed/i.test(text)
        ) {
          console.error("[cutRawClip] " + text);
        }
      })
      .on("error", (err, stdout, stderr) => {
        console.error(
          "[cutRawClip] FFmpeg ERROR:",
          err && err.message ? err.message : err
        );

        if (stderr) {
          console.error("[cutRawClip] FFmpeg STDERR:");
          console.error(stderr);
        }

        reject(err);
      })
      .on("end", async () => {
        try {
          if (!fs.existsSync(outputPath)) {
            throw new Error(
              "FFmpeg finished but raw clip was not created"
            );
          }

          const size = fs.statSync(outputPath).size;

          if (!size) {
            throw new Error(
              "FFmpeg created an empty raw clip"
            );
          }

          const normalizedInfo = await getVideoInfo(outputPath);

          if (normalizedInfo.sampleAspectRatio !== "1:1") {
            throw new Error(
              "Normalized clip verification failed: expected SAR 1:1, got " +
              normalizedInfo.sampleAspectRatio
            );
          }

          console.log(
            "[probe] normalized: " +
            normalizedInfo.width +
            "x" +
            normalizedInfo.height +
            " sar=" +
            normalizedInfo.sampleAspectRatio +
            " dar=" +
            (normalizedInfo.displayAspectRatio || "unknown") +
            " rot=" +
            normalizedInfo.rotation
          );

          console.log(
            "[cutRawClip] NORMALIZED clip: " +
            normalizedInfo.width +
            "x" +
            normalizedInfo.height +
            " sar=" +
            normalizedInfo.sampleAspectRatio +
            " rotation=" +
            normalizedInfo.rotation
          );

          resolve(outputPath);
        } catch (error) {
          reject(error);
        }
      })
      .save(outputPath);
  });
}

async function normalizeClipForRender(
  sourcePath,
  outputPath,
  info
) {
  const duration = await getVideoDuration(sourcePath);

  return cutRawClip(
    sourcePath,
    0,
    duration,
    outputPath
  );
}

// ------------------------------------------------------------
// ASS path escaping
// ------------------------------------------------------------

function escapePathForFilter(filePath) {
  if (!filePath) {
    throw new Error("ASS subtitle path is required");
  }

  return String(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

// ------------------------------------------------------------
// Filter graph
// ------------------------------------------------------------

function buildFilterGraph(
  info,
  framing,
  escapedAss,
  hasBgm,
  clipDuration
) {
  const W = VIDEO_WIDTH;
  const H = VIDEO_HEIGHT;

  const videoBaseLabel = "v";

  const captionFilter =
    "ass='" +
    escapedAss +
    "':original_size=" +
    W +
    "x" +
    H +
    ":shaping=complex:fontsdir='" +
    escapePathForFilter(CAPTION_FONT_DIR) +
    "'";

  const filters = [];

  if (framing === "fill") {
    filters.push(
      "[0:v]" +
      "scale=w='trunc(iw*sar/2)*2':h=ih," +
      "setsar=1,scale='min(1280,iw)':'min(1280,ih)':" +
      "force_original_aspect_ratio=decrease:force_divisible_by=2," +
      // Crop to the target 9:16 aspect ratio before upscaling. This avoids
      // creating a ~3414x1920 intermediate frame from a 16:9 source.
      "crop=w='trunc(min(iw,ih*9/16)/2)*2':" +
      "h='trunc(min(ih,iw*16/9)/2)*2':" +
      "x='(iw-ow)/2':y='(ih-oh)/2'," +
      "scale=" + W + ":" + H + ",setsar=1[fg]"
    );

    filters.push(
      "[fg]" +
      "fade=t=in:st=0:d=0.4," +
      captionFilter +
      ",setsar=1,format=yuv420p[" + videoBaseLabel + "]"
    );
  } else if (framing === "fit-black") {
    // Preserve the source aspect ratio and center it on a solid black 9:16 canvas.
    // A 16:9 source becomes a full-width landscape frame with black above and below.
    filters.push(
      "[0:v]" +
      "scale=w='trunc(iw*sar/2)*2':h=ih," +
      "setsar=1," +
      "scale=" + W + ":" + H +
      ":force_original_aspect_ratio=decrease:force_divisible_by=2," +
      "pad=" + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2:color=black," +
      "setsar=1[fg]"
    );

    filters.push(
      "[fg]" +
      "fade=t=in:st=0:d=0.4," +
      captionFilter +
      ",setsar=1,format=yuv420p[" + videoBaseLabel + "]"
    );
  } else {
    // Fit frame means zoom and center-crop to fill the vertical canvas.
    // This fixed crop does not dynamically track faces.
    filters.push(
      "[0:v]" +
      "scale=w='trunc(iw*sar/2)*2':h=ih," +
      "setsar=1," +
      "scale='min(1280,iw)':'min(1280,ih)':" +
      "force_original_aspect_ratio=decrease:force_divisible_by=2," +
      // Crop to 9:16 before scaling to the final output size to reduce peak memory.
      "crop=w='trunc(min(iw,ih*9/16)/2)*2':" +
      "h='trunc(min(ih,iw*16/9)/2)*2':" +
      "x='(iw-ow)/2':y='(ih-oh)/2'," +
      "scale=" + W + ":" + H + ",setsar=1[fg]"
    );

    filters.push(
      "[fg]" +
      "fade=t=in:st=0:d=0.4," +
      captionFilter +
      ",setsar=1,format=yuv420p[" + videoBaseLabel + "]"
    );
  }

  if (hasBgm) {
    const fadeOutStart = Math.max(
      0,
      Number(clipDuration) - 1.5
    ).toFixed(2);

    const bgmBase =
      "[1:a]" +
      "volume=" +
      BGM_VOLUME +
      ",afade=t=in:st=0:d=1," +
      "afade=t=out:st=" +
      fadeOutStart +
      ":d=1.5";

    if (info && info.hasAudio) {
      filters.push("[0:a]asplit=2[voice][sc]");

      filters.push(
        bgmBase + "[bgm0]"
      );

      filters.push(
        "[bgm0][sc]" +
        "sidechaincompress=" +
        "threshold=" +
        DUCK_THRESHOLD +
        ":ratio=" +
        DUCK_RATIO +
        ":attack=30:release=500[bgmd]"
      );

      filters.push(
        "[voice][bgmd]" +
        "amix=inputs=2:" +
        "duration=first:" +
        "dropout_transition=0:" +
        "normalize=0," +
        "alimiter=limit=0.9[a]"
      );
    } else {
      filters.push(
        bgmBase +
        ",atrim=duration=" +
        Number(clipDuration).toFixed(2) +
        "[a]"
      );
    }
  }

  return filters;
}

// ------------------------------------------------------------
// Render verification
// ------------------------------------------------------------

async function detectActiveCrop(
  outputPath,
  middleTime
) {
  return new Promise((resolve) => {
    const stderrLines = [];

    const command = ffmpeg(outputPath)
      .inputOptions([
        "-threads", "1",
        "-ss",
        Math.max(
          0,
          Number(middleTime) || 0
        ).toFixed(3),
      ])
      .outputOptions([
        "-frames:v", "1",
        "-an",
        "-f", "null",
        "-filter_threads", "1",
      ])
      .videoFilters(
        "cropdetect=limit=24:round=2:reset=0"
      )
      .on("stderr", (line) => {
        stderrLines.push(String(line));
      })
      .on("end", () => {
        let latest = null;

        for (const line of stderrLines) {
          const match = line.match(
            /crop=(\d+):(\d+):(\d+):(\d+)/
          );

          if (match) {
            latest = {
              width: Number(match[1]),
              height: Number(match[2]),
              x: Number(match[3]),
              y: Number(match[4]),
            };
          }
        }

        resolve(latest);
      })
      .on("error", (error) => {
        console.warn(
          "[verify] cropdetect failed:",
          error && error.message
            ? error.message
            : error
        );

        resolve(null);
      });

    command.output(
      process.platform === "win32"
        ? "NUL"
        : "/dev/null"
    );

    command.run();
  });
}

async function verifyRenderedClip(
  outputPath,
  framing,
  clipDuration
) {
  const info = await getVideoInfo(outputPath);

  const dimensionsOk =
    info.width === VIDEO_WIDTH &&
    info.height === VIDEO_HEIGHT;

  const sarOk =
    info.sampleAspectRatio === "1:1";

  console.log(
    "[verify] output=" +
    info.width +
    "x" +
    info.height +
    " sar=" +
    info.sampleAspectRatio +
    " dar=" +
    (info.displayAspectRatio || "unknown") +
    " rotation=" +
    info.rotation
  );

  if (!dimensionsOk || !sarOk) {
    throw new Error(
      "Rendered output verification failed: expected " +
      VIDEO_WIDTH +
      "x" +
      VIDEO_HEIGHT +
      " SAR 1:1, got " +
      info.width +
      "x" +
      info.height +
      " SAR " +
      info.sampleAspectRatio
    );
  }

  if (framing === "fill") {
    const middleTime = Math.max(
      0,
      Math.min(
        Math.max(0, Number(clipDuration) / 2),
        Math.max(0, Number(clipDuration) - 0.1)
      )
    );

    const crop = await detectActiveCrop(
      outputPath,
      middleTime
    );

    if (crop) {
      const minimumActiveHeight =
        VIDEO_HEIGHT * 0.9;

      if (crop.height < minimumActiveHeight) {
        console.warn(
          "[verify] WARNING black bars: active " +
          crop.height +
          " of " +
          VIDEO_HEIGHT
        );
      } else {
        console.log(
          "[verify] active video area " +
          crop.height +
          " of " +
          VIDEO_HEIGHT +
          " OK"
        );
      }
    } else {
      console.warn(
        "[verify] WARNING black bars: cropdetect returned no active area"
      );
    }
  }

  console.log(
    "[verify] OK " +
    VIDEO_WIDTH +
    "x" +
    VIDEO_HEIGHT +
    " SAR 1:1"
  );

  return info;
}

// ------------------------------------------------------------
// Edited clip
// ------------------------------------------------------------

async function buildEditedClip(
  rawClipPath,
  assPath,
  clipDuration,
  bgmPath,
  outputPath,
  framing,
  onProgress,
  sourceInfo
) {
  const mode =
    framing === "fit"
      ? "fit"
      : "fill";

  const originalInfo =
    sourceInfo ||
    await getVideoInfo(rawClipPath);

  console.log(
    "[buildEditedClip] target=" +
    VIDEO_WIDTH +
    "x" +
    VIDEO_HEIGHT +
    " source=" +
    rawClipPath +
    " framing=" +
    mode +
    " bgm=" +
    (bgmPath ? "yes" : "no")
  );

  const escapedAss =
    escapePathForFilter(assPath);

  const filters =
    buildFilterGraph(
      {
        hasAudio: Boolean(
          originalInfo &&
          originalInfo.hasAudio
        ),
      },
      mode,
      escapedAss,
      Boolean(bgmPath),
      clipDuration
    );

  console.log(
    "[buildEditedClip] FINAL FILTER GRAPH:"
  );
  console.log(filters.join(";"));

  return new Promise((resolve, reject) => {
    const renderStartedAt = Date.now();
    const clipLabel = String(outputPath).split(/[\\/]/).pop() || "unknown-clip";
    let lastMetricsLogAt = renderStartedAt;
    let latestFfmpegTime = "unknown";
    let latestFfmpegSpeed = "unknown";
    let latestFfmpegFps = "unknown";
    let latestFfmpegFrame = "unknown";

    console.log(
      "[render-metrics] start clip=" + clipLabel +
      " target=" + VIDEO_WIDTH + "x" + VIDEO_HEIGHT +
      " duration=" + Number(clipDuration).toFixed(2) + "s"
    );

    const command = ffmpeg(rawClipPath);

    if (bgmPath) {
      command.input(bgmPath);
    }

    const maps = bgmPath
      ? [
          "-map", "[v]",
          "-map", "[a]",
        ]
      : [
          "-map", "[v]",
          "-map", "0:a?",
        ];

    command
      .complexFilter(filters)
      .outputOptions([
        ...maps,
        "-threads", String(FFMPEG_THREADS),
        "-filter_threads", "1",
        "-filter_complex_threads", "1",
        "-preset", "ultrafast",
        "-x264-params", "rc-lookahead=0:ref=1:bframes=0",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
      ])
      .videoCodec("libx264")
      .audioCodec("aac")
      .on("start", (commandLine) => {
        console.log("[buildEditedClip] FFmpeg command:");
        console.log(commandLine);
        onProgress?.(0);
      })
      .on("progress", (progress) => {
        const percent = Number(
          progress && progress.percent
        );

        if (Number.isFinite(percent)) {
          onProgress?.(
            Math.max(0, Math.min(100, percent))
          );
        }
      })
      .on("stderr", (line) => {
        const text = String(line);
        const now = Date.now();
        const elapsedSeconds = ((now - renderStartedAt) / 1000).toFixed(1);
        const timeMatch = text.match(/time=\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
        const speedMatch = text.match(/speed=\s*([0-9.]+)x/);
        const fpsMatch = text.match(/fps=\s*([0-9.]+)/);
        const frameMatch = text.match(/frame=\s*(\d+)/);

        if (timeMatch) latestFfmpegTime = timeMatch[1];
        if (speedMatch) latestFfmpegSpeed = speedMatch[1] + "x";
        if (fpsMatch) latestFfmpegFps = fpsMatch[1];
        if (frameMatch) latestFfmpegFrame = frameMatch[1];

        // FFmpeg progress lines are useful for diagnosis but can be very noisy.
        // Emit a compact snapshot at most once every 10 seconds.
        if (now - lastMetricsLogAt >= 10000 && /(?:time=|speed=|frame=)/.test(text)) {
          console.log(
            "[render-metrics] progress clip=" + clipLabel +
            " elapsed=" + elapsedSeconds + "s" +
            " outputTime=" + latestFfmpegTime +
            " speed=" + latestFfmpegSpeed +
            " fps=" + latestFfmpegFps +
            " frame=" + latestFfmpegFrame
          );
          lastMetricsLogAt = now;
        }

        if (
          /Error|Invalid|failed|Killed|Conversion failed/i.test(text)
        ) {
          console.error("[buildEditedClip] " + text);
        }
      })
      .on("end", async () => {
        const ffmpegElapsedSeconds = (Date.now() - renderStartedAt) / 1000;
        const clipSeconds = Math.max(0, Number(clipDuration) || 0);
        const effectiveSpeed = ffmpegElapsedSeconds > 0
          ? (clipSeconds / ffmpegElapsedSeconds).toFixed(3)
          : "unknown";

        console.log(
          "[render-metrics] ffmpeg-finished clip=" + clipLabel +
          " elapsed=" + ffmpegElapsedSeconds.toFixed(1) + "s" +
          " outputDuration=" + clipSeconds.toFixed(2) + "s" +
          " effectiveSpeed=" + effectiveSpeed + "x" +
          " lastFfmpegSpeed=" + latestFfmpegSpeed
        );

        try {
          if (!fs.existsSync(outputPath)) {
            throw new Error(
              "FFmpeg finished but edited clip was not created"
            );
          }

          const size = fs.statSync(outputPath).size;

          if (!size) {
            throw new Error(
              "FFmpeg created an empty edited clip"
            );
          }

          await verifyRenderedClip(
            outputPath,
            mode,
            clipDuration
          );

          console.log(
            "[buildEditedClip] Created: " +
            outputPath +
            " (" +
            size +
            " bytes)"
          );

          onProgress?.(100);
          resolve(outputPath);
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (err, stdout, stderr) => {
        console.error(
          "[render-metrics] ffmpeg-error clip=" + clipLabel +
          " elapsed=" + ((Date.now() - renderStartedAt) / 1000).toFixed(1) + "s"
        );
        console.error(
          "[buildEditedClip] FFmpeg ERROR:",
          err && err.message ? err.message : err
        );

        if (stderr) {
          console.error("[buildEditedClip] FFmpeg STDERR:");
          console.error(stderr);
        }

        reject(err);
      })
      .save(outputPath);
  });
}

// ------------------------------------------------------------
// Exports
// ------------------------------------------------------------

module.exports = {
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
  getVideoDuration,
  getVideoInfo,
  normalizeClipForRender,
  cutRawClip,
  buildEditedClip,
  buildFilterGraph,
  verifyRenderedClip,
};
