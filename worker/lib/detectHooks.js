const { GoogleGenAI } = require("@google/genai");

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing from worker environment.");
}

const ai = new GoogleGenAI({
  apiKey,
});

function extractJson(text) {
  if (typeof text !== "string") {
    throw new Error("Gemini response is not a string.");
  }

  let cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .trim();

  cleaned = cleaned
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const firstArray = cleaned.indexOf("[");
  const firstObject = cleaned.indexOf("{");

  let start = -1;

  if (firstArray === -1) {
    start = firstObject;
  } else if (firstObject === -1) {
    start = firstArray;
  } else {
    start = Math.min(firstArray, firstObject);
  }

  if (start === -1) {
    throw new Error("No JSON array/object found in Gemini response.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[" || char === "{") {
      depth++;
    } else if (char === "]" || char === "}") {
      depth--;

      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1).trim();

        try {
          return JSON.parse(candidate);
        } catch (_) {
          break;
        }
      }
    }
  }

  throw new Error(
    `Gemini did not return valid JSON. Raw response:\n${text}`
  );
}

function getResponseText(response) {
  if (!response) return "";

  if (typeof response.text === "string") {
    return response.text;
  }

  if (typeof response.text === "function") {
    return response.text();
  }

  if (response.response) {
    if (typeof response.response.text === "string") {
      return response.response.text;
    }

    if (typeof response.response.text === "function") {
      return response.response.text();
    }
  }

  const candidates = response.candidates;

  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts;

      if (!Array.isArray(parts)) continue;

      const text = parts
        .map((part) => part?.text)
        .filter((value) => typeof value === "string")
        .join("");

      if (text.trim()) {
        return text;
      }
    }
  }

  return "";
}

