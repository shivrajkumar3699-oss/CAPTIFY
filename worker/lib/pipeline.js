// worker/lib/pipeline.js
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;

// ---- Background music settings (easy to tweak) ----
// Base BGM loudness. Lower = quieter music. (was 0.15 before)
const BGM_VOLUME = 0.1;
// Auto-ducking: music dips while someone is speaking and comes back in pauses.
const DUCK_THRESHOLD = 0.03; // how loud the voice must be to trigger ducking
const DUCK_RATIO = 3; // higher = music dips more while speaking

function evenRound(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

function evenFloor(n) {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function getVideoDuration(sourcePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(sourcePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata && metadata.format && metadata.format.duration;
      if (!duration) return reject(new Error("Could not read video duration"));
      resolve(duration);
    });
  });
}

// Reads the real (display) width/height of a video (including phone rotation)
// and whether it has an audio track.
function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const streams = (metadata && metadata.streams) || [];
      const stream = streams.find((s) => s.codec_type === "video");
      if (!stream || !stream.width || !stream.height) {
        return reject(new Error("Could not read video size"));
      }
      const hasAudio = streams.some((s) => s.codec_type === "audio");

      let rotation = 0;
      if (stream.tags && stream.tags.rotate) {
        rotation = parseInt(stream.tags.rotate, 10) || 0;
      }
      if (Array.isArray(stream.side_data_list)) {
        for (const sd of stream.side_data_list) {
          if (typeof sd.rotation === "number") rotation = sd.rotation;
        }
      }

      if (Math.abs(rotation) % 180 === 90) {
        resolve({ width: stream.height, height: stream.width, hasAudio });
      } else {
        resolve({ width: stream.width, height: stream.height, hasAudio });
      }
    });
  });
}

/**
 * Frame-accurate trim (re-encodes). Used for the "raw" download AND as the
 * input for the edited clip.
 *
 * IMPORTANT: we do NOT use "-c copy" here. Stream copy can only cut on
 * keyframes, so the clip would start seconds BEFORE the requested time and
 * the captions (which are timed from the requested start) would appear
 * early. Re-encoding makes the cut land exactly on startTime.
 */
function cutRawClip(sourcePath, startTime, endTime, outputPath) {
  return new Promise((resolve, reject) => {
    const duration = Math.max(0.1, endTime - startTime);
    ffmpeg(sourcePath)
      .setStartTime(startTime)
      .setDuration(duration)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "160k",
        "-movflags", "+faststart",
      ])
      .on("end", () => resolve(outputPath))
      .on("error", (err, stdout, stderr) => {
        console.error("[cutRawClip] FULL ERROR:", err.message);
        console.error("[cutRawClip] FULL STDERR:", stderr);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Escapes a Windows path for use inside an ffmpeg filtergraph (ass= filter):
 * backslashes -> forward slashes, colons escaped, whole value in single quotes.
 */
function escapePathForFilter(p) {
  const escaped = p.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `'${escaped}'`;
}

/**
 * Builds the ffmpeg filter graph for the edited clip.
 *
 * framing = "fit"  -> the WHOLE original frame stays visible in the middle of
 *                     the 9:16 screen, with a blurred copy of the video behind
 *                     it (the classic Opus Clip / Reels look).
 * framing = "fill" -> the video is center-cropped to fill the whole 9:16 screen.
 */
function buildFilterGraph(info, framing, escapedAss, hasBgm, clipDuration) {
  const srcW = info.width;
  const srcH = info.height;

  let fgChain;
  if (framing === "fill") {
    const cropW = evenFloor(Math.min(srcW, (srcH * VIDEO_WIDTH) / VIDEO_HEIGHT));
    const cropH = evenFloor(Math.min(srcH, (srcW * VIDEO_HEIGHT) / VIDEO_WIDTH));
    fgChain = `crop=${cropW}:${cropH},scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}`;
  } else {
    const fit = Math.min(VIDEO_WIDTH / srcW, VIDEO_HEIGHT / srcH);
    fgChain = `scale=${evenRound(srcW * fit)}:${evenRound(srcH * fit)}`;
  }

  const filters = [
    "[0:v]split=2[bgsrc][fgsrc]",
    // Blurred background. The first crop trims 3% off every edge so dark
    // borders from the source video don't show up as a line at the top/bottom.
    `[bgsrc]crop=trunc(iw*0.94/2)*2:trunc(ih*0.94/2)*2,scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=8,scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT},eq=brightness=-0.1[bg]`,
    `[fgsrc]${fgChain}[fg]`,
    // Main video in the center, short fade-in, burn captions
    `[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2',fade=t=in:st=0:d=0.4,ass=${escapedAss},format=yuv420p[v]`,
  ];

  if (hasBgm) {
    const fadeOutStart = Math.max(0, clipDuration - 1.5).toFixed(2);
    const bgmBase = `[1:a]volume=${BGM_VOLUME},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=1.5`;

    if (info.hasAudio) {
      filters.push("[0:a]asplit=2[voice][sc]");
      filters.push(`${bgmBase}[bgm0]`);
      filters.push(
        `[bgm0][sc]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:attack=30:release=500[bgmd]`
      );
      // normalize=0 keeps the speaker's voice at full volume (default amix halves it)
      filters.push(
        "[voice][bgmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.9[a]"
      );
    } else {
      // Source has no audio at all: music only, cut to the clip length
      filters.push(`${bgmBase},atrim=duration=${clipDuration.toFixed(2)}[a]`);
    }
  }

  return filters;
}

/**
 * Builds the final edited vertical clip (1080x1920).
 *
 * @param {string} rawClipPath
 * @param {string} assPath
 * @param {number} clipDuration
 * @param {string|null} bgmPath - absolute path to the chosen mp3, or null for no BGM
 * @param {string} outputPath
 * @param {"fit"|"fill"} framing - default "fit" (whole video visible + blurred background)
 */
function buildEditedClip(rawClipPath, assPath, clipDuration, bgmPath, outputPath, framing) {
  const mode = framing === "fill" ? "fill" : "fit";

  return getVideoInfo(rawClipPath).then(
    (info) =>
      new Promise((resolve, reject) => {
        const escapedAss = escapePathForFilter(assPath);
        const filters = buildFilterGraph(info, mode, escapedAss, !!bgmPath, clipDuration);

        console.log(
          `[buildEditedClip] source=${info.width}x${info.height} framing=${mode} bgm=${bgmPath ? "yes" : "no"} duration=${clipDuration.toFixed(1)}s`
        );

        const command = ffmpeg(rawClipPath);

        if (bgmPath) {
          command.input(bgmPath).inputOptions(["-stream_loop", "-1"]);
        }

        command
          .complexFilter(filters)
          .outputOptions(
            bgmPath
              ? ["-map", "[v]", "-map", "[a]"]
              : ["-map", "[v]", "-map", "0:a?"]
          )
          .outputOptions([
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "21",
            "-c:a", "aac",
            "-b:a", "160k",
            "-shortest",
            "-movflags", "+faststart",
          ])
          .on("end", () => resolve(outputPath))
          .on("error", (err, stdout, stderr) => {
            console.error("[buildEditedClip] FULL ERROR:", err.message);
            console.error("[buildEditedClip] FULL STDERR:", stderr);
            reject(err);
          })
          .save(outputPath);
      })
  );
}

module.exports = {
  getVideoDuration,
  cutRawClip,
  buildEditedClip,
  buildFilterGraph,
};