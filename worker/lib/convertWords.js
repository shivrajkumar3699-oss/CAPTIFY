// worker/lib/convertWords.js
// Converts transcribed words to the chosen caption language using Gemini.
//
// Real Indian creator videos often MIX languages within the same clip -
// some Devanagari, some Roman-Hindi (Hinglish), some pure English loanwords
// or even whole English sentences, sometimes in the same breath. So instead
// of deciding ONE strategy (transliterate-only or translate-only) for the
// WHOLE video, every chunk is sent through the SAME flexible prompt that
// can transliterate Hindi, translate English, and leave common loanwords
// alone -- whichever fits that chunk. This fixes captions staying in the
// wrong language whenever a video switches languages mid-way through.

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Same chain as detectHooks: try best first, skip on daily quota / 404.
const MODEL_CHAIN = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

const CHUNK_SIZE = 60; // words per conversion chunk

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Calls Gemini with the model chain. Returns the text reply or null.
 * Skips a model on daily quota (429 PerDay) and 404. Retries 3 times
 * on 503 / per-minute errors with 3s, 6s backoff.
 */
async function askGemini(prompt) {
  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
        });
        const text = (response && response.text) || "";
        if (text.trim().length > 0) return text;
      } catch (err) {
        const msg = String((err && err.message) || err);
        const status = err && err.status ? String(err.status) : "";
        if (status === "404" || /404|not found/i.test(msg)) break;
        if (/PerDay|per day/i.test(msg)) break;
        if (attempt < 2) {
          await sleep(attempt === 0 ? 3000 : 6000);
          continue;
        }
      }
    }
  }
  return null;
}

/**
 * Pulls a JSON array out of Gemini's reply (handles ```json fences
 * and stray prose before/after the array). Returns parsed value or null.
 */
function extractJson(text) {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.substring(start, end + 1));
  } catch (e) {
    return null;
  }
}

/**
 * Asks Gemini for a plain JSON array of N strings and validates it.
 * Returns array of strings or null.
 */
async function requestWordArray(prompt, expectedCount) {
  const reply = await askGemini(prompt);
  if (!reply) return null;
  const arr = extractJson(reply);
  if (!Array.isArray(arr)) return null;
  if (arr.length !== expectedCount) return null;
  const ok = arr.every((w) => typeof w === "string" && w.trim().length > 0);
  if (!ok) return null;
  return arr.map((w) => w.trim());
}

const TARGET_LABEL = {
  hi: "Hindi written in Devanagari script",
  en: "English",
  hinglish: "Hinglish (Hindi words written in Roman/Latin letters, the way people casually caption in India)",
};

/**
 * Converts ONE chunk of words to the target caption style. Handles MIXED
 * content within the same chunk (some words already Hindi in Devanagari,
 * some already Roman Hindi, some genuine English loanwords or even a
 * whole English phrase) by asking Gemini to produce the single best
 * natural caption word for each input word, rather than assuming the
 * whole chunk is one language.
 */
async function convertChunk(words, target) {
  const list = words.map((w) => w.word);
  const prompt =
    "You are preparing word-by-word captions for a short Indian social media video.\n" +
    "The target caption style is: " + TARGET_LABEL[target] + ".\n\n" +
    "You will receive a JSON array of " + list.length + " words, in the exact order they " +
    "were spoken. The speech may MIX Hindi (Devanagari), Hindi written in Roman letters " +
    "(Hinglish), and English words or even whole English phrases in the SAME clip -- this " +
    "is normal for Indian creators who switch languages mid-sentence or mid-video.\n\n" +
    "For EACH input word, output the best single caption word or short token in the target " +
    "style, keeping the same meaning and same order:\n" +
    "- Target Hinglish: write Hindi words in Roman letters; if a stretch of words is pure " +
    "English, translate it into natural spoken Hinglish; keep common English loanwords " +
    "that Indians normally say as-is (school, video, phone, community) unchanged.\n" +
    "- Target Hindi (Devanagari): write everything in Devanagari script, translating pure " +
    "English portions into natural Hindi where needed.\n" +
    "- Target English: translate everything into natural spoken English.\n\n" +
    "Rules:\n" +
    "- Output ONLY a JSON array of exactly " + list.length + " strings, one per input word, same order.\n" +
    "- Do not merge or split words, do not add or remove words, do not add explanations.\n" +
    "- Reply with nothing except the JSON array.\n\n" +
    "Input: " + JSON.stringify(list);
  return requestWordArray(prompt, list.length);
}

/**
 * Converts all words to the target caption language, chunk by chunk.
 * Falls back to the ORIGINAL words for any chunk that fails twice, so a
 * single bad chunk never breaks the rest of the clip.
 */
async function convertAllWords(words, target) {
  const out = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const chunk = words.slice(i, i + CHUNK_SIZE);
    let converted = await convertChunk(chunk, target);
    if (!converted) {
      converted = await convertChunk(chunk, target); // one retry
    }
    if (converted) {
      chunk.forEach((w, idx) => {
        out.push({ word: converted[idx], start: w.start, end: w.end });
      });
    } else {
      console.log("convertWords: chunk failed twice, keeping original words for that chunk");
      out.push(...chunk);
    }
  }
  return out;
}

/**
 * Converts transcribed words to the chosen caption language.
 *
 * @param {Array<{word:string,start:number,end:number}>} words
 * @param {string} targetLanguage - "en" | "hi" | "hinglish"
 * @param {string} sourceLanguage - "auto" | "en" | "hi" | "hinglish"
 *        (what the Video language dropdown said)
 * @param {Function} [pushStatus] - optional (progress, message) callback
 * @returns converted word array (same shape; falls back to input on failure)
 */
export async function convertWords(words, targetLanguage, sourceLanguage, pushStatus) {
  if (!words || words.length === 0) return words;
  if (!targetLanguage || targetLanguage === "same") return words;

  // Only skip conversion entirely when the dropdown EXPLICITLY says the
  // video is already in the target language/style. Do NOT try to guess
  // this from Devanagari presence alone -- a mostly-Hindi video can still
  // have whole English stretches that need converting too.
  if (targetLanguage === sourceLanguage) return words;

  if (pushStatus) pushStatus(30, "Caption language me convert kar rahe hain...");

  try {
    return await convertAllWords(words, targetLanguage);
  } catch (err) {
    console.log("convertWords failed, keeping original words:", err && err.message);
    return words;
  }
}