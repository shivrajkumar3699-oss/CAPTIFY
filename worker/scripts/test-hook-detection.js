const assert = require("node:assert/strict");
const { createFallbackHooks } = require("../lib/detectHooks");

const story = [
  "What if the secret truth was hidden from everyone?",
  "The biggest mistake was ignoring the warning, but then we discovered the real reason.",
  "Suddenly everything changed, and finally they escaped because nobody expected the result."
];
const words = [];
let time = 0;
for (let repeat = 0; repeat < 12; repeat++) {
  for (const sentence of story) {
    for (const token of sentence.split(/\s+/)) {
      const start = time;
      const duration = 0.24 + Math.min(0.08, token.length * 0.004);
      words.push({ word: token, start, end: start + duration });
      time = start + duration + 0.045;
    }
    time += 0.35;
  }
}
const clips = createFallbackHooks(words, 7, time + 1, {
  visualEvents: [{ time: 8, strength: 0.9 }, { time: 36, strength: 0.7 }],
  audioEvents: [{ time: 14, strength: 0.8 }, { time: 58, strength: 0.6 }]
});
assert.ok(clips.length > 0, "should return at least one hook candidate");
assert.ok(clips.length <= 7, "should never exceed the requested maximum");
for (const clip of clips) {
  assert.ok(Number.isFinite(clip.startTime) && Number.isFinite(clip.endTime), "timestamps should be numeric");
  assert.ok(clip.startTime >= 0, "clip start should be non-negative");
  assert.ok(clip.endTime > clip.startTime, "clip end should follow its start");
  assert.ok(clip.endTime - clip.startTime >= 10, "clip should be at least 10 seconds");
  assert.ok(clip.endTime - clip.startTime <= 90, "clip should not exceed 90 seconds");
  assert.ok(typeof clip.title === "string" && clip.title.length > 0, "clip should have a title");
}
console.log("Hook detector smoke test passed: " + clips.length + " valid clips.");
