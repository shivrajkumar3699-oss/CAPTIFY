"use client";

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";

let mp3Ready = false;

async function ensureMp3Encoder() {
  if (mp3Ready) return;

  registerMp3Encoder();
  mp3Ready = true;
}

function createInput(file: File) {
  return new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file, {
      maxCacheSize: 64 * 1024 * 1024,
      useStreamReader: true,
    }),
  });
}

export type SmartSegment = {
  title: string;
  hookReason: string;
  startTime: number;
  endTime: number;
};

export async function getMediaDuration(file: File) {
  const input = createInput(file);

  try {
    const metadataDuration =
      await input.getDurationFromMetadata();

    if (
      typeof metadataDuration === "number" &&
      Number.isFinite(metadataDuration) &&
      metadataDuration > 0
    ) {
      return metadataDuration;
    }

    const duration = await input.computeDuration();

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        "Could not determine media duration."
      );
    }

    return duration;
  } finally {
    input.dispose();
  }
}

export async function extractSpeechAudio(
  file: File,
  onProgress?: (progress: number) => void,
) {
  await ensureMp3Encoder();

  const input = createInput(file);

  try {
    const output = new Output({
      format: new Mp3OutputFormat({
        xingHeader: false,
      }),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        discard: true,
      },
      audio: {
        codec: "mp3",
        numberOfChannels: 1,
        bitrate: 64_000,
      },
      showWarnings: false,
    });

    conversion.onProgress = (value) => {
      onProgress?.(
        Math.max(
          0,
          Math.min(1, value),
        ),
      );
    };

    if (!conversion.isValid) {
      throw new Error(
        "This media format cannot be read in your browser.",
      );
    }

    await conversion.execute();

    const buffer = output.target.buffer;

    if (!buffer || buffer.byteLength === 0) {
      throw new Error(
        "Could not extract speech audio from this file.",
      );
    }

    onProgress?.(1);

    return new Blob(
      [buffer],
      {
        type: "audio/mpeg",
      },
    );
  } finally {
    input.dispose();
  }
}

export async function trimVideoForUpload(
  file: File,
  start: number,
  end: number,
  onProgress?: (progress: number) => void,
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    throw new Error("Invalid hook timestamps.");
  }

  const input = createInput(file);

  try {
    const videoTrack = await input.getPrimaryVideoTrack();

    if (!videoTrack) {
      throw new Error("Could not find a video track in the selected file.");
    }

    const sourceWidth = await videoTrack.getDisplayWidth();
    const sourceHeight = await videoTrack.getDisplayHeight();
    const is4KOrLarger =
      Number.isFinite(sourceWidth) &&
      Number.isFinite(sourceHeight) &&
      Math.max(sourceWidth, sourceHeight) >= 2160;

    /*
     * IMPORTANT:
     * 4K is handled with the browser's native <video> + Canvas + MediaRecorder
     * path instead of WebCodecs/Mediabunny Conversion.
     *
     * The previous Mediabunny path reached VideoEncoder.configure(), where
     * Chrome could reject the generated configuration with:
     * "Unsupported configuration. Check isConfigSupported() prior to
     * calling configure()."
     *
     * Native MediaRecorder performs the browser's codec selection itself,
     * so there is no application-created VideoEncoder configuration to fail.
     *
     * Only the 4K path uses this. Normal clips keep the existing Mediabunny
     * packet-copy path below.
     */
    if (is4KOrLarger) {
      return await trim4KWithNativeRecorder(
        file,
        start,
        end,
        onProgress,
      );
    }

    const output = new Output({
      format: new Mp4OutputFormat({
        fastStart: "in-memory",
      }),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      trim: {
        start: Math.max(0, start),
        end: Math.max(start + 0.1, end),
      },
      copy: {
        mode: "preferred",
        shiftTolerance: Infinity,
      },
      showWarnings: false,
    });

    conversion.onProgress = (value) => {
      onProgress?.(Math.max(0, Math.min(1, value)));
    };

    if (!conversion.isValid) {
      throw new Error(
        "This video cannot be trimmed in your browser. Please use an MP4/MOV-compatible source.",
      );
    }

    await conversion.execute();

    const buffer = output.target.buffer;

    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Browser could not create the selected hook clip.");
    }

    onProgress?.(1);

    return new File([buffer], "captify-hook.mp4", {
      type: "video/mp4",
    });
  } finally {
    input.dispose();
  }
}

