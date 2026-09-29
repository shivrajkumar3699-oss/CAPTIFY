"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type HistoryClip = {
  id: number;
  clipIndex: number;
  startTime: number;
  endTime: number;
};

type HistoryProject = {
  id: number;
  originalFilename: string | null;
  numClips: number;
  createdAt: string;
  clips: HistoryClip[];
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export default function HistoryPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [projects, setProjects] = useState<HistoryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      if (isLoaded) setLoading(false);
      return;
    }

    fetch("/api/history", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Failed to load history.");
        setProjects(Array.isArray(data?.projects) ? data.projects : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load history."))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return <main className="min-h-screen bg-[#030303]" />;

  if (!isSignedIn) {
    return (
      <main className="min-h-screen bg-[#030303] px-5 py-24 text-white">
        <section className="mx-auto max-w-2xl rounded-[36px] border border-white/[0.08] bg-white/[0.035] p-10 text-center backdrop-blur-3xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-[#F7D002]/[0.08] text-2xl font-black text-[#F7D002]">C</div>
          <p className="mt-7 text-[10px] font-black uppercase tracking-[0.3em] text-[#F7D002]">CAPTIFYY HISTORY</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight">Your history lives here.</h1>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-white/40">Sign in to see your saved project dates, titles, clip counts and timestamps.</p>
          <SignInButton mode="modal">
            <button className="mt-8 rounded-full bg-[#F7D002] px-6 py-3 text-xs font-black uppercase tracking-wider text-black">Log in</button>
          </SignInButton>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#030303] px-5 pb-20 pt-24 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-xs font-bold text-white/45 hover:text-white">← Studio</Link>
        <p className="mt-8 text-[10px] font-black uppercase tracking-[0.32em] text-[#F7D002]">CAPTIFYY / HISTORY</p>
        <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <h1 className="text-5xl font-black tracking-[-0.05em] sm:text-7xl">Your history.</h1>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-white/30">Projects</div>
            <div className="text-2xl font-black text-[#F7D002]">{projects.length}</div>
          </div>
        </div>

        {loading && <div className="mt-12 rounded-[30px] border border-white/[0.06] bg-white/[0.025] p-8 text-white/30">Loading history…</div>}
        {!loading && error && <div className="mt-12 rounded-[30px] border border-red-400/20 bg-red-400/[0.04] p-8 text-red-300">{error}</div>}
        {!loading && !error && projects.length === 0 && (
          <section className="mt-12 rounded-[32px] border border-white/[0.08] bg-white/[0.025] p-12 text-center">
            <h2 className="text-2xl font-black">No projects yet.</h2>
            <p className="mt-3 text-sm text-white/35">Create a CAPTIFYY project and it will appear here.</p>
          </section>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="mt-10 grid gap-5">
            {projects.map((project) => (
              <section key={project.id} className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-2xl sm:p-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#F7D002]">{formatDate(project.createdAt)}</p>
                    <h2 className="mt-2 truncate text-xl font-black">{project.originalFilename || "CAPTIFYY Project"}</h2>
                  </div>
                  <div className="shrink-0 rounded-full border border-[#F7D002]/15 bg-[#F7D002]/[0.06] px-4 py-2 text-xs font-black text-[#F7D002]">{project.numClips} clips</div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {project.clips.map((clip) => (
                    <div key={clip.id} className="rounded-[22px] border border-white/[0.07] bg-black/25 p-4">
                      <div className="text-[9px] font-black uppercase tracking-widest text-white/30">Clip {clip.clipIndex}</div>
                      <div className="mt-3 text-lg font-black text-white">
                        {formatTime(clip.startTime)} <span className="text-[#F7D002]">→</span> {formatTime(clip.endTime)}
                      </div>
                      <div className="mt-2 text-[10px] uppercase tracking-wider text-white/25">Timestamp</div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
