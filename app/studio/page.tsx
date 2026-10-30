"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Mode = "text-to-video" | "image-to-video" | "text-to-image";
type Duration = 10 | 30 | 45 | 60 | 120 | 300 | 600;

const durations: { label: string; value: Duration }[] = [
  { label: "10 sec", value: 10 },
  { label: "30 sec", value: 30 },
  { label: "45 sec", value: 45 },
  { label: "1 min", value: 60 },
  { label: "2 min", value: 120 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
];

const formats = ["MP4", "MKV", "WebM", "MOV"] as const;

export default function StudioPage() {
  const [mode, setMode] = useState<Mode>("text-to-video");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<Duration>(120);
  const [format, setFormat] = useState<(typeof formats)[number]>("MP4");
  const [aspect, setAspect] = useState("9:16");
  const [quality, setQuality] = useState("Best available");
  const [reference, setReference] = useState<File | null>(null);
  const [notice, setNotice] = useState("");

  const modeLabel = useMemo(() => {
    if (mode === "text-to-image") return "Image generation";
    if (mode === "image-to-video") return "Image-to-video generation";
    return "Text-to-video generation";
  }, [mode]);

  function submitRequest() {
    if (!prompt.trim()) {
      setNotice("Please enter a prompt first.");
      return;
    }
    setNotice(
      "Your prompt is ready. Generation is not enabled yet because CAPTIFY has no verified, zero-cost video/image API provider connected. No request or paid API call was made."
    );
  }

  return (
    <main className="min-h-screen bg-[#08090d] px-4 py-8 text-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-sm text-white/50 transition hover:text-white">← Back to CAPTIFY</Link>
            <div className="mt-3 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-xl">✦</div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-300">CAPTIFY</p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI Studio</h1>
              </div>
            </div>
          </div>
          <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-medium text-amber-200">
            Provider integration in progress
          </div>
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            ["✧", "AI Images", "Text-to-image generation"],
            ["▶", "AI Videos", "Text-to-video generation"],
            ["▧", "Image to Video", "Animate a reference image"],
          ].map(([icon, title, description]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 text-xl text-violet-200">{icon}</div>
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-white/45">{description}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <section className="rounded-3xl border border-white/10 bg-[#10121a] p-5 sm:p-7">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Create</p>
              <h2 className="mt-2 text-xl font-semibold">What do you want to make?</h2>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-black/30 p-1">
              {([
                ["text-to-video", "Text → Video"],
                ["image-to-video", "Image → Video"],
                ["text-to-image", "Text → Image"],
              ] as [Mode, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setMode(value); setNotice(""); }}
                  className={`rounded-xl px-2 py-3 text-xs font-medium transition sm:text-sm ${mode === value ? "bg-violet-500 text-white shadow-lg shadow-violet-950/40" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="mb-2 block text-sm font-medium text-white/80">Describe your creation</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the scene, subject, camera movement, lighting and visual style..."
              rows={6}
              maxLength={4000}
              className="w-full resize-y rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/60"
            />
            <div className="mt-2 flex justify-between text-xs text-white/35">
              <span>Be specific about motion, mood and composition.</span>
              <span>{prompt.length}/4000</span>
            </div>

            {mode !== "text-to-image" && (
              <div className="mt-5">
                <label className="mb-2 block text-sm font-medium text-white/80">
                  Reference image <span className="text-white/35">(optional)</span>
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-5 py-6 text-center transition hover:border-violet-300/50">
                  <span className="text-2xl text-violet-200">＋</span>
                  <span className="mt-2 text-sm text-white/75">{reference ? reference.name : "Choose a PNG, JPG or WebP image"}</span>
                  <span className="mt-1 text-xs text-white/35">Reference upload UI is ready; provider upload is not connected yet.</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => setReference(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            )}

            {mode !== "text-to-image" && (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-sm font-medium text-white/80">Video duration</label>
                  <span className="rounded-lg bg-violet-400/10 px-3 py-1 text-sm font-semibold text-violet-200">{durations.find((item) => item.value === duration)?.label}</span>
                </div>
                <input
                  aria-label="Video duration"
                  type="range"
                  min={0}
                  max={durations.length - 1}
                  step={1}
                  value={durations.findIndex((item) => item.value === duration)}
                  onChange={(event) => setDuration(durations[Number(event.target.value)].value)}
                  className="w-full accent-violet-400"
                />
                <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-white/40 sm:text-xs">
                  {durations.map((item) => <span key={item.value}>{item.label}</span>)}
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-medium text-white/55">Aspect ratio</label>
                <select value={aspect} onChange={(event) => setAspect(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#090a10] px-3 py-3 text-sm outline-none focus:border-violet-400/60">
                  <option>9:16</option><option>16:9</option><option>1:1</option><option>4:5</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-white/55">Quality</label>
                <select value={quality} onChange={(event) => setQuality(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#090a10] px-3 py-3 text-sm outline-none focus:border-violet-400/60">
                  <option>Best available</option><option>Balanced</option><option>Fast preview</option>
                </select>
              </div>
              {mode !== "text-to-image" && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-white/55">Export format</label>
                  <select value={format} onChange={(event) => setFormat(event.target.value as (typeof formats)[number])} className="w-full rounded-xl border border-white/10 bg-[#090a10] px-3 py-3 text-sm outline-none focus:border-violet-400/60">
                    {formats.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              )}
            </div>

            <button type="button" onClick={submitRequest} className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-500 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:brightness-110">
              <span>✦</span> Prepare {mode === "text-to-image" ? "image" : "video"} generation
            </button>
            {notice && <p role="status" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm leading-6 text-amber-100/85">{notice}</p>}
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-white/10 bg-[#10121a] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Generation status</p>
              <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-100"><span className="h-2 w-2 rounded-full bg-amber-300" /> Waiting for verified free providers</div>
                <p className="mt-2 text-xs leading-5 text-white/45">No paid provider is called. The app will fail closed rather than silently spend money when integrations are added.</p>
              </div>
              <div className="mt-5 space-y-3">
                {["Free quota tracking", "Automatic fallback chain", "Daily quota reset handling", "Provider health checks"].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm text-white/55"><span className="h-1.5 w-1.5 rounded-full bg-white/25" />{item}<span className="ml-auto text-[10px] uppercase tracking-wider text-amber-200/60">Pending</span></div>
                ))}
              </div>
            </section>
            <section className="rounded-3xl border border-white/10 bg-[#10121a] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Built-in editor</p>
              <h3 className="mt-2 text-lg font-semibold">Simple timeline editing</h3>
              <p className="mt-2 text-sm leading-6 text-white/45">The planned editor keeps the essentials together: split, delete, transitions, transition speed and one-click export.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {["Split clips", "Delete clips", "Fade / slide / blur", "Transition speed", "MP4 / MKV / WebM", "Full video export"].map((item) => (
                  <div key={item} className="rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-xs text-white/65">{item}</div>
                ))}
              </div>
              <p className="mt-4 text-xs text-white/35">Editor controls will be connected to the rendering timeline after the generation pipeline is in place.</p>
            </section>
            <section className="rounded-3xl border border-white/10 bg-[#10121a] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Current request</p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between text-white/45"><span>Mode</span><span className="text-white/80">{modeLabel}</span></div>
                <div className="flex justify-between text-white/45"><span>Duration</span><span className="text-white/80">{mode === "text-to-image" ? "Not applicable" : durations.find((item) => item.value === duration)?.label}</span></div>
                <div className="flex justify-between text-white/45"><span>Aspect</span><span className="text-white/80">{aspect}</span></div>
                <div className="flex justify-between text-white/45"><span>Quality</span><span className="text-white/80">{quality}</span></div>
                <div className="flex justify-between text-white/45"><span>Format</span><span className="text-white/80">{mode === "text-to-image" ? "PNG/JPEG (pending)" : format}</span></div>
              </div>
            </section>
          </aside>
        </div>
        <footer className="mt-8 text-center text-xs text-white/25">CAPTIFY AI Studio · Zero-cost-only integration policy · No automatic paid fallback</footer>
      </div>
    </main>
  );
}
