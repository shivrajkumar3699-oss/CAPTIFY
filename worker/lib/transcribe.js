import Groq from "groq-sdk";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MAX_TRANSCRIPTION_CHUNK_SECONDS = 600;
const TRANSCRIPTION_CONCURRENCY = 2;
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
    timestamp_granularities: ["word", "segment"],
  };

  if (language === "en" || language === "hi") {
    params.language = language;
  }

  if (language === "hinglish") {
    params.prompt = HINGLISH_PROMPT;
  } else if (language !== "en") {
    // Auto mode stays multilingual, but this context helps Whisper recognize
    // Hindi-dubbed cartoon dialogue and discourages English music hallucinations.
    params.prompt =
      "Oggy and the Cockroaches Hindi dubbed cartoon. " +
      "Hindi dialogue may be mixed with background music. " +
      "Character names: Oggy, Cockroaches. " +
      "Examples of Hindi dialogue: chalo ab maza aayega, kya baat hai. " +
      "Transcribe only speech that is actually audible; do not invent words for music.";
  }

  return groq.audio.transcriptions.create(params);
}

function isLowConfidenceMusicWord(word, segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;

  const start = Number(word?.start);
  const end = Number(word?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;

  let best = null;
  let bestOverlap = 0;
  for (const segment of segments) {
    const segStart = Number(segment?.start);
    const segEnd = Number(segment?.end);
    if (!Number.isFinite(segStart) || !Number.isFinite(segEnd) || segEnd <= segStart) continue;
    const overlap = Math.max(0, Math.min(end, segEnd) - Math.max(start, segStart));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = segment;
    }
  }

  if (!best || bestOverlap < Math.min(0.03, (end - start) * 0.25)) return false;

  const noSpeech = Number(best.no_speech_prob);
  const avgLogprob = Number(best.avg_logprob);
  // Drop words only when Whisper itself marks their containing segment as
  // likely non-speech, or combines a moderate non-speech score with very low
  // confidence. Normal spoken lines over background music remain eligible.
  return noSpeech >= 0.60 ||
    (noSpeech >= 0.35 && Number.isFinite(avgLogprob) && avgLogprob <= -1.0);
}

/**
 * Transcribes audio with word-level timestamps. Long audio is split into
 * short, compressed chunks so each Groq request stays below upload limits.
 * Low-confidence words from Whisper segments marked as non-speech are removed
 * to avoid captions such as "Oh Yeah" over instrumental music.
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
      `[transcribe] duration=${duration.toFixed(1)}s chunks=${chunkCount} maxChunk=${MAX_TRANSCRIPTION_CHUNK_SECONDS}s concurrency=${TRANSCRIPTION_CONCURRENCY}`
    );

    async function transcribeChunk(index) {
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
      const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
      const words = Array.isArray(transcription?.words) ? transcription.words : [];
      const acceptedWords = [];

      for (const word of words) {
        if (isLowConfidenceMusicWord(word, segments)) continue;

        const adjusted = { ...word };
        if (Number.isFinite(Number(adjusted.start))) {
          adjusted.start = Number(adjusted.start) + start;
        }
        if (Number.isFinite(Number(adjusted.end))) {
          adjusted.end = Number(adjusted.end) + start;
        }
        acceptedWords.push(adjusted);
      }

      const chunkText = acceptedWords
        .map((word) => String(word.word || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();

      return { words: acceptedWords, text: chunkText };
    }

    // Keep only two audio conversions/API requests in flight at once. This
    // reduces serial waiting time without spawning a large CPU/memory burst
    // on Render Free.
    for (let batchStart = 0; batchStart < chunkCount; batchStart += TRANSCRIPTION_CONCURRENCY) {
      const indexes = Array.from(
        { length: Math.min(TRANSCRIPTION_CONCURRENCY, chunkCount - batchStart) },
        (_, offset) => batchStart + offset
      );
      const results = await Promise.all(indexes.map(transcribeChunk));

      for (const result of results) {
        allWords.push(...result.words);
        if (result.text) transcriptParts.push(result.text);
      }
    }

    allWords.sort((a, b) => Number(a.start) - Number(b.start));

    return {
      text: transcriptParts.join(" ").trim(),
      words: allWords,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}