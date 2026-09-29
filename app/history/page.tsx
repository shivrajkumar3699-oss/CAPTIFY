"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type HistoryClip = {
  id: number;
  clipIndex: number;
  title: string;
  hookReason: string | null;
  startTime: number;
  endTime: number;
  rawUrl: string | null;
  editedUrl: string | null;
};

type HistoryProject = {
  id: number;
  jobId: string;
  originalFilename: string | null;
  videoLanguage: string | null;
  captionLanguage: string | null;
  captionColor: string | null;
  numClips: number;
  bgmEnabled: boolean;
  framing: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  clips: HistoryClip[];
};

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remaining
  ).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Queued";
    case "transcribing":
      return "Transcribing";
    case "detecting_hooks":
      return "Finding hooks";
    case "rendering":
      return "Rendering";
    case "done":
      return "Completed";
    case "error":
      return "Failed";
    default:
      return status;
  }
}

export default function HistoryPage() {
  const { isLoaded, isSignedIn } = useUser();

  const [projects, setProjects] = useState<HistoryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      if (isLoaded) {
        setLoading(false);
      }

      return;
    }

    let cancelled = false;

    async function loadHistory() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/history", {
          method: "GET",
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error || "Failed to load history."
          );
        }

        if (!cancelled) {
          setProjects(
            Array.isArray(data?.projects)
              ? data.projects
              : []
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load history."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-[#030303] px-5 py-24 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="h-10 w-48 animate-pulse rounded-full bg-white/[0.06]" />
          <div className="mt-6 h-5 w-80 animate-pulse rounded-full bg-white/[0.04]" />
        </div>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[#030303] text-white">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div
            className="absolute left-[-180px] top-[-180px] h-[560px] w-[560px] rounded-full blur-[150px]"
            style={{
              background:
                "radial-gradient(circle, rgba(247,208,2,.13), transparent 68%)",
            }}
          />

          <div
            className="absolute right-[-180px] top-[20%] h-[560px] w-[560px] rounded-full blur-[160px]"
            style={{
              background:
                "radial-gradient(circle, rgba(240,6,153,.09), transparent 68%)",
            }}
          />
        </div>

        <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-5 py-24">
          <section className="w-full rounded-[38px] border border-white/[0.09] bg-white/[0.035] p-8 text-center shadow-[0_35px_120px_rgba(0,0,0,.45)] backdrop-blur-3xl sm:p-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-[#F7D002]/20 bg-[#F7D002]/[0.08] text-2xl font-black text-[#F7D002]">
              C
            </div>

            <p className="mt-7 text-[10px] font-black uppercase tracking-[0.3em] text-[#F7D002]">
              CAPTIFY HISTORY
            </p>

            <h1 className="mt-4 text-4xl font-black tracking-[-0.04em] sm:text-5xl">
              Your projects live here.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-white/40 sm:text-base">
              Sign in to view your previous CAPTIFY projects and
              access your generated clips again.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <SignInButton mode="modal">
                <button className="rounded-full bg-[#F7D002] px-6 py-3 text-xs font-black uppercase tracking-[0.1em] text-black transition hover:brightness-110">
                  Log in with Google
                </button>
              </SignInButton>

              <Link
                href="/"
                className="rounded-full border border-white/[0.09] bg-white/[0.04] px-6 py-3 text-xs font-bold uppercase tracking-[0.1em] text-white/55 transition hover:bg-white/[0.07] hover:text-white"
              >
                Back to Studio
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#030303] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-[-180px] top-[-180px] h-[560px] w-[560px] rounded-full blur-[150px]"
          style={{
            background:
              "radial-gradient(circle, rgba(247,208,2,.11), transparent 68%)",
          }}
        />

        <div
          className="absolute right-[-180px] top-[20%] h-[560px] w-[560px] rounded-full blur-[160px]"
          style={{
            background:
              "radial-gradient(circle, rgba(240,6,153,.08), transparent 68%)",
          }}
        />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,.25)_55%,rgba(0,0,0,.82)_100%)]" />
      </div>

      <div className="mx-auto max-w-7xl px-5 pb-20 pt-24 sm:px-8">
        <div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/45 backdrop-blur-xl transition hover:border-[#F7D002]/20 hover:text-white"
            >
              ← Studio
            </Link>

            <p className="mt-8 text-[10px] font-black uppercase tracking-[0.32em] text-[#F7D002]">
              CAPTIFY / HISTORY
            </p>

            <h1 className="mt-3 text-5xl font-black tracking-[-0.055em] sm:text-7xl">
              Your projects.
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/35 sm:text-base">
              Every project created from this account appears
              here, along with its generated clips.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.035] px-5 py-4 backdrop-blur-2xl">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">
              Projects
            </div>
            <div className="mt-1 text-2xl font-black text-[#F7D002]">
              {projects.length}
            </div>
          </div>
        </div>

        {loading && (
          <div className="mt-12 grid gap-5">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-48 animate-pulse rounded-[32px] border border-white/[0.06] bg-white/[0.025]"
              />
            ))}
          </div>
        )}

        {!loading && error && (
          <section className="mt-12 rounded-[32px] border border-red-400/15 bg-red-400/[0.04] p-7">
            <p className="text-sm font-bold text-red-300">
              {error}
            </p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full border border-white/[0.1] bg-white/[0.05] px-5 py-2.5 text-xs font-bold text-white/65 transition hover:text-white"
            >
              Try again
            </button>
          </section>
        )}

        {!loading && !error && projects.length === 0 && (
          <section className="mt-12 rounded-[36px] border border-white/[0.08] bg-white/[0.025] p-10 text-center backdrop-blur-2xl sm:p-16">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-[#F7D002]/15 bg-[#F7D002]/[0.06] text-2xl font-black text-[#F7D002]">
              +
            </div>

            <h2 className="mt-7 text-3xl font-black tracking-tight">
              No projects yet.
            </h2>

            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-white/35">
              Create your first CAPTIFY project and it will
              automatically appear here.
            </p>

            <Link
              href="/"
              className="mt-7 inline-flex rounded-full bg-[#F7D002] px-6 py-3 text-xs font-black uppercase tracking-[0.1em] text-black transition hover:brightness-110"
            >
              Create a project
            </Link>
          </section>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="mt-12 grid gap-6">
            {projects.map((project) => (
              <section
                key={project.id}
                className="overflow-hidden rounded-[34px] border border-white/[0.08] bg-white/[0.035] shadow-[0_30px_100px_rgba(0,0,0,.25)] backdrop-blur-2xl"
              >
                <div className="border-b border-white/[0.07] p-6 sm:p-7">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[#F7D002]/15 bg-[#F7D002]/[0.06] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-[#F7D002]">
                          {statusLabel(project.status)}
                        </span>

                        <span className="text-[10px] text-white/20">
                          {formatDate(project.createdAt)}
                        </span>
                      </div>

                      <h2 className="mt-4 truncate text-xl font-black sm:text-2xl">
                        {project.originalFilename ||
                          "CAPTIFY Project"}
                      </h2>

                      <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">
                        <span className="rounded-full border border-white/[0.07] bg-black/20 px-3 py-1.5">
                          {project.numClips} clips
                        </span>

                        <span className="rounded-full border border-white/[0.07] bg-black/20 px-3 py-1.5">
                          {project.captionLanguage ||
                            "Same language"}
                        </span>

                        {project.framing && (
                          <span className="rounded-full border border-white/[0.07] bg-black/20 px-3 py-1.5">
                            {project.framing}
                          </span>
                        )}

                        <span className="rounded-full border border-white/[0.07] bg-black/20 px-3 py-1.5">
                          BGM{" "}
                          {project.bgmEnabled
                            ? "ON"
                            : "OFF"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {project.clips.length > 0 ? (
                  <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-2">
                    {project.clips.map((clip) => (
                      <article
                        key={clip.id}
                        className="rounded-[25px] border border-white/[0.07] bg-black/25 p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#F7D002]/80">
                              Clip {clip.clipIndex}
                            </div>

                            <h3 className="mt-2 truncate text-base font-bold">
                              {clip.title}
                            </h3>
                          </div>

                          <div className="shrink-0 rounded-full border border-white/[0.07] px-2.5 py-1 text-[9px] font-bold text-white/30">
                            {formatTime(
                              clip.startTime
                            )}{" "}
                            →{" "}
                            {formatTime(
                              clip.endTime
                            )}
                          </div>
                        </div>

                        {clip.hookReason && (
                          <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/30">
                            {clip.hookReason}
                          </p>
                        )}

                        <div className="mt-5 flex flex-wrap gap-2">
                          {clip.editedUrl ? (
                            <a
                              href={clip.editedUrl}
                              download
                              className="rounded-full bg-[#F7D002] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-black transition hover:brightness-110"
                            >
                              Download edited
                            </a>
                          ) : (
                            <span className="rounded-full border border-white/[0.07] px-4 py-2.5 text-[10px] font-bold text-white/20">
                              Edited file unavailable
                            </span>
                          )}

                          {clip.rawUrl && (
                            <a
                              href={clip.rawUrl}
                              download
                              className="rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/50 transition hover:bg-white/[0.07] hover:text-white"
                            >
                              Raw clip
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="p-7 text-sm text-white/25">
                    This project has no generated clips yet.
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}