// worker/lib/pipeline.js

const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const ffmpegPath = require("ffmpeg-static");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;

// ------------------------------------------------------------
// Background music settings
// ------------------------------------------------------------

const BGM_VOLUME = 0.1;
const DUCK_THRESHOLD = 0.03;
const DUCK_RATIO = 3;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function evenRound(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

function evenFloor(n) {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function getVideoDuration(sourcePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(sourcePath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(
            `Could not read video duration: ${err.message}`
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
// Video information
// ------------------------------------------------------------

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(
            `Could not read video information: ${err.message}`
          )
        );
      }

      const streams =
        (metadata && metadata.streams) || [];

      const stream = streams.find(
        (s) => s.codec_type === "video"
      );

      if (
        !stream ||
        !stream.width ||
        !stream.height
      ) {
        return reject(
          new Error("Could not read video size")
        );
      }

      const hasAudio = streams.some(
        (s) => s.codec_type === "audio"
      );

      let rotation = 0;

      if (
        stream.tags &&
        stream.tags.rotate
      ) {
        rotation =
          parseInt(stream.tags.rotate, 10) || 0;
      }

      if (
        Array.isArray(stream.side_data_list)
      ) {
        for (const sd of stream.side_data_list) {
          if (
            typeof sd.rotation === "number"
          ) {
            rotation = sd.rotation;
          }
        }
      }

      const rotated =
        Math.abs(rotation) % 180 === 90;

      resolve({
        width: rotated
          ? stream.height
          : stream.width,

        height: rotated
          ? stream.width
          : stream.height,

        hasAudio,
      });
    });
  });
}

// ------------------------------------------------------------
// Raw clip
// ------------------------------------------------------------

async function cutRawClip(
  sourcePath,
  startTime,
  endTime,
  outputPath
) {
  const duration = Math.max(
    0.1,
    Number(endTime) - Number(startTime)
  );

  console.log(`[cutRawClip] source=${sourcePath}`);
  console.log(
    `[cutRawClip] start=${Number(startTime).toFixed(3)} duration=${duration.toFixed(3)}`
  );

  const info = await getVideoInfo(sourcePath);
  const is4KOrLarger = Math.max(info.width, info.height) >= 2160;

  return new Promise((resolve, reject) => {
    const command = ffmpeg(sourcePath)
      .setStartTime(Number(startTime))
      .setDuration(duration)
      .outputOptions([
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        "-avoid_negative_ts", "make_zero",
      ]);

    if (is4KOrLarger) {
      console.log(
        `[cutRawClip] 4K source detected (${info.width}x${info.height}); creating 720x1280 low-memory intermediate`
      );

      command
        .videoFilters("scale=720:1280")
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions([
          "-threads", "1",
          "-filter_threads", "1",
          "-preset", "ultrafast",
          "-tune", "zerolatency",
          "-x264-params", "rc-lookahead=0:ref=1:bframes=0",
          "-crf", "26",
          "-pix_fmt", "yuv420p",
          "-b:a", "128k",
          "-movflags", "+faststart",
        ]);
    } else {
      command.outputOptions([
        "-c", "copy",
        "-movflags", "+faststart",
      ]);
    }

    command
      .on("start", (commandLine) => {
        console.log("[cutRawClip] FFmpeg command:");
        console.log(commandLine);
      })
      .on("stderr", (line) => {
        if (
          line.includes("Error") ||
          line.includes("error") ||
          line.includes("Invalid") ||
          line.includes("failed")
        ) {
          console.error(`[cutRawClip] ${line}`);
        }
      })
      .on("end", () => {
        if (!require("fs").existsSync(outputPath)) {
          return reject(
            new Error("FFmpeg finished but raw clip was not created")
          );
        }

        const size = require("fs").statSync(outputPath).size;

        if (!size) {
          return reject(new Error("FFmpeg created an empty raw clip"));
        }

        console.log(`[cutRawClip] Created: ${outputPath} (${size} bytes)`);
        resolve(outputPath);
      })
      .on("error", (err, stdout, stderr) => {
        console.error("[cutRawClip] FFmpeg ERROR:", err.message);
        if (stderr) {
          console.error("[cutRawClip] FFmpeg STDERR:", stderr);
        }
        reject(err);
      })
      .save(outputPath);
  });
}
// ------------------------------------------------------------
// ASS path escaping
// ------------------------------------------------------------

