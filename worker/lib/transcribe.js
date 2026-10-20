import Groq from "groq-sdk";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MAX_TRANSCRIPTION_CHUNK_SECONDS = 300;
const TRANSCRIPTION_AUDIO_BITRATE = "48k";

// A Roman-script Hinglish prompt. When passed to Whisper as "prompt",
// it biases the transcription toward Roman letters instead of Devanagari.
const HINGLISH_PROMPT =
  "yaar ye video bilkul badhiya hai, kya baat hai, " +
  "life me kuch accha karna hai toh mehnat zaroori hai, " +
  "chalo dost ek kahani suno, maza aa gaya, " +
  "family aur dost dono important hai, sach me kamaal kar diya.";

export function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate(TRANSCRIPTION_AUDIO_BITRATE)
      .format("mp3")
      .outputOptions(["-threads", "1"])
      .on("end", () => resolve(audioPath))
      .on("error", reject)
      .save(audioPath);
  });
}

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (error, metadata) => {
      if (error) return reject(error);
      const duration = Number(metadata?.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        return reject(new Error("Could not read extracted audio duration."));
      }
      resolve(duration);
    });
  });
}

function createAudioChunk(sourcePath, outputPath, start, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .inputOptions(["-ss", String(start), "-t", String(duration)])
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate(TRANSCRIPTION_AUDIO_BITRATE)
      .format("mp3")
      .outputOptions(["-threads", "1"])
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });
}

async function transcribeOneFile(audioPath, language) {
  const params = {
    file: fs.createReadStream(audioPath),
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  };

  if (language === "en" || language === "hi") {
    params.language = language;
  } else if (language === "hinglish") {
    params.prompt = HINGLISH_PROMPT;
  }

  return groq.audio.transcriptions.create(params);
}

/**
 * Transcribes audio with word-level timestamps. Long audio is split into
 * short, compressed chunks so each Groq request stays well below its upload
 * limit. Chunk-relative timestamps are converted back to full-file time.
 */
export async function transcribeWithTimestamps(audioPath, language) {
  const duration = await getAudioDuration(audioPath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captify-transcribe-"));
  const allWords = [];
  const transcriptParts = [];

  try {
    const chunkCount = Math.max(
      1,
      Math.ceil(duration / MAX_TRANSCRIPTION_CHUNK_SECONDS)
    );

    console.log(
      `[transcribe] duration=${duration.toFixed(1)}s chunks=${chunkCount} maxChunk=${MAX_TRANSCRIPTION_CHUNK_SECONDS}s`
    );

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * MAX_TRANSCRIPTION_CHUNK_SECONDS;
      const chunkDuration = Math.min(
        MAX_TRANSCRIPTION_CHUNK_SECONDS,
        duration - start
      );
      const chunkPath = path.join(
        tempDir,
        `chunk-${String(index + 1).padStart(3, "0")}.mp3`
      );

      await createAudioChunk(audioPath, chunkPath, start, chunkDuration);
      const sizeBytes = fs.statSync(chunkPath).size;
      console.log(
        `[transcribe] chunk ${index + 1}/${chunkCount} size=${(sizeBytes / 1024 / 1024).toFixed(2)}MB offset=${start.toFixed(1)}s`
      );

      const transcription = await transcribeOneFile(chunkPath, language);
      const chunkText = String(transcription?.text || "").trim();
      if (chunkText) transcriptParts.push(chunkText);

      const words = Array.isArray(transcription?.words)
        ? transcription.words
        : [];
      for (const word of words) {
        const adjusted = { ...word };
        if (Number.isFinite(Number(adjusted.start))) {
          adjusted.start = Number(adjusted.start) + start;
        }
        if (Number.isFinite(Number(adjusted.end))) {
          adjusted.end = Number(adjusted.end) + start;
        }
        allWords.push(adjusted);
      }
    }

    return {
      text: transcriptParts.join(" ").trim(),
      words: allWords,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
