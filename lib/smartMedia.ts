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
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  QUALITY_MEDIUM,
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
    throw new Error(
      "Invalid hook timestamps.",
    );
  }

  /*
   * Smart hook upload path:
   *
   * - Normal sources stay on the fast packet-copy path.
   * - 4K+ sources are DOWN-SCALED IN THE BROWSER to 1080p before upload.
   *
   * This is important because Render's free worker has only ~512 MB RAM.
   * Uploading a copied 2160x3840 hook forces FFmpeg on Render to decode
   * 4K frames and can kill the worker before caption rendering even starts.
   *
   * The browser has the user's local RAM/CPU available, so doing this
   * conversion here keeps the server-side render lightweight.
   */

  const input = createInput(file);

  try {
    const videoTrack = await input.getPrimaryVideoTrack();

    if (!videoTrack) {
      throw new Error(
        "Could not find a video track in the selected file.",
      );
    }

    const sourceWidth = await videoTrack.getDisplayWidth();
    const sourceHeight = await videoTrack.getDisplayHeight();
    const is4KOrLarger =
      Number.isFinite(sourceWidth) &&
      Number.isFinite(sourceHeight) &&
      Math.max(sourceWidth, sourceHeight) >= 2160;

    const output = new Output({
      format: new Mp4OutputFormat({
        fastStart: "in-memory",
      }),
      target: new BufferTarget(),
    });

    /*
     * IMPORTANT:
     * When resizing 4K video, Mediabunny has to use a browser VideoEncoder.
     * Letting Conversion pick a codec implicitly caused some browsers to
     * select a configuration that later failed at VideoEncoder.configure().
     *
     * Probe the actual encoder support FIRST and explicitly pass the codec
     * that this browser can encode at the requested dimensions.
     */
    let browserVideoCodec:
      | Awaited<ReturnType<typeof getFirstEncodableVideoCodec>>
      | null = null;

    let resizedHeight: number | undefined;

    if (is4KOrLarger) {
      resizedHeight = Math.max(
        2,
        Math.round(
          (720 / Math.max(1, sourceWidth)) *
            sourceHeight /
            2,
        ) * 2,
      );

      browserVideoCodec =
        await getFirstEncodableVideoCodec(
          output.format.getSupportedVideoCodecs(),
          {
            width: 720,
            height: resizedHeight,
            quality: QUALITY_MEDIUM,
          },
        );

      if (!browserVideoCodec) {
        throw new Error(
          "Your browser does not support the video encoder required to prepare this 4K clip. Please use the latest Chrome or Edge.",
        );
      }
    }

    const conversion = await Conversion.init({
      input,
      output,
      trim: {
        start: Math.max(0, start),
        end: Math.max(start + 0.1, end),
      },

      video: is4KOrLarger
        ? {
            // Keep the complete 4K hook while reducing its encoded size
            // before it reaches the Render worker.
            width: 720,
            height: resizedHeight!,
            fit: "contain",
            codec: browserVideoCodec!,
            quality: QUALITY_MEDIUM,
            forceTranscode: true,
          }
        : undefined,

      // Normal sources use packet copy. 4K sources necessarily transcode
      // because the video dimensions are being reduced to 1080-wide.
      copy: {
        mode: "preferred",
        shiftTolerance: Infinity,
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
        is4KOrLarger
          ? "This 4K video cannot be converted in your browser. Please try the same file in Chrome/Edge."
          : "This video cannot be trimmed in your browser. Please use an MP4/MOV-compatible source.",
      );
    }

    await conversion.execute();

    const buffer = output.target.buffer;

    if (!buffer || buffer.byteLength === 0) {
      throw new Error(
        "Browser could not create the selected hook clip.",
      );
    }

    onProgress?.(1);

    return new File(
      [buffer],
      "captify-hook.mp4",
      {
        type: "video/mp4",
      },
    );
  } finally {
    input.dispose();
  }
}
