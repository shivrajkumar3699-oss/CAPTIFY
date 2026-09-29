"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const SUPPORT_EMAIL = "lwithshiv@gmail.com";
const UPI_ID = "shivrajkumar666@fam";

const MIN_AMOUNT = 21;
const MAX_AMOUNT = 21000;

const QUICK_AMOUNTS = [21, 51, 99, 199, 499, 999];

const FAQS = [
  {
    question: "What files does CAPTIFYY support?",
    answer:
      "CAPTIFYY currently supports MP3, WAV, MP4 and MKV files. The maximum upload size is 3 GB.",
  },
  {
    question: "Is CAPTIFYY a translation website?",
    answer:
      "No. CAPTIFYY is a caption and clip-generation studio. You choose the caption language you want and CAPTIFYY renders the selected captions into your output.",
  },
  {
    question: "How many clips can I generate?",
    answer:
      "You can choose anywhere from 1 to 7 clips using the clip-count slider in Studio.",
  },
  {
    question: "Why is my upload taking a long time?",
    answer:
      "Large video files naturally take longer to upload. Keep the browser tab open, make sure your internet connection is stable and avoid closing or refreshing the page during upload.",
  },
  {
    question: "My processing seems stuck. What should I do?",
    answer:
      "Give the job some time first, especially for long or high-resolution videos. If it remains stuck, note the last status shown by CAPTIFYY, refresh the Studio and try the job again.",
  },
  {
    question: "Why did my video fail during processing?",
    answer:
      "Processing can fail because of an unsupported or corrupted media file, an unusual codec, a temporary processing issue or another media-specific problem. Try another file first. If the same problem continues, use Report a Problem below.",
  },
  {
    question: "Can I change the caption language?",
    answer:
      "Yes. Studio lets you choose the video language and the caption language. CAPTIFYY can work with Hindi, English and Hinglish options.",
  },
  {
    question: "Can I change caption styling?",
    answer:
      "Yes. Advanced Styling is available directly in Studio. You can adjust the caption appearance and other available output preferences before starting the job.",
  },
  {
    question: "What quality options are available?",
    answer:
      "Studio provides the available output quality choices, including 720p, 1080p, 1440p and 4K where supported by the processing workflow.",
  },
  {
    question: "Do I need to keep the website open while processing?",
    answer:
      "Yes. For the smoothest experience, keep the Studio tab open until processing finishes and your clips appear in the results section.",
  },
];

