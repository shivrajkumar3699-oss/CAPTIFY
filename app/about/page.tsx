"use client";

import { useEffect } from "react";
import Link from "next/link";

function Icon({
  name,
  size = 20,
}: {
  name: "spark" | "captions" | "bolt" | "arrow";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "spark") {
    return (
      <svg {...common}>
        <path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" />
        <path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />
      </svg>
    );
  }

  if (name === "captions") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M7 10h4M7 14h3M14 10h3M14 14h3" />
      </svg>
    );
  }

  if (name === "bolt") {
    return (
      <svg {...common}>
        <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M5 12h13" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export default function AboutPage() {
  useEffect(() => {
    document.title = "About — CAPTIFY";
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#030303] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
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

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,.28)_55%,rgba(0,0,0,.8)_100%)]" />
      </div>

      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 lg:px-7">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between rounded-[30px] border border-white/[0.09] bg-black/60 px-4 py-3 shadow-[0_25px_90px_rgba(0,0,0,.45)] backdrop-blur-3xl sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[15px] border border-[#F7D002]/30 bg-[#F7D002]/[0.08] text-base font-black text-[#F7D002]">
              C
            </div>

            <div>
              <div className="text-sm font-black uppercase tracking-[0.24em]">
                CAPTIFY
              </div>

              <div className="hidden text-[8px] font-semibold uppercase tracking-[0.28em] text-white/30 sm:block">
                AI Caption Studio
              </div>
            </div>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              Studio
            </Link>

            <Link
              href="/support"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              Support
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
        <section className="relative mb-20 overflow-hidden rounded-[42px] border border-white/[0.08] bg-white/[0.025] px-5 py-14 text-center shadow-[0_35px_120px_rgba(0,0,0,.35)] backdrop-blur-2xl sm:px-10 sm:py-20">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[330px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
            style={{
              background:
                "radial-gradient(ellipse, rgba(247,208,2,.13) 0%, rgba(255,122,0,.08) 30%, rgba(240,6,153,.09) 62%, transparent 78%)",
            }}
          />

          <div className="relative flex items-center justify-center gap-4 text-2xl sm:text-3xl">
            <span className="drop-shadow-[0_0_18px_rgba(247,208,2,.45)]">
              👑
            </span>

            <span className="text-xl opacity-70">⚡</span>

            <span className="drop-shadow-[0_0_18px_rgba(240,6,153,.45)]">
              😎
            </span>
          </div>

          <p className="relative mt-7 text-[9px] font-black uppercase tracking-[0.42em] text-white/30 sm:text-[10px]">
            Created & crafted by
          </p>

          <h1
            className="relative mt-5 text-5xl font-black tracking-[-0.065em] sm:text-7xl lg:text-8xl xl:text-9xl"
            style={{
              background:
                "linear-gradient(100deg, #F7D002 0%, #F7D002 20%, #FF7A00 40%, #F00699 70%, #FF3FA4 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            SHIVRAJ KUMAR
          </h1>

          <div className="relative mx-auto mt-7 h-px w-24 bg-gradient-to-r from-transparent via-[#F7D002]/60 to-transparent" />

          <div className="relative mt-6 flex items-center justify-center gap-3 text-sm font-bold text-white/30">
            <span>👑</span>
            <span className="uppercase tracking-[0.28em]">
              Founder · Creator · CAPTIFY
            </span>
            <span>🦸‍♂️</span>
          </div>

          <p className="relative mx-auto mt-5 max-w-xl text-xs leading-6 text-white/25 sm:text-sm">
            Building tools that turn ideas into something people can actually
            use.
          </p>
        </section>

        <section className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F7D002]/15 bg-[#F7D002]/[0.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">
            <Icon name="spark" size={13} />
            About CAPTIFY
          </div>

          <h2 className="mt-7 text-5xl font-black tracking-[-0.04em] sm:text-7xl">
            Turn long-form speech into{" "}
            <span className="text-[#F7D002]">short-form moments.</span>
          </h2>

          <p className="mt-7 max-w-2xl text-base leading-7 text-white/40 sm:text-lg">
            CAPTIFY is an AI-powered caption and clip studio built to remove
            the repetitive editing work between an uploaded video and polished,
            ready-to-use clips.
          </p>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            [
              "spark",
              "AI-first",
              "Speech is analyzed with timestamps so the workflow can identify useful moments instead of making you cut everything manually.",
            ],
            [
              "captions",
              "Captions built in",
              "Choose the caption language and styling preferences before processing. The selected captions are rendered into the output.",
            ],
            [
              "bolt",
              "Simple workflow",
              "Upload your media, choose your preferences, start processing and download the finished clips.",
            ],
          ].map(([icon, title, text]) => (
            <div
              key={title}
              className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-2xl"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F7D002]/15 bg-[#F7D002]/[0.07] text-[#F7D002]">
                <Icon
                  name={icon as "spark" | "captions" | "bolt"}
                  size={20}
                />
              </div>

              <h3 className="mt-7 text-xl font-bold">{title}</h3>

              <p className="mt-2 text-sm leading-6 text-white/35">{text}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 rounded-[34px] border border-white/[0.08] bg-white/[0.035] p-7 backdrop-blur-2xl sm:p-10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">
            The idea
          </p>

          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Less editing. More creating.
          </h2>

          <p className="mt-5 max-w-3xl text-sm leading-7 text-white/35 sm:text-base">
            The goal is straightforward: make the boring parts of short-form
            production feel automatic while keeping the important creative
            choices in your hands — language, caption appearance, framing,
            music and how many clips you want.
          </p>

          <div className="mt-8 flex flex-wrap gap-3 text-[10px] font-black uppercase tracking-[0.13em] text-white/45">
            {[
              "MP3",
              "WAV",
              "MP4",
              "MKV",
              "1–7 clips",
              "Hindi",
              "English",
              "Hinglish",
            ].map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-2"
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-[#F7D002] px-5 py-3 text-xs font-black uppercase tracking-[0.1em] text-black transition hover:brightness-105"
          >
            Open Studio
            <Icon name="arrow" size={14} />
          </Link>

          <Link
            href="/support"
            className="rounded-full border border-white/[0.09] bg-white/[0.04] px-5 py-3 text-xs font-bold text-white/55 transition hover:text-white"
          >
            Get Support
          </Link>
        </div>

        <footer className="mt-24 border-t border-white/[0.07] pt-7 text-xs text-white/25">
          CAPTIFY · Your videos. Captions, perfected. · MADE BY SHIVRAJ KUMAR
        </footer>
      </div>
    </main>
  );
}