function escapePathForFilter(filePath) {
  if (!filePath) {
    throw new Error(
      "ASS subtitle path is required"
    );
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
  const srcW = Number(info.width);
  const srcH = Number(info.height);

  if (
    !Number.isFinite(srcW) ||
    !Number.isFinite(srcH) ||
    srcW <= 0 ||
    srcH <= 0
  ) {
    throw new Error("Invalid source video dimensions");
  }

  // Render targets:
  // 4K+ source -> 720x1280
  // everything else -> 1080x1920
  const is4KOrLarger =
    Math.max(srcW, srcH) >= 2160;

  const targetWidth =
    is4KOrLarger ? 720 : VIDEO_WIDTH;

  const targetHeight =
    is4KOrLarger ? 1280 : VIDEO_HEIGHT;

  let filters;

  if (framing === "fill") {
    // "Fill Blurred":
    // Keep the complete original video visible in the center.
    // Use a low-resolution blurred copy behind it so 16:9
    // footage becomes a clean 9:16 composition without cropping
    // faces, captions, or other important content.
    //
    // The background is intentionally processed at 1/4 size
    // before blur/upscale to keep Render memory usage low.
    const backgroundWidth =
      Math.max(180, Math.floor(targetWidth / 3 / 2) * 2);

    const backgroundHeight =
      Math.max(320, Math.floor(targetHeight / 3 / 2) * 2);

    const foreground =
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`;

    const background =
      `scale=${backgroundWidth}:${backgroundHeight}:force_original_aspect_ratio=increase,` +
      `crop=${backgroundWidth}:${backgroundHeight},` +
      `gblur=sigma=18:steps=1,` +
      `scale=${targetWidth}:${targetHeight}`;

    filters = [
      `[0:v]split=2[bgsrc][fgsrc]`,
      `[bgsrc]${background}[bg]`,
      `[fgsrc]${foreground},format=yuv420p[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,` +
        `fade=t=in:st=0:d=0.4,` +
        `ass='${escapedAss}':shaping=complex,` +
        `format=yuv420p[v]`,
    ];
  } else {
    // "Fit frame": complete video with black letterbox/pillarbox.
    const videoChain =
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
      `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;

    filters = [
      `[0:v]${videoChain},` +
        `fade=t=in:st=0:d=0.4,` +
        `ass='${escapedAss}':shaping=complex,` +
        `format=yuv420p[v]`,
    ];
  }

  // Audio
  if (hasBgm) {
    const fadeOutStart = Math.max(
      0,
      Number(clipDuration) - 1.5
    ).toFixed(2);

    const bgmBase =
      `[1:a]` +
      `volume=${BGM_VOLUME},` +
      `afade=t=in:st=0:d=1,` +
      `afade=t=out:st=${fadeOutStart}:d=1.5`;

    if (info.hasAudio) {
      filters.push(
        "[0:a]asplit=2[voice][sc]"
      );

      filters.push(
        `${bgmBase}[bgm0]`
      );

      filters.push(
        `[bgm0][sc]` +
          `sidechaincompress=` +
          `threshold=${DUCK_THRESHOLD}:` +
          `ratio=${DUCK_RATIO}:` +
          `attack=30:` +
          `release=500` +
          `[bgmd]`
      );

      filters.push(
        "[voice][bgmd]" +
          "amix=inputs=2:" +
          "duration=first:" +
          "dropout_transition=0:" +
          "normalize=0," +
          "alimiter=limit=0.9" +
          "[a]"
      );
    } else {
      filters.push(
        `${bgmBase},` +
          `atrim=duration=${Number(
            clipDuration
          ).toFixed(2)}` +
          `[a]`
      );
    }
  }

  return filters;
}

// ------------------------------------------------------------
// Edited clip
// ------------------------------------------------------------

// ------------------------------------------------------------

async function buildEditedClip(
  rawClipPath,
  assPath,
  clipDuration,
  bgmPath,
  outputPath,
  framing,
  onProgress
) {
  const mode =
    framing === "fill"
      ? "fill"
      : "fit";

  const info =
    await getVideoInfo(rawClipPath);

  const is4KOrLarger =
    Math.max(info.width, info.height) >= 2160;

  const targetLabel =
    is4KOrLarger
      ? "720x1280"
      : "1080x1920";

  console.log(
    `[buildEditedClip] source=${info.width}x${info.height} ` +
      `target=${targetLabel} ` +
      `framing=${mode} ` +
      `bgm=${bgmPath ? "yes" : "no"} ` +
      `duration=${Number(clipDuration).toFixed(1)}s`
  );

  console.log(
    "[buildEditedClip] ASS:",
    assPath
  );

  return new Promise((resolve, reject) => {
    let filters;

    try {
      filters = buildFilterGraph(
        info,
        mode,
        escapePathForFilter(assPath),
        !!bgmPath,
        clipDuration
      );
    } catch (error) {
      return reject(error);
    }

    const command =
      ffmpeg(rawClipPath);

    if (bgmPath) {
      command.input(bgmPath);
    }

    // Render free-tier safety:
    // one video chain, one x264 thread, no duplicated 4K frames.
    command.outputOptions([
      "-threads", "1",
      "-filter_threads", "1",
      "-filter_complex_threads", "1",
    ]);

    const maps = bgmPath
      ? [
          "-map",
          "[v]",
          "-map",
          "[a]",
        ]
      : [
          "-map",
          "[v]",
          "-map",
          "0:a?",
        ];

    command
      .complexFilter(filters)
      .outputOptions(maps)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-threads",
        "1",

        "-preset",
        "ultrafast",

        "-tune",
        "zerolatency",

        "-x264-params",
        "rc-lookahead=0:ref=1:bframes=0",

        "-crf",
        is4KOrLarger ? "26" : "23",

        "-pix_fmt",
        "yuv420p",

        "-b:a",
        "128k",

        "-shortest",

        "-movflags",
        "+faststart",

        "-avoid_negative_ts",
        "make_zero",
      ])

      .on("start", (commandLine) => {
        console.log(
          "[buildEditedClip] FFmpeg command:"
        );
        console.log(commandLine);
        onProgress?.(0);
      })

      .on("progress", (progress) => {
        const percent =
          Number(progress?.percent);

        if (Number.isFinite(percent)) {
          onProgress?.(
            Math.max(
              0,
              Math.min(100, percent)
            )
          );
        }
      })

      .on("stderr", (line) => {
        if (
          line.includes("Error") ||
          line.includes("error") ||
          line.includes("Invalid") ||
          line.includes("failed") ||
          line.includes("Killed")
        ) {
          console.error(
            `[buildEditedClip] ${line}`
          );
        }
      })

      .on("end", () => {
        if (!fs.existsSync(outputPath)) {
          return reject(
            new Error(
              "FFmpeg finished but edited clip was not created"
            )
          );
        }

        const size =
          fs.statSync(outputPath).size;

        if (!size) {
          return reject(
            new Error(
              "FFmpeg created an empty edited clip"
            )
          );
        }

        console.log(
          `[buildEditedClip] Created: ${outputPath} (${size} bytes)`
        );

        resolve(outputPath);
      })

      .on(
        "error",
        (err, stdout, stderr) => {
          console.error(
            "[buildEditedClip] FFmpeg ERROR:",
            err?.message || err
          );

          if (stderr) {
            console.error(
              "[buildEditedClip] FFmpeg STDERR:"
            );
            console.error(stderr);
          }

          reject(err);
        }
      )

      .save(outputPath);
  });
}

// ------------------------------------------------------------
// Exports
// ------------------------------------------------------------

module.exports = {
  getVideoDuration,
  cutRawClip,
  buildEditedClip,
  buildFilterGraph,
};