function Icon({
  name,
  size = 20,
}: {
  name:
    | "help"
    | "mail"
    | "upload"
    | "processing"
    | "bug"
    | "arrow"
    | "copy"
    | "heart"
    | "shield";
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

  if (name === "help") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.25 1-1.8 1.45-1.8 3.05" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }

  if (name === "upload") {
    return (
      <svg {...common}>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  if (name === "processing") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (name === "bug") {
    return (
      <svg {...common}>
        <rect x="8" y="7" width="8" height="11" rx="4" />
        <path d="M12 7V4" />
        <path d="M8 10H5M19 10h-3M8 14H4M20 14h-4" />
        <path d="M8 6 6 4M16 6l2-2" />
        <path d="M9 18c.8 1.2 1.8 2 3 2s2.2-.8 3-2" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg {...common}>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
    );
  }

  if (name === "heart") {
    return (
      <svg {...common}>
        <path d="M20.8 8.8c0 5.2-8.8 10.2-8.8 10.2S3.2 14 3.2 8.8A4.6 4.6 0 0 1 12 6.5a4.6 4.6 0 0 1 8.8 2.3Z" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 20 6v5c0 5-3.3 8.4-8 10-4.7-1.6-8-5-8-10V6l8-3Z" />
        <path d="m9 12 2 2 4-4" />
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

export default function SupportPage() {
  const [amount, setAmount] = useState(199);
  const [customAmount, setCustomAmount] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Support — CAPTIFYY";
  }, []);

  const customNumericAmount = customAmount
    ? Number(customAmount)
    : null;

  const customAmountTooLow =
    customNumericAmount !== null &&
    Number.isFinite(customNumericAmount) &&
    customNumericAmount < MIN_AMOUNT;

  const customAmountTooHigh =
    customNumericAmount !== null &&
    Number.isFinite(customNumericAmount) &&
    customNumericAmount > MAX_AMOUNT;

  const customAmountInvalid =
    customAmountTooLow || customAmountTooHigh;

  const qrData = useMemo(() => {
    return (
      `upi://pay?pa=${encodeURIComponent(UPI_ID)}` +
      `&pn=${encodeURIComponent("CAPTIFYY")}` +
      `&am=${amount}` +
      `&cu=INR`
    );
  }, [amount]);

  const qrUrl = useMemo(() => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=${encodeURIComponent(
      qrData
    )}`;
  }, [qrData]);

  const gmailUrl = useMemo(() => {
    const subject = encodeURIComponent("CAPTIFYY — Report a Problem");

    const body = encodeURIComponent(
      `Hi Shivraj,\n\nI found a problem while using CAPTIFYY.\n\nProblem:\n\n\nFile type / size:\n\n\nWhat happened:\n\n\nAnything else:\n\n\nThanks.`
    );

    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      SUPPORT_EMAIL
    )}&su=${subject}&body=${body}`;
  }, []);

  const openUPI = () => {
    if (customAmountInvalid) return;

    window.location.href = qrData;
  };

  const copyUPI = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      window.prompt("Copy this UPI ID:", UPI_ID);
    }
  };

  const handleQuickAmount = (value: number) => {
    setAmount(value);
    setCustomAmount("");
  };

  const handleCustomAmount = (value: string) => {
    const clean = value.replace(/[^\d]/g, "");

    setCustomAmount(clean);

    if (!clean) {
      return;
    }

    const numeric = Number(clean);

    if (!Number.isFinite(numeric)) {
      return;
    }

    if (numeric >= MIN_AMOUNT && numeric <= MAX_AMOUNT) {
      setAmount(numeric);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#030303] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-[-220px] top-[-220px] h-[650px] w-[650px] rounded-full blur-[160px]"
          style={{
            background:
              "radial-gradient(circle, rgba(247,208,2,.12), transparent 68%)",
          }}
        />

        <div
          className="absolute right-[-220px] top-[20%] h-[650px] w-[650px] rounded-full blur-[170px]"
          style={{
            background:
              "radial-gradient(circle, rgba(240,6,153,.10), transparent 68%)",
          }}
        />

        <div
          className="absolute left-[30%] top-[55%] h-[450px] w-[450px] rounded-full blur-[160px]"
          style={{
            background:
              "radial-gradient(circle, rgba(255,122,0,.055), transparent 70%)",
          }}
        />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,.25)_55%,rgba(0,0,0,.82)_100%)]" />
      </div>

      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 lg:px-7">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between rounded-[30px] border border-white/[0.09] bg-black/60 px-4 py-3 shadow-[0_25px_90px_rgba(0,0,0,.5)] backdrop-blur-3xl sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[15px] border border-[#F7D002]/30 bg-[#F7D002]/[0.08] text-base font-black text-[#F7D002]">
              C
            </div>

            <div>
              <div className="text-sm font-black uppercase tracking-[0.24em]">
                CAPTIFYY
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
              href="/about"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              About
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <section className="relative overflow-hidden rounded-[42px] border border-white/[0.09] bg-white/[0.035] shadow-[0_35px_120px_rgba(0,0,0,.35)] backdrop-blur-3xl">
          <div
            className="pointer-events-none absolute left-1/2 top-[-180px] h-[420px] w-[720px] -translate-x-1/2 rounded-full blur-[130px]"
            style={{
              background:
                "radial-gradient(ellipse,rgba(247,208,2,.12),rgba(240,6,153,.07),transparent 72%)",
            }}
          />

          <div className="relative p-7 sm:p-10 lg:p-12">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F7D002]/15 bg-[#F7D002]/[0.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">
                <Icon name="heart" size={13} />
                Optional Support
              </div>

              <h1 className="mt-6 text-4xl font-black tracking-[-0.055em] sm:text-6xl">
                Help keep{" "}
                <span
                  style={{
                    background:
                      "linear-gradient(100deg,#F7D002,#FF7A00,#F00699)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  CAPTIFYY
                </span>{" "}
                moving.
              </h1>

              <p className="mt-5 max-w-2xl text-sm leading-7 text-white/35 sm:text-base">
                If you enjoy using CAPTIFYY and want to support the project,
                you can leave an optional tip. Every amount is completely
                optional.
              </p>
            </div>

            <div className="relative mt-10">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
                    Choose amount
                  </p>

                  <p className="mt-1 text-xs text-white/20">
                    Minimum ₹21 · Maximum ₹21,000
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/20">
                    Selected
                  </span>

                  <div className="mt-1 text-xl font-black text-[#F7D002]">
                    ₹{amount.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {QUICK_AMOUNTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleQuickAmount(value)}
                    className={`relative min-h-[58px] rounded-2xl border text-sm font-black transition ${
                      amount === value && !customAmount
                        ? "border-[#F7D002]/60 bg-[#F7D002]/[0.11] text-[#F7D002] shadow-[0_10px_35px_rgba(247,208,2,.08)]"
                        : "border-white/[0.08] bg-black/20 text-white/45 hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    ₹{value.toLocaleString("en-IN")}

                    {value === 199 && (
                      <span className="absolute -right-1.5 -top-2 rounded-full bg-[#F7D002] px-2 py-1 text-[7px] font-black uppercase tracking-[0.08em] text-black">
                        Popular
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-[9px] font-black uppercase tracking-[0.18em] text-white/25">
                  Custom amount
                </label>

                <div
                  className={`flex items-center overflow-hidden rounded-2xl border bg-black/25 transition focus-within:border-[#F7D002]/35 ${
                    customAmountInvalid
                      ? "border-red-500/70"
                      : "border-white/[0.08]"
                  }`}
                >
                  <span className="pl-4 text-lg font-black text-[#F7D002]">
                    ₹
                  </span>

                  <input
                    type="text"
                    inputMode="numeric"
                    value={customAmount}
                    onChange={(event) =>
                      handleCustomAmount(event.target.value)
                    }
                    placeholder="Enter any amount"
                    className="min-w-0 flex-1 bg-transparent px-3 py-4 text-sm font-bold text-white outline-none placeholder:text-white/20"
                  />
                </div>

                {customAmountTooLow && (
                  <p className="mt-2 text-xs font-bold text-red-500">
                    Minimum support should be ₹21.
                  </p>
                )}

                {customAmountTooHigh && (
                  <p className="mt-2 text-xs font-bold text-red-500">
                    Maximum support is ₹21,000.
                  </p>
                )}

                {!customAmountInvalid && (
                  <p className="mt-2 text-[9px] text-white/20">
                    Enter any amount from ₹21 to ₹21,000.
                  </p>
                )}
              </div>
            </div>

            <div className="relative mt-10 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div
                className={`rounded-[30px] border bg-black/25 p-6 text-center transition sm:p-8 ${
                  customAmountInvalid
                    ? "border-red-500/20 opacity-60"
                    : "border-white/[0.08]"
                }`}
              >
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#F7D002]">
                  Scan to pay
                </p>

                <div className="mx-auto mt-6 flex w-fit items-center justify-center rounded-[25px] border border-white/[0.09] bg-white p-4 shadow-[0_25px_80px_rgba(0,0,0,.35)]">
                  <img
                    src={qrUrl}
                    alt={`UPI QR code for ₹${amount}`}
                    className="h-[220px] w-[220px] rounded-xl sm:h-[260px] sm:w-[260px]"
                  />
                </div>

                <p className="mt-5 text-xs font-bold text-white/35">
                  Scan with your preferred UPI app
                </p>

                <p className="mt-1 text-[10px] text-white/20">
                  Amount: ₹{amount.toLocaleString("en-IN")}
                </p>
              </div>

              <div className="rounded-[30px] border border-white/[0.08] bg-black/25 p-6 sm:p-8">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#FF7A00]">
                  UPI payment
                </p>

                <div className="mt-5 rounded-2xl border border-[#F7D002]/10 bg-[#F7D002]/[0.035] p-5">
                  <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/25">
                    UPI ID
                  </p>

                  <div className="mt-2 break-all text-base font-black text-white">
                    {UPI_ID}
                  </div>

                  <button
                    type="button"
                    onClick={copyUPI}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.1em] text-white/55 transition hover:border-[#F7D002]/25 hover:text-[#F7D002]"
                  >
                    <Icon name="copy" size={13} />
                    {copied ? "Copied!" : "Copy UPI ID"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={openUPI}
                  disabled={customAmountInvalid}
                  className={`mt-4 flex w-full items-center justify-between rounded-2xl px-5 py-4 text-xs font-black uppercase tracking-[0.1em] transition ${
                    customAmountInvalid
                      ? "cursor-not-allowed bg-white/[0.06] text-white/20"
                      : "bg-[#F7D002] text-black shadow-[0_15px_50px_rgba(247,208,2,.10)] hover:-translate-y-0.5 hover:brightness-105"
                  }`}
                >
                  <span>
                    {customAmountInvalid
                      ? "Fix Amount First"
                      : "Open UPI App"}
                  </span>

                  <Icon name="arrow" size={17} />
                </button>

                <div className="mt-5 flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <div className="mt-0.5 shrink-0 text-[#F7D002]">
                    <Icon name="shield" size={17} />
                  </div>

                  <p className="text-[10px] leading-5 text-white/25">
                    Payments are handled through your UPI app. CAPTIFYY does
                    not ask for your UPI PIN, card details or banking
                    credentials.
                  </p>
                </div>

                <p className="mt-5 text-center text-[9px] leading-5 text-white/20">
                  Support is completely optional. CAPTIFYY does not unlock
                  features or provide special access in exchange for a tip.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16 max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F7D002]/15 bg-[#F7D002]/[0.06] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">
            <Icon name="help" size={13} />
            CAPTIFYY Support
          </div>

          <h2 className="mt-7 text-5xl font-black tracking-[-0.055em] sm:text-7xl">
            Need a{" "}
            <span
              style={{
                background:
                  "linear-gradient(100deg,#F7D002,#FF7A00,#F00699)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              hand?
            </span>
          </h2>

          <p className="mt-6 max-w-2xl text-base leading-7 text-white/40 sm:text-lg">
            Find answers to the questions that usually come up while
            uploading, processing and creating clips with CAPTIFYY.
          </p>
        </section>

        <section className="mt-14 grid gap-4 md:grid-cols-3">
          <div className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F7D002]/15 bg-[#F7D002]/[0.07] text-[#F7D002]">
              <Icon name="upload" size={20} />
            </div>

            <h2 className="mt-7 text-xl font-bold">Upload issues</h2>

            <p className="mt-2 text-sm leading-6 text-white/35">
              Check your file type, file size and internet connection first.
              CAPTIFYY supports MP3, WAV, MP4 and MKV up to 3 GB.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FF7A00]/15 bg-[#FF7A00]/[0.07] text-[#FF7A00]">
              <Icon name="processing" size={20} />
            </div>

            <h2 className="mt-7 text-xl font-bold">Processing issues</h2>

            <p className="mt-2 text-sm leading-6 text-white/35">
              Longer videos can take more time. Keep the Studio tab open while
              transcription, hook detection and rendering are running.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F00699]/15 bg-[#F00699]/[0.07] text-[#F00699]">
              <Icon name="bug" size={20} />
            </div>

            <h2 className="mt-7 text-xl font-bold">Something broken?</h2>

            <p className="mt-2 text-sm leading-6 text-white/35">
              If the same problem keeps happening, send the exact error and
              useful file details through the Report a Problem button below.
            </p>
          </div>
        </section>

        <section className="mt-16">
          <div className="mb-6">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#F7D002]">
              FAQ
            </p>

            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Common questions
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/30">
              The things a normal CAPTIFYY user is most likely to wonder about.
            </p>
          </div>

          <div className="overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.035] backdrop-blur-2xl">
            {FAQS.map((faq, index) => (
              <details
                key={faq.question}
                className="group border-b border-white/[0.07] last:border-b-0"
              >
                <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-5 sm:px-7 sm:py-6">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-black/20 text-[9px] font-black text-white/25">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <span className="flex-1 text-sm font-bold text-white/80 sm:text-base">
                    {faq.question}
                  </span>

                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.025] text-white/30 transition duration-300 group-open:rotate-45 group-open:border-[#F7D002]/30 group-open:text-[#F7D002]">
                    +
                  </span>
                </summary>

                <div className="px-5 pb-6 pl-[68px] pr-8 sm:px-7 sm:pb-7 sm:pl-[76px]">
                  <p className="max-w-3xl text-sm leading-7 text-white/38">
                    {faq.answer}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="relative mt-16 overflow-hidden rounded-[38px] border border-white/[0.08] bg-white/[0.035] p-7 backdrop-blur-2xl sm:p-10">
          <div
            className="pointer-events-none absolute right-[-120px] top-[-120px] h-[330px] w-[330px] rounded-full blur-[100px]"
            style={{
              background:
                "radial-gradient(circle,rgba(240,6,153,.11),transparent 70%)",
            }}
          />

          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F00699]/20 bg-[#F00699]/[0.07] text-[#F00699]">
                <Icon name="mail" size={21} />
              </div>

              <p className="mt-7 text-[10px] font-black uppercase tracking-[0.22em] text-[#F00699]">
                DIRECT SUPPORT
              </p>

              <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                Still stuck?
              </h2>

              <p className="mt-4 text-sm leading-7 text-white/35">
                If the FAQ and troubleshooting steps did not solve the problem,
                report it directly. Gmail will open with the recipient,
                subject and a useful starter template already filled in.
              </p>

              <div className="mt-5 flex items-center gap-2 text-xs text-white/25">
                <Icon name="shield" size={15} />
                <span>{SUPPORT_EMAIL}</span>
              </div>
            </div>

            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-3 rounded-full bg-[#F7D002] px-6 py-4 text-xs font-black uppercase tracking-[0.12em] text-black shadow-[0_15px_50px_rgba(247,208,2,.12)] transition hover:-translate-y-0.5 hover:brightness-105"
            >
              <Icon name="mail" size={16} />
              Report a Problem
            </a>
          </div>
        </section>

        <section className="mt-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#F7D002]/15 bg-[#F7D002]/[0.05] text-[#F7D002]">
            <Icon name="heart" size={21} />
          </div>

          <h2 className="mt-6 text-3xl font-black tracking-tight sm:text-4xl">
            Thanks for using CAPTIFYY.
          </h2>

          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-white/30">
            Whether you use CAPTIFYY once or keep coming back, the project is
            built to make your editing workflow simpler.
          </p>

          <Link
            href="/"
            className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-5 py-3 text-xs font-black uppercase tracking-[0.1em] text-white/55 transition hover:border-[#F7D002]/25 hover:text-[#F7D002]"
          >
            Back to Studio
            <Icon name="arrow" size={14} />
          </Link>
        </section>

        <footer className="mt-24 border-t border-white/[0.07] pt-7 text-xs text-white/25">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>CAPTIFYY · Your videos. Captions, perfected.</span>

            <span>MADE BY SHIVRAJ KUMAR</span>
          </div>
        </footer>
      </div>
    </main>
  );
}