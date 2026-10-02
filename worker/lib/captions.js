// worker/lib/captions.js
const fs = require("fs");

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;

// ---- Caption layout settings (easy to tweak) ----
const MAX_WORDS_PER_LINE = 4;
const MAX_CHARS_PER_LINE = 26; // start a new line before it gets too wide
const PAUSE_BREAK_SECONDS = 0.6; // a pause this long starts a new line
const HOLD_AFTER_LAST_WORD = 0.25; // keep the last word on screen a moment longer

// ---- Fonts ----
// Arial Black looks great for Latin text but has NO Devanagari glyphs
// (Hindi words came out blank). Nirmala UI is on every Windows PC and
// covers both Devanagari AND Latin, so we auto-switch when needed.
const FONT_LATIN = "Arial Black";
const FONT_DEVANAGARI = "Nirmala UI"; // if Hindi still comes out blank, try "Mangal" here

// Converts a hex color like "#FFD700" into the 6-char BGR hex string
// that ASS/SSA subtitle format uses internally.
function hexToBgrHex(hex) {
  let clean = (hex || "").replace("#", "").trim();
  if (clean.length !== 6) clean = "FFFFFF"; // fallback: white
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return (b + g + r).toUpperCase();
}

function formatAssTime(seconds) {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .trim();
}

// Lowercase letters/numbers only, used just to compare two words.
function normalizeWord(w) {
  return String(w).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

// True if the text contains ANY Devanagari character (Hindi block).
function containsDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text));
}

function buildAssHeader(fontName, marginV = 190) {
  const whiteColor = "&H00FFFFFF";
  const outlineColor = "&H00000000";
  return `[Script Info]
Title: Captify Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${VIDEO_WIDTH}
PlayResY: ${VIDEO_HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},90,${whiteColor},${whiteColor},${outlineColor},&H00000000,-1,0,0,0,100,100,0,0,1,6,0,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Cleans up the raw word list from transcription:
 *  - sorts by time
 *  - removes "echo" words (same word repeated at the same moment, which
 *    transcription sometimes produces -> this caused doubled captions)
 *  - makes sure no two words overlap in time
 */
function cleanWords(rawWords) {
  const sorted = (rawWords || [])
    .map((w, idx) => ({
      word: String(w.word || "").trim(),
      start: Number(w.start),
      end: Number(w.end),
      idx: idx,
    }))
    .filter((w) => w.word.length > 0 && isFinite(w.start) && isFinite(w.end))
    .sort((a, b) => a.start - b.start || a.idx - b.idx);

const out = [];
  for (const w of sorted) {
    if (w.end <= w.start) w.end = w.start + 0.12;
    const dur = Math.max(0.05, w.end - w.start);

// Echo check: same word, overlapping in time with one of the last few words
    const isEcho = out.slice(-6).some((p) => {
      const overlap = Math.min(p.end, w.end) - Math.max(p.start, w.start);
      return normalizeWord(p.word) === normalizeWord(w.word) && overlap > 0.3 * dur;
    });
    if (isEcho) continue;

// Overlap check: never let two different words sit on the same moment
    const prev = out[out.length - 1];
    if (prev && prev.end > w.start) {
      if (w.start - prev.start > 0.05) {
        prev.end = w.start;
      } else {
        w.start = prev.end;
        if (w.end <= w.start) w.end = w.start + 0.12;
      }
    }

out.push({ word: w.word, start: w.start, end: w.end });
  }
  return out;
}

/**
 * Groups words into caption lines. A new line starts when:
 *  - the line has MAX_WORDS_PER_LINE words, or would get too wide
 *  - the previous word ended a sentence (. ? ! or the Hindi danda)
 *  - there is a pause longer than PAUSE_BREAK_SECONDS
 */
function groupIntoLines(words) {
  const lines = [];
  let cur = [];

for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const chars = cur.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length;
      const prevEndsSentence = /[.?!\u0964]["')\]]*$/.test(prev.word);
      if (
        cur.length >= MAX_WORDS_PER_LINE ||
        chars > MAX_CHARS_PER_LINE ||
        gap > PAUSE_BREAK_SECONDS ||
        prevEndsSentence
      ) {
        lines.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * Builds a CapCut-style word-by-word .ass caption file for ONE clip.
 *
 * @param {Array<{word: string, start: number, end: number}>} words
 *        Full word-level timestamps from transcription (in SOURCE video time).
 * @param {number} clipStartTime - clip's start time in the SOURCE video (seconds)
 * @param {number} clipEndTime - clip's end time in the SOURCE video (seconds)
 * @param {string} highlightColorHex - e.g. "#FFD700"
 * @param {string} outputPath - where to write the .ass file
 * @returns {string} outputPath
 */
function buildAssCaptions(words, clipStartTime, clipEndTime, highlightColorHex, outputPath, sourceWidth = VIDEO_WIDTH, sourceHeight = VIDEO_HEIGHT) {
  const highlightTag = `&H${hexToBgrHex(highlightColorHex)}&`;
  const whiteTag = `&HFFFFFF&`;

// Words inside this clip, shifted so the clip's own start is t=0.
  const inClip = (words || []).filter((w) => w.end > clipStartTime && w.start < clipEndTime);
  const clipWords = cleanWords(inClip).map((w) => ({
    word: w.word,
    start: Math.max(0, w.start - clipStartTime),
    end: Math.max(0, w.end - clipStartTime),
  }));

// Pick font: if ANY word is Devanagari, use a font that can render it.
  const hasDevanagari = clipWords.some((w) => containsDevanagari(w.word));
  const fontName = hasDevanagari ? FONT_DEVANAGARI : FONT_LATIN;

const lines = groupIntoLines(clipWords);
  let assContent = buildAssHeader(fontName);

for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Only ONE caption line may be on screen at a time.
    const nextLineStart = li + 1 < lines.length ? lines[li + 1][0].start : Infinity;

for (let i = 0; i < line.length; i++) {
      const active = line[i];
      const start = active.start;
      let end = i < line.length - 1 ? line[i + 1].start : active.end + HOLD_AFTER_LAST_WORD;
      end = Math.min(end, nextLineStart);
      if (end - start < 0.03) continue;

const text = line
        .map((w, idx) => {
          const colorTag = idx === i ? highlightTag : whiteTag;
          // The first word of each line makes the whole line "pop" in (small -> normal)
          const pop = idx === 0 && i === 0 ? "\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)" : "";
          return `{${pop}\\c${colorTag}}${escapeAssText(w.word)}`;
        })
        .join(" ");

assContent += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}\n`;
    }
  }

fs.writeFileSync(outputPath, assContent, "utf8");
  return outputPath;
}

module.exports = {
  buildAssCaptions,
  hexToBgrHex,
  cleanWords,
  groupIntoLines,
  containsDevanagari,
};