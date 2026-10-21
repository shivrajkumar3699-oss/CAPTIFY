const { spawnSync } = require("node:child_process");

if (process.platform !== "linux") {
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

try {
  // Render's Linux worker must have actual Devanagari TTF/OTF fonts installed.
  // Windows-only font names silently render Hindi as empty tofu rectangles.
  run("sh", [
    "-lc",
    "if command -v fc-match >/dev/null 2>&1 && fc-match 'Noto Sans Devanagari' | grep -qi 'Noto Sans Devanagari'; then exit 0; else apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-noto-core && fc-cache -f; fi",
  ]);
} catch (error) {
  console.error("[fonts] Could not install Noto Sans Devanagari fonts:", error.message);
  process.exit(1);
}