function isRetryableError(error) {
  const message = String(
    error?.message || error || ""
  ).toLowerCase();

  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("504") ||
    message.includes("busy") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("temporarily") ||
    message.includes("timeout") ||
    message.includes("deadline") ||
    message.includes("resource exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("high demand")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];

  return words
    .map((word) => ({
      text: String(
        word?.word ??
        word?.text ??
        ""
      ).trim(),

      start: Number(
        word?.start ??
        word?.startTime ??
        0
      ),

      end: Number(
        word?.end ??
        word?.endTime ??
        0
      ),
    }))
    .filter(
      (word) =>
        word.text &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start
    );
}

/*
 * Local fallback hook detector.
 *
 * This is intentionally deterministic and does NOT require Gemini.
 * It creates useful segments from the transcript so the rendering
 * pipeline can continue even when Gemini quota is exhausted or the
 * Gemini model is temporarily unavailable.
 */
function createFallbackHooks(words, numClips, videoDuration) {
  const normalized = normalizeWords(words);

  if (normalized.length === 0) {
    throw new Error(
      "Gemini unavailable and no timestamped words are available for fallback hook detection."
    );
  }

  const requestedCount = Math.max(
    1,
    Number(numClips) || 6
  );

  const duration = Number(videoDuration);

  const totalStart =
    normalized[0].start;

  const totalEnd =
    Number.isFinite(duration) && duration > 0
      ? Math.min(
          duration,
          normalized[normalized.length - 1].end
        )
      : normalized[normalized.length - 1].end;

  const totalDuration = Math.max(
    1,
    totalEnd - totalStart
  );

  const MIN_CLIP_LENGTH = 5;

  /*
   * If the video is too short to fit `requestedCount` distinct clips
   * (each at least MIN_CLIP_LENGTH seconds, non-overlapping), reduce
   * the count instead of producing several IDENTICAL duplicate clips.
   */
  const maxPossibleClips = Math.max(
    1,
    Math.floor(totalDuration / MIN_CLIP_LENGTH)
  );

  const actualCount = Math.min(
    requestedCount,
    maxPossibleClips
  );

  /*
   * Prefer several well-spaced segments instead of repeatedly
   * selecting the beginning of the video.
   */
  const clipLength = Math.min(
    35,
    Math.max(MIN_CLIP_LENGTH, totalDuration / actualCount)
  );

  const gap =
    actualCount > 1
      ? Math.max(
          0,
          (totalDuration - clipLength) / (actualCount - 1)
        )
      : 0;

  const segments = [];

  for (
    let i = 0;
    i < actualCount;
    i++
  ) {
    let start =
      totalStart + i * gap;

    let end =
      start + clipLength;

    if (end > totalEnd) {
      end = totalEnd;
      start = Math.max(
        totalStart,
        end - clipLength
      );
    }

    const firstWord = normalized.find(
      (word) => word.end > start
    );

    let lastWord = null;

    for (
      let j = normalized.length - 1;
      j >= 0;
      j--
    ) {
      if (normalized[j].start < end) {
        lastWord = normalized[j];
        break;
      }
    }

    if (!firstWord || !lastWord) {
      continue;
    }

    const actualStart =
      Math.max(
        totalStart,
        firstWord.start - 0.12
      );

    const actualEnd =
      Math.min(
        totalEnd,
        lastWord.end + 0.35
      );

    if (actualEnd - actualStart < 5) {
      continue;
    }

    const segmentWords = normalized.filter(
      (word) =>
        word.start >= actualStart &&
        word.end <= actualEnd
    );

    const preview = segmentWords
      .slice(0, 10)
      .map((word) => word.text)
      .join(" ");

    segments.push({
      title:
        preview.length > 70
          ? `${preview.slice(0, 67)}...`
          : preview || `Hook ${segments.length + 1}`,

      hookReason:
        "Fallback segment created automatically because Gemini hook detection was temporarily unavailable.",

      startTime: Number(
        actualStart.toFixed(2)
      ),

      endTime: Number(
        actualEnd.toFixed(2)
      ),
    });
  }

  if (segments.length === 0) {
    throw new Error(
      "Unable to create fallback hook segments from transcript timestamps."
    );
  }

  return segments;
}

async function detectHookSegments(
  transcript,
  numClips = 6,
  videoDuration = 0,
  words = []
) {
  if (
    !transcript ||
    typeof transcript !== "string" ||
    !transcript.trim()
  ) {
    throw new Error(
      "Transcript is required for hook detection."
    );
  }

  const prompt = `
You are CAPTIFY's hook detection engine.

Analyze the following transcript and identify the strongest hook
segments that would be useful for short-form video captions.

Return ONLY valid JSON.

The response MUST be a JSON array.

Each item MUST have exactly these fields:
- "title": short descriptive title
- "hookReason": concise explanation of why this segment is a hook
- "startTime": number in seconds
- "endTime": number in seconds

Return approximately ${numClips} strong segments.

Example:
[
  {
    "title": "Ending the Cycle of Child Labor",
    "hookReason": "The segment immediately introduces a strong problem and creates curiosity.",
    "startTime": 8.2,
    "endTime": 39.0
  }
]

IMPORTANT:
- Do NOT use Markdown.
- Do NOT wrap the JSON in triple backticks.
- Do NOT add explanations before or after the JSON.
- Return only the JSON array.
- Start and end times MUST be numbers.
- Each segment should preferably be between 8 and 45 seconds.
- Do not create invalid or negative timestamps.

TRANSCRIPT:
${transcript}
`.trim();

  const models = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ];

  let lastError = null;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];

    try {
      console.log(
        `[Hooks] Trying Gemini model: ${model}`
      );

      const response =
        await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        });

      const rawText =
        getResponseText(response);

      if (
        !rawText ||
        !rawText.trim()
      ) {
        throw new Error(
          `Gemini returned an empty response from ${model}.`
        );
      }

      console.log(
        `[Hooks] Gemini response received from ${model} (${rawText.length} chars)`
      );

      const parsed =
        extractJson(rawText);

      if (!Array.isArray(parsed)) {
        throw new Error(
          `Gemini hook response from ${model} is not a JSON array.`
        );
      }

      const hooks = parsed
        .filter(
          (hook) =>
            hook &&
            typeof hook === "object"
        )
        .map((hook) => ({
          title:
            typeof hook.title === "string"
              ? hook.title.trim()
              : "Untitled Hook",

          hookReason:
            typeof hook.hookReason === "string"
              ? hook.hookReason.trim()
              : "",

          startTime: Number(
            hook.startTime
          ),

          endTime: Number(
            hook.endTime
          ),
        }))
        .filter(
          (hook) =>
            Number.isFinite(
              hook.startTime
            ) &&
            Number.isFinite(
              hook.endTime
            ) &&
            hook.startTime >= 0 &&
            hook.endTime > hook.startTime
        )
        .slice(0, Math.max(1, Number(numClips) || 6));

      if (hooks.length === 0) {
        throw new Error(
          `Gemini returned no valid hook segments from ${model}.`
        );
      }

      console.log(
        `[Hooks] Successfully detected ${hooks.length} hook segment(s) using ${model}`
      );

      return hooks;
    } catch (error) {
      lastError = error;

      console.error(
        `[Hooks] Model ${model} failed:`,
        error?.message || error
      );

      if (index < models.length - 1) {
        if (isRetryableError(error)) {
          console.warn(
            `[Hooks] ${model} unavailable/busy. Falling back to next model...`
          );
        } else {
          console.warn(
            `[Hooks] ${model} returned an unusable response. Falling back to next model...`
          );
        }

        await sleep(500);
      }
    }
  }

  /*
   * IMPORTANT:
   * Gemini failure must NOT crash the entire CAPTIFY pipeline.
   *
   * Use timestamped transcript words as a local fallback.
   */
  console.warn(
    "[Hooks] All Gemini models failed. Using local fallback hook detection."
  );

  try {
    const fallbackHooks =
      createFallbackHooks(
        words,
        numClips,
        videoDuration
      );

    console.log(
      `[Hooks] Local fallback created ${fallbackHooks.length} hook segment(s).`
    );

    return fallbackHooks;
  } catch (fallbackError) {
    throw new Error(
      `Hook detection failed after all Gemini models and local fallback: ${
        fallbackError?.message ||
        lastError?.message ||
        "Unknown error"
      }`
    );
  }
}

module.exports = {
  detectHookSegments,
  extractJson,
  createFallbackHooks,
};