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
  Quality,
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
    source: new BlobSource(file, {
      maxCacheSize: 32 * 1024 * 1024,
    }),
    formats: ALL_FORMATS,
  });
}

export async function extractSpeechAudio(
  file: File,
  onProgress?: (progress: number) => void
) {
  await ensureMp3Encoder();

  const input = createInput(file);
  const output = new Output({
    format: new Mp3OutputFormat({
      xingHeader: false,
    }),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: {
      codec: "mp3",
      numberOfChannels: 1,
      bitrate: 64_000,
    },
    showWarnings: false,
  });

  conversion.onProgress = (value) => {
    onProgress?.(Math.max(0, Math.min(1, value)));
  };

  if (!conversion.isValid) {
    throw new Error("This video format cannot be read in your browser.");
  }

  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Could not extract audio from this video.");
  }

  onProgress?.(1);
  return new Blob([buffer], { type: "audio/mpeg" });
}

export async function trimVideoForUpload(
  file: File,
  start: number,
  end: number,
  onProgress?: (progress: number) => void
) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Invalid hook timestamps.");
  }

  const input = createInput(file);
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
    video: {
      hardwareAcceleration: "prefer-hardware",
    },
    audio: {
      codec: "aac",
      bitrate: 160_000,
    },
    copy: {
      mode: "preferred",
      boundaryPolicy: "expand",
    },
    showWarnings: false,
  });

  conversion.onProgress = (value) => {
    onProgress?.(Math.max(0, Math.min(1, value)));
  };

  if (!conversion.isValid) {
    throw new Error("This video cannot be prepared for browser-side clipping.");
  }

  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Browser could not create the selected clip.");
  }

  onProgress?.(1);

  return new Blob([buffer], { type: "video/mp4" });
}
