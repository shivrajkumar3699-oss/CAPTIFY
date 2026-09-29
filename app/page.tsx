"use client";

import { useRef, useState } from "react";

type ClipResult = {
  index: number;
  title: string;
  hookReason: string;
  startTime: number;
  endTime: number;
  rawUrl: string;
  editedUrl: string;
};

type JobStatus = {
  jobId: string;
  status: "queued" | "transcribing" | "detecting_hooks" | "rendering" | "done" | "error";
  progress: number;
  message?: string;
  clips?: ClipResult[];
  error?: string;
};

const CAPTION_COLORS = [
  { name: "Yellow (CapCut classic)", value: "#FFE600" },
  { name: "White", value: "#FFFFFF" },
  { name: "Green", value: "#39FF14" },
  { name: "Pink", value: "#FF3EA5" },
  { name: "Cyan", value: "#00E5FF" },
];

const VIDEO_LANGUAGES = [
  { name: "Auto detect", value: "auto" },
  { name: "English", value: "en" },
  { name: "Hindi", value: "hi" },
  { name: "Hinglish (Roman)", value: "hinglish" },
];

const CAPTION_LANGUAGES = [
  { name: "Same as video", value: "same" },
  { name: "English", value: "en" },
  { name: "Hindi (Devanagari)", value: "hi" },
  { name: "Hinglish (Roman)", value: "hinglish" },
];

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

// 94.3 -> "1:34"   (3725 -> "1:02:05")
function formatTime(totalSeconds: number, roundUp: boolean): string {
  const whole = roundUp ? Math.ceil(totalSeconds) : Math.floor(totalSeconds);
  const s = Math.max(0, whole);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ":" + pad2(m) + ":" + pad2(sec);
  return m + ":" + pad2(sec);
}

function timeRange(clip: ClipResult): string {
  return formatTime(clip.startTime, false) + " - " + formatTime(clip.endTime, true);
}

function clipLength(clip: ClipResult): string {
  return Math.round(clip.endTime - clip.startTime) + " sec";
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bgm, setBgm] = useState(true);
  const [captionColor, setCaptionColor] = useState(CAPTION_COLORS[0].value);
  const [numClips, setNumClips] = useState(6);
  const [videoLanguage, setVideoLanguage] = useState("auto");
  const [captionLanguage, setCaptionLanguage] = useState("same");
  const [framing, setFraming] = useState("fit");

const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [copied, setCopied] = useState(false);

async function handleStart() {
    if (!file) return;
    setUploading(true);

const createRes = await fetch("/api/create-job", { method: "POST" });
    const { jobId } = await createRes.json();

const ext = file.name.split(".").pop() || "mp4";

await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", "/api/upload?jobId=" + jobId + "&ext=" + ext);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = function () {
        if (xhr.status < 300) {
          resolve();
        } else {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = function () {
        reject(new Error("Upload failed"));
      };
      xhr.send(file);
    });

setUploading(false);

await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: jobId,
        ext: ext,
        options: {
          bgm: bgm,
          captionColor: captionColor,
          numClips: numClips,
          audioLanguage: videoLanguage,
          captionLanguage: captionLanguage,
          framing: framing,
        },
      }),
    });

setJob({ jobId: jobId, status: "queued", progress: 0 });
    pollStatus(jobId);
  }

function pollStatus(jobId: string) {
    const interval = setInterval(async () => {
      const res = await fetch("/api/status/" + jobId);
      if (!res.ok) return;
      const data: JobStatus = await res.json();
      setJob(data);
      if (data.status === "done" || data.status === "error") {
        clearInterval(interval);
      }
    }, 4000);
  }

