const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "linux") {
  process.exit(0);
}

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
const FONT_FILES = [
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansDevanagari-Bold.ttf",
];
const BASE_URL =
  "https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/";

async function main() {
  fs.mkdirSync(FONT_DIR, { recursive: true });

  for (const filename of FONT_FILES) {
    const destination = path.join(FONT_DIR, filename);
    if (fs.existsSync(destination) && fs.statSync(destination).size > 100_000) {
      continue;
    }

    console.log("[fonts] Downloading bundled caption font:", filename);
    const response = await fetch(BASE_URL + filename, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error("Font download failed for " + filename + " (HTTP " + response.status + ")");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100_000) {
      throw new Error("Downloaded font file is unexpectedly small: " + filename);
    }

    fs.writeFileSync(destination, bytes);
  }

  console.log("[fonts] Bundled Noto Sans Devanagari fonts are ready.");
}

main().catch((error) => {
  console.error("[fonts] Required caption fonts could not be prepared:", error.message);
  process.exit(1);
});
