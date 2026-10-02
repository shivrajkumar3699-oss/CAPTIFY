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
      if (err) return reject(new Error("Could not read video information: " + err.message));
      const streams = (metadata && metadata.streams) || [];
      const stream = streams.find((s) => s.codec_type === "video");
      if (!stream || !stream.width || !stream.height) return reject(new Error("Could not read video size"));
      const hasAudio = streams.some((s) => s.codec_type === "audio");
      let rotation = 0;
      if (stream.tags && stream.tags.rotate != null) rotation = Number(stream.tags.rotate) || 0;
      if (Array.isArray(stream.side_data_list)) {
        for (const sd of stream.side_data_list) if (typeof sd.rotation === "number") rotation = sd.rotation;
      }
      const codedWidth = Number(stream.width);
      const codedHeight = Number(stream.height);
      let sarNum = 1, sarDen = 1;
      if (stream.sample_aspect_ratio) {
        const match = String(stream.sample_aspect_ratio).match(/^(\\d+):(\\d+)$/);
        if (match) { sarNum = Number(match[1]) || 1; sarDen = Number(match[2]) || 1; }
      }
      const displayWidth = codedWidth * sarNum / sarDen;
      const displayHeight = codedHeight;
      const displayIsPortrait = displayHeight > displayWidth;
      const quarterTurn = Math.abs(rotation) % 180 === 90;
      const applyRotation = quarterTurn && !displayIsPortrait;
      const width = applyRotation ? codedHeight : codedWidth;
      const height = applyRotation ? codedWidth : codedHeight;
      console.log("[getVideoInfo] ffprobe video stream:");
      console.log(JSON.stringify({
        path: videoPath, codedWidth, codedHeight,
        sample_aspect_ratio: stream.sample_aspect_ratio || "1:1",
        display_aspect_ratio: stream.display_aspect_ratio || null,
        rotation, side_data_list: stream.side_data_list || [], tags: stream.tags || {},
        computedDisplayWidth: Number(displayWidth.toFixed(3)),
        computedDisplayHeight: Number(displayHeight.toFixed(3)),
        displayGeometry: displayWidth >= displayHeight ? "landscape" : "portrait",
        applyRotation, finalWidth: width, finalHeight: height
      }, null, 2));
      resolve({ width, height, codedWidth, codedHeight, sampleAspectRatio: sarNum + ":" + sarDen, rotation, applyRotation, hasAudio });
    });
  });
}
// ------------------------------------------------------------
// Raw clip
// ------------------------------------------------------------

// Normalize browser-trimmed MP4s before rendering.
// This deliberately removes broken SAR and stale rotation metadata.
async function normalizeClipForRender(sourcePath, outputPath, info) {
  const shouldRotate = Boolean(info && info.applyRotation);
  const rotationFilter = shouldRotate ? (Number(info.rotation) < 0 ? "transpose=2," : "transpose=1,") : "";
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .inputOptions(["-noautorotate"])
      .videoFilters(
        rotationFilter +
        "scale=w='if(gt(iw*sar,ih),1280,trunc(iw*sar*1280/ih/2)*2)':h='if(gt(iw*sar,ih),trunc(ih*1280/(iw*sar)/2)*2,1280)',setsar=1"
      )
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-map", "0:v:0?", "-map", "0:a:0?",
        "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
        "-preset", "ultrafast", "-tune", "zerolatency",
        "-x264-params", "rc-lookahead=0:ref=1:bframes=0",
        "-crf", "26", "-pix_fmt", "yuv420p", "-b:a", "128k",
        "-shortest", "-movflags", "+faststart", "-avoid_negative_ts", "make_zero"
      ])
      .on("start", (line) => { console.log("[normalizeClipForRender] FFmpeg command:"); console.log(line); })
      .on("stderr", (line) => { if (/Error|error|Invalid|failed|Killed/.test(line)) console.error("[normalizeClipForRender] " + line); })
      .on("error", (err, stdout, stderr) => {
        console.error("[normalizeClipForRender] FFmpeg ERROR:", err && err.message ? err.message : err);
        if (stderr) console.error(stderr);
        reject(err);
      })
      .on("end", () => {
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) return reject(new Error("Clip normalization finished but normalized clip was not created"));
        console.log("[normalizeClipForRender] Created: " + outputPath + " (" + fs.statSync(outputPath).size + " bytes)");
        resolve(outputPath);
      })
      .save(outputPath);
  });
}
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
      `setsar=1,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,setsar=1`;

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

  // SAFE FAST PATH:
  // If the clip is already exactly the final 9:16 render size, do not
  // scale, split, blur, crop, or overlay it again. The visible result is
  // identical because the foreground already fills the complete canvas.
  const isAlreadyTargetPortrait =
    originalInfo.sampleAspectRatio === "1:1" &&
    !originalInfo.applyRotation &&
    originalInfo.width === targetWidth &&
    originalInfo.height === targetHeight;

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

  // For 4K fill renders, the blurred background is now generated directly
  // from the already-downscaled prepared source in the final filter graph.
  // This removes one complete encode + decode cycle while keeping the
  // memory-heavy 4K frames out of the graph.
  const backgroundPath = null;

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

    // 4K blurred background is intentionally generated in the final
    // low-resolution filter graph below. No separate background encode.


    const renderInput =
      preparedPath || rawClipPath;

    const filters = [];

    if (mode === "fill") {
      if (isAlreadyTargetPortrait) {
        // A full-frame 9:16 clip completely covers its own blurred
        // background. Skipping that hidden work does not change pixels.
        filters.push(
          "[0:v]," +
          "fade=t=in:st=0:d=0.4," +
          `ass='${escapePathForFilter(assPath)}':shaping=complex,` +
          "format=yuv420p[v]"
        );
      } else if (backgroundPath) {
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
      if (isAlreadyTargetPortrait) {
        // Already the exact target canvas: skip redundant scale/pad work.
        filters.push(
          "[0:v]," +
          "fade=t=in:st=0:d=0.4," +
          `ass='${escapePathForFilter(assPath)}':shaping=complex,` +
          "format=yuv420p[v]"
        );
      } else {
        const videoChain =
        `setsar=1,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

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
    // No separate background input is used anymore. BGM remains input 1.

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
  getVideoInfo,
  normalizeClipForRender,
  cutRawClip,
  buildEditedClip,
  buildFilterGraph,
};