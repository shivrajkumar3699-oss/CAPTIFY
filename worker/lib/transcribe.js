import Groq from "groq-sdk";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";

ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioBitrate("64k")
      .format("mp3")
      .on("end", () => resolve(audioPath))
      .on("error", reject)
      .save(audioPath);
  });
}

// A Roman-script Hinglish prompt. When passed to Whisper as "prompt",
// it biases the transcription toward Roman letters instead of Devanagari.
const HINGLISH_PROMPT =
  "yaar ye video bilkul badhiya hai, kya baat hai, " +
  "life me kuch accha karna hai toh mehnat zaroori hai, " +
  "chalo dost ek kahani suno, maza aa gaya, " +
  "family aur dost dono important hai, sach me kamaal kar diya.";

/**
 * Transcribes audio with word-level timestamps.
 *
 * @param {string} audioPath - path of the extracted mp3
 * @param {string} [language] - "auto" or undefined = auto detect,
 *        "en" = force English, "hi" = force Hindi (Devanagari output),
 *        "hinglish" = no language pin, but Roman Hinglish prompt
 *        (best effort - Whisper may still return Devanagari sometimes,
 *        the captions font fix handles that case).
 */
export async function transcribeWithTimestamps(audioPath, language) {
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
  // "auto" or anything else: leave both out, Whisper auto-detects.

const transcription = await groq.audio.transcriptions.create(params);

return {
    text: transcription.text,
    words: transcription.words || [],
  };
}
