# CAPTIFY Windows desktop app

This is a Windows-only Electron shell that launches the existing Node.js/FFmpeg worker on the user's PC. The current website UI is loaded from the configured CAPTIFY URL so the React interface can be shared rather than rewritten.

## Development on Windows

1. Install Node.js 20 LTS or newer.
2. From the repository root, run: cd desktop
3. Run: npm install
4. Run: npm run dev (this also installs the worker's production dependencies).
5. On first launch, enter a Groq API key in the local settings window. Optional Gemini keys can also be saved.

## Build a Windows installer

From the desktop folder on a Windows machine, run:

    npm install
    npm run dist:win

The NSIS installer is created under desktop/dist.

## Local processing model

- Electron starts the existing worker on a random loopback port and creates a fresh per-launch worker secret.
- FFmpeg, caption generation, BGM mixing, and output files run on the user's Windows device.
- Source video analysis (audio extraction, visual sampling, and hook trimming) remains in the shared React app.
- Only extracted analysis audio and selected hook clips are sent to the local worker; the original long video is not uploaded to the CAPTIFY server by this flow.
- Render status is polled locally and clip downloads use a custom local protocol.
- API keys are encrypted with Electron safeStorage and written under the app's user-data directory.

## Important limitations

- AI transcription still requires internet access and a valid Groq API key. Provider quota/pricing is separate from local CPU/RAM/storage costs.
- The first implementation loads the existing CAPTIFY web UI, so the UI needs network access. A later packaging phase can bundle the UI locally without changing the shared React components.
- Run Windows end-to-end tests before distributing an installer.
