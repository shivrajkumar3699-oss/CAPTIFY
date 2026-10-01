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

  const input = createInput(file);

  try {
    /*
     * IMPORTANT:
     * Never hard-code an H.264 WebCodecs configuration here.
     *
     * Chrome/Windows can report H.264 as available but reject a specific
     * width/height/profile when VideoEncoder.configure() is called.
     * Mediabunny provides getFirstEncodable* helpers that call the browser's
     * isConfigSupported() with the actual requested dimensions/bitrate/fps.
     *
     * We deliberately prepare a lightweight 720x1280 clip for Render.
     * This is still 9:16, dramatically smaller than 1080x1920, and keeps
     * the free 512 MB Render worker much safer.
     */
    const VIDEO_WIDTH = 720;
    const VIDEO_HEIGHT = 1280;
    const VIDEO_FPS = 30;
    const VIDEO_BITRATE = 2_500_000;

    const outputFormat = new Mp4OutputFormat();

    let videoCodec =
      await getFirstEncodableVideoCodec(
        outputFormat.getSupportedVideoCodecs(),
        {
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
          bitrate: VIDEO_BITRATE,
          frameRate: VIDEO_FPS,
        },
      );

    // Some older/odd browser builds reject 720x1280 but accept a smaller
    // vertical profile. Try one final safe fallback before giving up.
    let outputWidth = VIDEO_WIDTH;
    let outputHeight = VIDEO_HEIGHT;
    let outputBitrate = VIDEO_BITRATE;

    if (!videoCodec) {
      outputWidth = 540;
      outputHeight = 960;
      outputBitrate = 1_800_000;

      videoCodec =
        await getFirstEncodableVideoCodec(
          outputFormat.getSupportedVideoCodecs(),
          {
            width: outputWidth,
            height: outputHeight,
            bitrate: outputBitrate,
            frameRate: VIDEO_FPS,
          },
        );
    }

    if (!videoCodec) {
      throw new Error(
        "Your browser cannot encode a compatible MP4 hook clip. Please use the latest Chrome or Edge.",
      );
    }

    /*
     * Audio is probed too. This removes the second hard-coded WebCodecs
     * assumption (AAC) so a browser that cannot encode AAC does not reach
     * AudioEncoder.configure() and fail later.
     */
    const audioCodec =
      await getFirstEncodableAudioCodec(
        outputFormat.getSupportedAudioCodecs(),
        {
          numberOfChannels: 2,
          sampleRate: 48_000,
          bitrate: 128_000,
        },
      );

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
        end: Math.max(
          start + 0.1,
          end,
        ),
      },
      video: {
        width: outputWidth,
        height: outputHeight,
        fit: "cover",
        codec: videoCodec,
        bitrate: outputBitrate,
        frameRate: VIDEO_FPS,
        hardwareAcceleration: "no-preference",
        forceTranscode: true,
      },
      audio: audioCodec
        ? {
            codec: audioCodec,
            numberOfChannels: 2,
            sampleRate: 48_000,
            bitrate: 128_000,
            forceTranscode: true,
          }
        : {
            /*
             * If this browser cannot encode any MP4-compatible audio codec,
             * keep the source audio instead of trying to configure an
             * unsupported AudioEncoder.
             */
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
        "This hook cannot be prepared in your browser.",
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