async function trim4KWithNativeRecorder(
  file: File,
  start: number,
  end: number,
  onProgress?: (progress: number) => void,
): Promise<File> {
  if (
    typeof document === "undefined" ||
    typeof MediaRecorder === "undefined"
  ) {
    throw new Error(
      "Your browser does not support the native 4K preparation required by CAPTIFY. Please use the latest Chrome or Edge.",
    );
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = false;
  video.playsInline = true;
  video.src = sourceUrl;

  const cleanup = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        reject(new Error("Browser could not decode the 4K source video."));
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    const targetWidth = 720;
    const aspectRatio =
      video.videoWidth > 0 && video.videoHeight > 0
        ? video.videoHeight / video.videoWidth
        : 16 / 9;
    const targetHeight = Math.max(
      2,
      Math.round((targetWidth * aspectRatio) / 2) * 2,
    );

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    if (!ctx) {
      throw new Error("Browser could not create the 4K video canvas.");
    }

    const captureStream = (video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
    }).captureStream;

    const sourceStream =
      typeof captureStream === "function"
        ? captureStream.call(video)
        : null;

    if (!sourceStream) {
      throw new Error(
        "Your browser does not support video capture for 4K preparation. Please use the latest Chrome or Edge.",
      );
    }

    const canvasStream = canvas.captureStream(30);

    for (const track of canvasStream.getVideoTracks()) {
      track.enabled = true;
    }

    const outputTracks = [
      ...canvasStream.getVideoTracks(),
      ...sourceStream.getAudioTracks(),
    ];

    if (outputTracks.length === 0) {
      throw new Error("The 4K source does not contain a recordable media track.");
    }

    const combinedStream = new MediaStream(outputTracks);

    const mimeTypes = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    const mimeType = mimeTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );

    if (!mimeType) {
      throw new Error(
        "Your browser does not support the video format required to prepare this 4K clip. Please use the latest Chrome or Edge.",
      );
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });

    const duration = Math.max(0.1, end - start);

    const result = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      let raf = 0;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(raf);
        if (error) reject(error);
        else resolve(new Blob(chunks, { type: mimeType }));
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = () => {
        finish(new Error("Browser failed while preparing the 4K hook."));
      };

      recorder.onstop = () => {
        if (chunks.length === 0) {
          finish(new Error("Browser produced an empty 4K hook."));
          return;
        }
        finish();
      };

      const draw = () => {
        if (settled) return;

        const elapsed = Math.max(
          0,
          Math.min(duration, video.currentTime - start),
        );
        onProgress?.(Math.max(0, Math.min(0.98, elapsed / duration)));

        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const scale = Math.min(
          canvas.width / Math.max(1, video.videoWidth),
          canvas.height / Math.max(1, video.videoHeight),
        );
        const drawWidth = video.videoWidth * scale;
        const drawHeight = video.videoHeight * scale;
        const x = (canvas.width - drawWidth) / 2;
        const y = (canvas.height - drawHeight) / 2;

        ctx.drawImage(video, x, y, drawWidth, drawHeight);

        if (video.currentTime >= end || video.ended) {
          if (recorder.state !== "inactive") recorder.stop();
          return;
        }

        raf = requestAnimationFrame(draw);
      };

      const begin = async () => {
        try {
          video.currentTime = Math.max(0, start);
          await new Promise<void>((resolveSeek, rejectSeek) => {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              resolveSeek();
            };
            video.addEventListener("seeked", onSeeked, { once: true });
            video.addEventListener(
              "error",
              () => rejectSeek(new Error("Browser could not seek the 4K source.")),
              { once: true },
            );
          });

          recorder.start(250);
          await video.play();
          raf = requestAnimationFrame(draw);
        } catch (error) {
          if (recorder.state !== "inactive") recorder.stop();
          finish(
            error instanceof Error
              ? error
              : new Error("Browser could not start 4K preparation."),
          );
        }
      };

      void begin();
    });

    onProgress?.(1);

    const extension = mimeType.includes("webm") ? "webm" : "mp4";
    return new File([result], `captify-hook.${extension}`, {
      type: result.type || mimeType,
    });
  } finally {
    cleanup();
  }
}
