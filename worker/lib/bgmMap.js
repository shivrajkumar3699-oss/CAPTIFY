// worker/lib/bgmMap.js
const fs = require("fs");
const path = require("path");

// Maps each numbered mp3 to mood/keyword tags, based on what you described.
const BGM_CATEGORIES = [
  { file: "1.mp3", tags: ["regular", "informative", "general", "indian", "decent", "news", "update", "fact"] },
  { file: "2.mp3", tags: ["funny", "comedy", "prank", "joke", "hilarious", "troll", "meme"] },
  { file: "3.mp3", tags: ["cinematic", "explain", "complex", "technical", "deep", "analysis", "science", "serious"] },
  { file: "4.mp3", tags: ["lovely", "silent", "calm", "easy", "simple", "gentle", "tutorial", "romantic", "soft"] },
  { file: "5.mp3", tags: ["childhood", "child", "kids", "art", "craft", "cute", "cartoon", "playful"] },
  { file: "6.mp3", tags: ["story", "storytelling", "narrative", "calming", "bass", "journey", "life", "reflect"] },
  { file: "7.mp3", tags: ["excitement", "excited", "dance", "energetic", "fun", "hype", "celebration", "win", "achievement"] },
  { file: "8.mp3", tags: ["danger", "hiding", "hide", "seek", "scary", "risky", "chase", "escape", "warning"] },
  { file: "9.mp3", tags: ["suspense", "mystery", "tension", "thriller", "twist", "shocking", "reveal", "secret"] },
  { file: "10.mp3", tags: ["intro", "outro", "start", "end", "hook", "opening", "closing", "great", "epic", "conclusion"] },
];

function scoreCategory(text, tags) {
  let score = 0;
  for (const tag of tags) {
    if (text.includes(tag)) score += 1;
  }
  return score;
}

/**
 * Picks the best-matching BGM file for a clip based on its title/hookReason
 * text, avoiding repeats within the same job until options run out.
 *
 * @param {string} title
 * @param {string} hookReason
 * @param {Set<string>} usedFiles - filenames already used in THIS job (mutated in place)
 * @param {string} bgmDir - absolute path to worker/assets/bgm
 * @returns {string|null} absolute path to chosen mp3, or null if folder is empty
 */
function chooseBgmForSegment(title, hookReason, usedFiles, bgmDir) {
  let availableFiles;
  try {
    availableFiles = fs.readdirSync(bgmDir).filter((f) => f.toLowerCase().endsWith(".mp3"));
  } catch (e) {
    return null;
  }
  if (availableFiles.length === 0) return null;

  const text = `${title || ""} ${hookReason || ""}`.toLowerCase();

  const scored = BGM_CATEGORIES
    .filter((cat) => availableFiles.includes(cat.file))
    .map((cat) => ({ file: cat.file, score: scoreCategory(text, cat.tags) }))
    .sort((a, b) => b.score - a.score);

  const topScore = scored.length > 0 ? scored[0].score : 0;

  // If a mood clearly matched, only consider files tied for the top score.
  // If nothing matched (score 0 everywhere), any file is fair game.
  let candidates = topScore > 0
    ? scored.filter((s) => s.score === topScore).map((s) => s.file)
    : availableFiles;

  // Prefer files not yet used in this job.
  let unused = candidates.filter((f) => !usedFiles.has(f));

  if (unused.length === 0) {
    // Matching category exhausted -> widen to any unused file at all.
    unused = availableFiles.filter((f) => !usedFiles.has(f));
  }

  if (unused.length === 0) {
    // Every file used at least once already -> reset tracking, allow reuse.
    usedFiles.clear();
    unused = candidates.length > 0 ? candidates : availableFiles;
  }

  const pick = unused[Math.floor(Math.random() * unused.length)];
  usedFiles.add(pick);
  return path.join(bgmDir, pick);
}

module.exports = { chooseBgmForSegment, BGM_CATEGORIES };