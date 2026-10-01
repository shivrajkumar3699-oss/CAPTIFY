// worker/lib/pipeline.js

const ffmpeg = require("fluent-ffmpeg");
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

function cutRawClip(
  sourcePath,
  startTime,
  endTime,
  outputPath
) {
  return new Promise((resolve, reject) => {
    const duration = Math.max(
      0.1,
      Number(endTime) - Number(startTime)
    );

    console.log(`[cutRawClip] source=${sourcePath}`);
    console.log(
      `[cutRawClip] start=${Number(startTime).toFixed(3)} duration=${duration.toFixed(3)}`
    );

    const command = ffmpeg(sourcePath)
      .setStartTime(Number(startTime))
      .setDuration(duration)
      .outputOptions([
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
      ])
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
          return reject(new Error("FFmpeg finished but raw clip was not created"));
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
        if (stderr) console.error("[cutRawClip] FFmpeg STDERR:", stderr);
        reject(err);
      })
      .save(outputPath);

    return command;
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
    throw new Error(
      "Invalid source video dimensions"
    );
  }

  let fgChain;

  if (framing === "fill") {
    const cropW = evenFloor(
      Math.min(
        srcW,
        (srcH * VIDEO_WIDTH) /
          VIDEO_HEIGHT
      )
    );

    const cropH = evenFloor(
      Math.min(
        srcH,
        (srcW * VIDEO_HEIGHT) /
          VIDEO_WIDTH
      )
    );

    fgChain =
      `crop=${cropW}:${cropH},` +
      `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}`;
  } else {
    const fit = Math.min(
      VIDEO_WIDTH / srcW,
      VIDEO_HEIGHT / srcH
    );

    const fitW = evenRound(srcW * fit);
    const fitH = evenRound(srcH * fit);

    fgChain =
      `scale=${fitW}:${fitH}`;
  }

  // Native 9:16 sources do not need a duplicated blurred background.
  // Avoiding split/overlay greatly reduces FFmpeg memory usage on Render.
  const sourceIsVertical =
    Math.abs(srcW / srcH - VIDEO_WIDTH / VIDEO_HEIGHT) < 0.01;

  const filters = [];

  if (sourceIsVertical) {
    filters.push(
      `[0:v]${fgChain},` +
        `fade=t=in:st=0:d=0.4,` +
        `ass='${escapedAss}':shaping=complex,` +
        `format=yuv420p[v]`
    );
  } else {
    filters.push(
      "[0:v]split=2[bgsrc][fgsrc]"
    );

    filters.push(
      `[bgsrc]` +
        `crop=trunc(iw*0.94/2)*2:` +
        `trunc(ih*0.94/2)*2,` +
        `scale=270:480:` +
        `force_original_aspect_ratio=increase,` +
        `crop=270:480,` +
        `gblur=sigma=8,` +
        `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},` +
        `eq=brightness=-0.1` +
        `[bg]`
    );

    filters.push(
      `[fgsrc]${fgChain}[fg]`
    );

    filters.push(
      "[bg][fg]" +
        `overlay=x=(W-w)/2:y=(H-h)/2,` +
        `fade=t=in:st=0:d=0.4,` +
        `ass='${escapedAss}':shaping=complex,` +
        `format=yuv420p[v]`
    );
  }

  // ----------------------------------------------------------
  // Audio
  // ----------------------------------------------------------

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

function buildEditedClip(
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

  return getVideoInfo(rawClipPath).then(
    (info) =>
      new Promise((resolve, reject) => {
        const escapedAss =
          escapePathForFilter(assPath);

        const filters =
          buildFilterGraph(
            info,
            mode,
            escapedAss,
            !!bgmPath,
            clipDuration
          );

        console.log(
          `[buildEditedClip] ` +
            `source=${info.width}x${info.height} ` +
            `framing=${mode} ` +
            `bgm=${bgmPath ? "yes" : "no"} ` +
            `duration=${Number(
              clipDuration
            ).toFixed(1)}s`
        );

        console.log(
          "[buildEditedClip] ASS:",
          assPath
        );

        const command = ffmpeg(rawClipPath);

        // The BGM filtergraph uses [1:a], so the music file must be
        // explicitly added as FFmpeg input #1.
        if (bgmPath) {
          command.input(bgmPath);
        }

        // Render with bounded CPU/thread usage on Render free instances.
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
            // Keep x264 memory usage bounded on Render.
            "-threads",
            "1",

            "-preset",
            "ultrafast",

            "-crf",
            "23",

            "-pix_fmt",
            "yuv420p",

            "-b:a",
            "160k",

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
            const percent = Number(progress?.percent);
            if (Number.isFinite(percent)) {
              onProgress?.(
                Math.max(0, Math.min(100, percent))
              );
            }
          })

          .on("stderr", (line) => {
            if (
              line.includes("Error") ||
              line.includes("error") ||
              line.includes("Invalid") ||
              line.includes("failed")
            ) {
              console.error(
                `[buildEditedClip] ${line}`
              );
            }
          })

          .on("end", () => {
            if (
              !require("fs").existsSync(
                outputPath
              )
            ) {
              return reject(
                new Error(
                  "FFmpeg finished but edited clip was not created"
                )
              );
            }

            console.log(
              `[buildEditedClip] Created: ${outputPath}`
            );

            resolve(outputPath);
          })

          .on(
            "error",
            (err, stdout, stderr) => {
              console.error(
                "[buildEditedClip] FFmpeg ERROR:",
                err.message
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
      })
  );
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