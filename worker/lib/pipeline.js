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

  const originalInfo =
    await getVideoInfo(rawClipPath);

  const is4KOrLarger =
    originalInfo.width >= 3840 ||
    originalInfo.height >= 3840;

  const targetWidth =
    is4KOrLarger ? 720 : VIDEO_WIDTH;

  const targetHeight =
    is4KOrLarger ? 1280 : VIDEO_HEIGHT;

  const targetLabel =
    is4KOrLarger
      ? "720x1280"
      : "1080x1920";

  console.log(
    `[buildEditedClip] source=${originalInfo.width}x${originalInfo.height} ` +
      `target=${targetLabel} ` +
      `framing=${mode} ` +
      `bgm=${bgmPath ? "yes" : "no"} ` +
      `duration=${Number(clipDuration).toFixed(1)}s`
  );

  console.log(
    "[buildEditedClip] ASS:",
    assPath
  );

  /*
   * Render free-tier protection:
   *
   * A 4K frame is very expensive in FFmpeg. The previous Fill Blurred
   * graph used split=2 on the 4K input, which meant FFmpeg could hold
   * multiple large frame buffers at once. Render's free instance has
   * a hard ~512 MB memory limit, so the process could be killed while
   * the UI was around 75%.
   *
   * For 4K-or-larger uploads we now do a separate LOW-MEMORY preparation
   * pass first. The final caption/BGM pass only works with the small
   * 720-wide source. This removes the 4K frame from the caption filter
   * graph entirely and avoids split=2 on a 4K stream.
   *
   * IMPORTANT:
   * - Aspect ratio is preserved.
   * - Fill Blurred still shows the complete video in the foreground.
   * - The blurred background is generated from the same prepared video.
   * - The 4K source is intentionally rendered to 720x1280 on the free
   *   worker because a true 4K final render cannot reliably fit in the
   *   worker's ~512 MB memory ceiling.
   */
  const preparedPath =
    is4KOrLarger
      ? `${outputPath}.prepared.mp4`
      : null;

  const backgroundPath =
    is4KOrLarger && mode === "fill"
      ? `${outputPath}.background.mp4`
      : null;

  const cleanupTemp = () => {
    for (const filePath of [
      preparedPath,
      backgroundPath,
    ]) {
      if (!filePath) continue;

      try {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, {
            force: true,
          });
        }
      } catch (error) {
        console.warn(
          "[buildEditedClip] temp cleanup failed:",
          error?.message || error
        );
      }
    }
  };

  try {
    if (preparedPath) {
      await new Promise((resolve, reject) => {
        const prepareCommand =
          ffmpeg(rawClipPath)
            .videoFilters(
              `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`
            )
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions([
              "-map", "0:v:0?",
              "-map", "0:a:0?",
              "-threads", "1",
              "-filter_threads", "1",
              "-filter_complex_threads", "1",
              "-preset", "ultrafast",
              "-tune", "zerolatency",
              "-x264-params", "rc-lookahead=0:ref=1:bframes=0",
              "-crf", "28",
              "-pix_fmt", "yuv420p",
              "-b:a", "128k",
              "-shortest",
              "-movflags", "+faststart",
              "-avoid_negative_ts", "make_zero",
            ]);

        prepareCommand
          .on("start", (commandLine) => {
            console.log(
              "[buildEditedClip] 4K low-memory preparation:"
            );
            console.log(commandLine);
            onProgress?.(0);
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
                `[buildEditedClip] prepare: ${line}`
              );
            }
          })
          .on("error", (err, stdout, stderr) => {
            console.error(
              "[buildEditedClip] 4K preparation ERROR:",
              err?.message || err
            );

            if (stderr) {
              console.error(
                "[buildEditedClip] 4K preparation STDERR:"
              );
              console.error(stderr);
            }

            reject(err);
          })
          .on("end", () => {
            if (
              !fs.existsSync(preparedPath) ||
              fs.statSync(preparedPath).size <= 0
            ) {
              return reject(
                new Error(
                  "4K preparation finished but prepared clip was not created"
                )
              );
            }

            console.log(
              `[buildEditedClip] Prepared low-memory source: ${preparedPath} (${fs.statSync(preparedPath).size} bytes)`
            );

            resolve();
          })
          .save(preparedPath);
      });
    }

    if (backgroundPath) {
      await new Promise((resolve, reject) => {
        const backgroundWidth =
          Math.max(
            180,
            Math.floor(targetWidth / 3 / 2) * 2
          );

        const backgroundHeight =
          Math.max(
            320,
            Math.floor(targetHeight / 3 / 2) * 2
          );

        const backgroundCommand =
          ffmpeg(preparedPath)
            .videoFilters(
              `scale=${backgroundWidth}:${backgroundHeight}:force_original_aspect_ratio=increase,` +
              `crop=${backgroundWidth}:${backgroundHeight},` +
              "gblur=sigma=18:steps=1"
            )
            .videoCodec("libx264")
            .outputOptions([
              "-an",
              "-threads", "1",
              "-filter_threads", "1",
              "-preset", "ultrafast",
              "-tune", "zerolatency",
              "-x264-params", "rc-lookahead=0:ref=1:bframes=0",
              "-crf", "32",
              "-pix_fmt", "yuv420p",
              "-movflags", "+faststart",
              "-avoid_negative_ts", "make_zero",
            ]);

        backgroundCommand
          .on("start", (commandLine) => {
            console.log(
              "[buildEditedClip] 4K blurred background preparation:"
            );
            console.log(commandLine);
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
                `[buildEditedClip] background: ${line}`
              );
            }
          })
          .on("error", (err, stdout, stderr) => {
            console.error(
              "[buildEditedClip] background preparation ERROR:",
              err?.message || err
            );

            if (stderr) {
              console.error(
                "[buildEditedClip] background preparation STDERR:"
              );
              console.error(stderr);
            }

            reject(err);
          })
          .on("end", () => {
            if (
              !fs.existsSync(backgroundPath) ||
              fs.statSync(backgroundPath).size <= 0
            ) {
              return reject(
                new Error(
                  "Blurred background preparation finished but file was not created"
                )
              );
            }

            console.log(
              `[buildEditedClip] Prepared blurred background: ${backgroundPath} (${fs.statSync(backgroundPath).size} bytes)`
            );

            resolve();
          })
          .save(backgroundPath);
      });
    }

    const renderInput =
      preparedPath || rawClipPath;

    const filters = [];

    if (mode === "fill") {
      if (backgroundPath) {
        const foreground =
          `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`;

        filters.push(
          `[1:v]scale=${targetWidth}:${targetHeight}[bg]`
        );

        filters.push(
          `[0:v]${foreground},format=yuv420p[fg]`
        );

        filters.push(
          "[bg][fg]overlay=(W-w)/2:(H-h)/2," +
          "fade=t=in:st=0:d=0.4," +
          `ass='${escapePathForFilter(assPath)}':shaping=complex,` +
          "format=yuv420p[v]"
        );
      } else {
        filters.push(
          `[0:v]split=2[bgsrc][fgsrc]`
        );

        const backgroundWidth =
          Math.max(
            180,
            Math.floor(targetWidth / 3 / 2) * 2
          );

        const backgroundHeight =
          Math.max(
            320,
            Math.floor(targetHeight / 3 / 2) * 2
          );

        filters.push(
          `[bgsrc]scale=${backgroundWidth}:${backgroundHeight}:force_original_aspect_ratio=increase,` +
          `crop=${backgroundWidth}:${backgroundHeight},` +
          "gblur=sigma=18:steps=1," +
          `scale=${targetWidth}:${targetHeight}[bg]`
        );

        filters.push(
          `[fgsrc]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,format=yuv420p[fg]`
        );

        filters.push(
          "[bg][fg]overlay=(W-w)/2:(H-h)/2," +
          "fade=t=in:st=0:d=0.4," +
          `ass='${escapePathForFilter(assPath)}':shaping=complex,` +
          "format=yuv420p[v]"
        );
      }
    } else {
      const videoChain =
        `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;

      filters.push(
        `[0:v]${videoChain},` +
        "fade=t=in:st=0:d=0.4," +
        `ass='${escapePathForFilter(assPath)}':shaping=complex,` +
        "format=yuv420p[v]"
      );
    }

    if (bgmPath) {
      const fadeOutStart =
        Math.max(
          0,
          Number(clipDuration) - 1.5
        ).toFixed(2);

      const bgmBase =
        "[1:a]" +
        `volume=${BGM_VOLUME},` +
        "afade=t=in:st=0:d=1," +
        `afade=t=out:st=${fadeOutStart}:d=1.5`;

      if (originalInfo.hasAudio) {
        filters.push(
          "[0:a]asplit=2[voice][sc]"
        );

        filters.push(
          `${bgmBase}[bgm0]`
        );

        filters.push(
          `[bgm0][sc]sidechaincompress=` +
          `threshold=${DUCK_THRESHOLD}:` +
          `ratio=${DUCK_RATIO}:` +
          "attack=30:" +
          "release=500[bgmd]"
        );

        filters.push(
          "[voice][bgmd]amix=inputs=2:" +
          "duration=first:" +
          "dropout_transition=0:" +
          "normalize=0," +
          "alimiter=limit=0.9[a]"
        );
      } else {
        filters.push(
          `${bgmBase},atrim=duration=${Number(clipDuration).toFixed(2)}[a]`
        );
      }
    }

    return await new Promise((resolve, reject) => {
      const command =
        ffmpeg(renderInput);

    if (backgroundPath) {
      command.input(backgroundPath);
    }

    if (bgmPath) {
      command.input(bgmPath);
    }

    /*
     * When a 4K background exists:
     *   input 0 = prepared low-res source
     *   input 1 = low-res blurred background
     *   BGM      = input 2
     *
     * The audio graph therefore needs the correct BGM input index.
     */
    if (bgmPath && backgroundPath) {
      for (let i = 0; i < filters.length; i++) {
        filters[i] = filters[i]
          .replace("[1:a]", "[2:a]");
      }
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
        "-threads", "1",
        "-filter_threads", "1",
        "-filter_complex_threads", "1",
      ])
      .outputOptions(maps)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-threads", "1",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-x264-params",
        "rc-lookahead=0:ref=1:bframes=0",
        "-crf",
        is4KOrLarger ? "26" : "23",
        "-pix_fmt", "yuv420p",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
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
        if (
          !fs.existsSync(outputPath) ||
          fs.statSync(outputPath).size <= 0
        ) {
          cleanupTemp();

          return reject(
            new Error(
              "FFmpeg finished but edited clip was not created"
            )
          );
        }

        const size =
          fs.statSync(outputPath).size;

        console.log(
          `[buildEditedClip] Created: ${outputPath} (${size} bytes)`
        );

        cleanupTemp();
        resolve(outputPath);
      })
      .on("error", (err, stdout, stderr) => {
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

        cleanupTemp();
        reject(err);
      })
      .save(outputPath);
    });
  } catch (error) {
    cleanupTemp();
    throw error;
  }
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