async function copyTimestamps() {
    if (!job || !job.clips) return;
    const text = job.clips
      .map(function (c) {
        return "Clip " + (c.index + 1) + ": " + timeRange(c) + " - " + c.title;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(function () {
        setCopied(false);
      }, 2000);
    } catch (e) {
      setCopied(false);
    }
  }

function startOver() {
    setJob(null);
    setFile(null);
    setUploadProgress(0);
    setCopied(false);
  }

return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-4xl font-bold mb-2">Captify</h1>
      <p className="text-gray-400 mb-10">
        Upload a long video or podcast (up to 3GB). Get up to 7 hook-driven, auto-captioned vertical reels, ready to post.
      </p>

{!job && (
        <div className="space-y-6 bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
              className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-white file:text-black file:font-medium"
            />
            {file && (
              <p className="text-sm text-gray-500 mt-2">
                {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
              </p>
            )}
          </div>

<div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-2">Video language</label>
              <select
                value={videoLanguage}
                onChange={(e) => setVideoLanguage(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                {VIDEO_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">Caption language</label>
              <select
                value={captionLanguage}
                onChange={(e) => setCaptionLanguage(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
              >
                {CAPTION_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

<div>
            <label className="text-sm font-medium block mb-2">Framing</label>
            <div className="flex gap-2">
              <button
                onClick={() => setFraming("fit")}
                className={
                  "flex-1 text-sm px-4 py-2 rounded-lg border " +
                  (framing === "fit"
                    ? "bg-white text-black border-white font-medium"
                    : "bg-zinc-800 text-gray-300 border-zinc-700")
                }
              >
                Fit (blurred background)
              </button>
              <button
                onClick={() => setFraming("fill")}
                className={
                  "flex-1 text-sm px-4 py-2 rounded-lg border " +
                  (framing === "fill"
                    ? "bg-white text-black border-white font-medium"
                    : "bg-zinc-800 text-gray-300 border-zinc-700")
                }
              >
                Fill (full screen crop)
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Fit: poora video dikhega, background me blurred copy. Fill: side crop ho ke full screen.
            </p>
          </div>

<div className="flex items-center justify-between">
            <label className="text-sm font-medium">Background music</label>
            <button
              onClick={() => setBgm(!bgm)}
              className={"w-12 h-6 rounded-full transition " + (bgm ? "bg-green-500" : "bg-zinc-700")}
            >
              <span
                className={"block w-5 h-5 bg-white rounded-full transition transform " + (bgm ? "translate-x-6" : "translate-x-1")}
              />
            </button>
          </div>

<div>
            <label className="text-sm font-medium block mb-2">Caption color</label>
            <div className="flex gap-2">
              {CAPTION_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCaptionColor(c.value)}
                  title={c.name}
                  className={"w-8 h-8 rounded-full border-2 " + (captionColor === c.value ? "border-white" : "border-transparent")}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

<div>
            <label className="text-sm font-medium block mb-2">Number of clips: {numClips}</label>
            <input
              type="range"
              min={1}
              max={7}
              value={numClips}
              onChange={(e) => setNumClips(Number(e.target.value))}
              className="w-full"
            />
          </div>

<button
            disabled={!file || uploading}
            onClick={handleStart}
            className="w-full bg-white text-black font-semibold py-3 rounded-xl disabled:opacity-40"
          >
            {uploading ? "Uploading... " + uploadProgress + "%" : "Generate Reels"}
          </button>
        </div>
      )}

{job && job.status !== "done" && job.status !== "error" && (
        <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800 space-y-3">
          <p className="font-medium capitalize">{job.status.replace("_", " ")}...</p>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div
              className="bg-white h-2 rounded-full transition-all"
              style={{ width: job.progress + "%" }}
            />
          </div>
          {job.message && <p className="text-sm text-gray-500">{job.message}</p>}
        </div>
      )}

{job && job.status === "error" && (
        <div className="bg-red-950 border border-red-800 rounded-2xl p-6 space-y-4">
          <p className="text-red-400">Something went wrong: {job.error}</p>
          <button
            onClick={startOver}
            className="bg-white text-black text-sm font-medium px-4 py-2 rounded-lg"
          >
            Try again
          </button>
        </div>
      )}

{job && job.status === "done" && job.clips && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Your reels are ready</h2>
            <button
              onClick={copyTimestamps}
              className="bg-zinc-800 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              {copied ? "Copied!" : "Copy all timestamps"}
            </button>
          </div>
          <p className="text-sm text-gray-500">
            Each timestamp shows where that clip was taken from in your original video.
          </p>

{job.clips.map((clip) => (
            <div key={clip.index} className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 flex gap-4">
              <video
                src={clip.editedUrl}
                controls
                playsInline
                preload="metadata"
                className="w-32 sm:w-40 rounded-xl bg-black shrink-0"
                style={{ aspectRatio: "9 / 16" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-1">Clip {clip.index + 1}</p>
                <p className="font-medium">{clip.title}</p>
                <p className="text-sm text-green-400 mt-1">
                  Timestamp: {timeRange(clip)} <span className="text-gray-500">({clipLength(clip)})</span>
                </p>
                <p className="text-sm text-gray-500 mt-2 mb-3">{clip.hookReason}</p>
                <div className="flex gap-3 flex-wrap">
                  <a href={clip.editedUrl} className="bg-white text-black text-sm font-medium px-4 py-2 rounded-lg">
                    Download Edited
                  </a>
                  <a href={clip.rawUrl} className="bg-zinc-800 text-white text-sm font-medium px-4 py-2 rounded-lg">
                    Download Raw
                  </a>
                </div>
              </div>
            </div>
          ))}

<button
            onClick={startOver}
            className="w-full bg-zinc-800 text-white font-medium py-3 rounded-xl"
          >
            Create more reels
          </button>
        </div>
      )}
    </main>
  );
}
