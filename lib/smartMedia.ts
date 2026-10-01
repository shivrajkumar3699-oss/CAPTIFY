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
    throw new Error(
      "Invalid hook timestamps.",
    );
  }

  const input = createInput(file);

  try {
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
        // Always hand Render a lightweight 1080x1920 H.264 hook.
        // This prevents 4K source frames from reaching the 512 MB worker.
        width: 1080,
        height: 1920,
        fit: "cover",
        codec: "avc",
        bitrate: 5_000_000,
        frameRate: 30,
        hardwareAcceleration:
          "prefer-hardware",
        forceTranscode: true,
      },
      audio: {
        codec: "aac",
        bitrate: 128_000,
        forceTranscode: true,
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
