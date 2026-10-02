"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  extractSpeechAudio,
  getMediaDuration,
  getVideoResolution,
  trimVideoForUpload,
} from "@/lib/smartMedia";

type ClipResult = {
  index: number;
  title: string;
  hookReason: string;
  startTime: number;
  endTime: number;
  rawUrl: string;
  editedUrl: string;
  previewUrl?: string;
};

type JobStatus = {
  jobId: string;
  status:
    | "queued"
    | "transcribing"
    | "detecting_hooks"
    | "rendering"
    | "done"
    | "error";
  progress: number;
  message?: string;
  clips?: ClipResult[];
  error?: string;
};

const MAX_FILE_SIZE = 3 * 1024 * 1024 * 1024;

const CAPTION_COLORS = [
  { name: "Yellow", value: "#F7D002" },
  { name: "White", value: "#FFFFFF" },
  { name: "Green", value: "#39FF14" },
  { name: "Pink", value: "#FF3EA5" },
  { name: "Cyan", value: "#00E5FF" },
];

const VIDEO_LANGUAGES = [
  { name: "Auto detect", value: "auto" },
  { name: "English", value: "en" },
  { name: "Hindi", value: "hi" },
  { name: "Hinglish", value: "hinglish" },
];

const CAPTION_LANGUAGES = [
  { name: "Same as video", value: "same" },
  { name: "English", value: "en" },
  { name: "Hindi", value: "hi" },
  { name: "Hinglish", value: "hinglish" },
];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
  }

  return `${pad2(minutes)}:${pad2(secs)}`;
}

function timeRange(start: number, end: number) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function clipLength(start: number, end: number) {
  return Math.max(0, end - start);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getExtension(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Calculating...";
  const total = Math.max(1, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `About ${hours}h ${minutes}m remaining`;
  if (minutes > 0) return `About ${minutes}m ${secs}s remaining`;
  return `About ${secs}s remaining`;
}

function formatMbps(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0.0 Mbps";
  return `${((bytesPerSecond * 8) / 1_000_000).toFixed(1)} Mbps`;
}

function getStatusLabel(status: JobStatus["status"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "transcribing":
      return "Transcribing";
    case "detecting_hooks":
      return "Finding hooks";
    case "rendering":
      return "Rendering clips";
    case "done":
      return "Complete";
    case "error":
      return "Something went wrong";
    default:
      return "Processing";
  }
}

function formatResolution(width: number, height: number) {
  const longSide = Math.max(width, height);
  if (longSide >= 7680) return "16K";
  if (longSide >= 4320) return "8K";
  if (longSide >= 3840) return "4K";
  if (longSide >= 2560) return "1440p";
  if (longSide >= 1920) return "1080p";
  if (longSide >= 1280) return "720p";
  return width + "×" + height;
}

function validateFile(file: File) {
  const extension = getExtension(file.name);
  const allowed = ["mp3", "wav", "mp4", "mkv"];

  if (!allowed.includes(extension)) {
    return "Please upload an MP3, WAV, MP4, or MKV file.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "Maximum file size is 3 GB.";
  }

  if (file.size <= 0) {
    return "This file appears to be empty.";
  }

  return null;
}

function Icon({
  name,
  size = 20,
}: {
  name:
    | "upload"
    | "spark"
    | "play"
    | "download"
    | "copy"
    | "check"
    | "chevron"
    | "music"
    | "captions"
    | "film"
    | "clock"
    | "close"
    | "refresh"
    | "arrow"
    | "layers"
    | "wand"
    | "shield"
    | "zap";
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

  switch (name) {
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );

    case "spark":
      return (
        <svg {...common}>
          <path d="m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Z" />
          <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
        </svg>
      );

    case "play":
      return (
        <svg {...common}>
          <path d="m9 6 10 6-10 6V6Z" fill="currentColor" />
        </svg>
      );

    case "download":
      return (
        <svg {...common}>
          <path d="M12 4v11" />
          <path d="m7 11 5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
      );

    case "copy":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      );

    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );

    case "chevron":
      return (
        <svg {...common}>
          <path d="m7 9 5 5 5-5" />
        </svg>
      );

    case "music":
      return (
        <svg {...common}>
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="17" cy="16" r="3" />
        </svg>
      );

    case "captions":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M7 10h4M7 14h3M14 10h3M14 14h3" />
        </svg>
      );

    case "film":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
        </svg>
      );

    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );

    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );

    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 0 0-14.9-4L3 10" />
          <path d="M3 5v5h5" />
          <path d="M4 13a8 8 0 0 0 14.9 4L21 14" />
          <path d="M21 19v-5h-5" />
        </svg>
      );

    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h13" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );

    case "layers":
      return (
        <svg {...common}>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 16 9 5 9-5" />
        </svg>
      );

    case "wand":
      return (
        <svg {...common}>
          <path d="m15 4 5 5" />
          <path d="m5 19 10-10" />
          <path d="m5 7 .6 2.4L8 10l-2.4.6L5 13l-.6-2.4L2 10l2.4-.6L5 7Z" />
          <path d="m18 14 .5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5.5-2Z" />
        </svg>
      );

    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 19 6v5c0 4.5-2.8 8.2-7 10-4.2-1.8-7-5.5-7-10V6l7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );

    case "zap":
      return (
        <svg {...common}>
          <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );

    default:
      return null;
  }
}

async function downloadClip(url: string, filename: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(
        "Download failed (" + response.status + ")"
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType
        .toLowerCase()
        .includes("video/mp4")
    ) {
      throw new Error(
        "The generated clip was not returned as an MP4 video."
      );
    }

    const blob = await response.blob();
    const blobUrl =
      URL.createObjectURL(blob);

    const anchor =
      document.createElement("a");

    anchor.href = blobUrl;
    anchor.download =
      filename.endsWith(".mp4")
        ? filename
        : filename + ".mp4";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(blobUrl),
      1000
    );
  } catch (error) {
    console.error(
      "CAPTIFY clip download failed:",
      error
    );

    alert(
      error instanceof Error
        ? error.message
        : "Unable to download the generated clip."
    );
  }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<JobStatus | null>(null);

  const [videoLanguage, setVideoLanguage] = useState("auto");
  const [captionLanguage, setCaptionLanguage] = useState("same");
  const [captionColor, setCaptionColor] = useState("#F7D002");

  // ONLY 1-7 CLIPS.
  // Default = 6.
  const [numClips, setNumClips] = useState(6);

  const [bgm, setBgm] = useState(true);
  const [framing, setFraming] = useState<"fill" | "fit">("fill");

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [uploadEta, setUploadEta] = useState(0);
  const displayedUploadStatsRef = useRef({
    speed: 0,
    eta: 0,
    lastUpdateAt: 0,
  });
  const uploadProgressRef = useRef(0);
  const uploadStatsRef = useRef({
    startedAt: 0,
    lastSampleAt: 0,
    lastSampleBytes: 0,
    samples: [] as Array<{ time: number; bytes: number }>,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const cancelRequestedRef = useRef(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderWatchdogRef = useRef<number | null>(null);

  const isProcessing =
    status?.status === "queued" ||
    status?.status === "transcribing" ||
    status?.status === "detecting_hooks" ||
    status?.status === "rendering";

  const isDone = status?.status === "done";

  // The worker sends a final "Clip N of N completed" update immediately
  // after the last edited clip is created. Treat that terminal render event
  // as 100% even if a stale/intermediate 95% status reaches the browser first.
  const lastClipCompleted =
    status?.status === "rendering" &&
    typeof status.message === "string" &&
    /^Clip\s+\d+\s+of\s+\d+\s+completed$/i.test(
      status.message.trim()
    );

  const rawProgress =
    isDone
      ? 100
      : isProcessing
        ? status?.status === "rendering"
          ? Math.max(
              0,
              Math.min(
                99,
                Number(status?.progress ?? 0)
              )
            )
          : Math.max(
              uploadProgress,
              Math.max(
                0,
                Math.min(
                  100,
                  Number(status?.progress ?? 0)
                )
              )
            )
        : uploadProgress;

  const targetProgressRef = useRef(0);
  const [displayProgress, setDisplayProgress] = useState(0);

  useEffect(() => {
    targetProgressRef.current = Math.max(
      targetProgressRef.current,
      Math.max(0, Math.min(100, rawProgress))
    );

    if (isDone || lastClipCompleted) {
      targetProgressRef.current = 100;
      setDisplayProgress(100);
    }
  }, [rawProgress, isDone, lastClipCompleted]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayProgress((current) => {
        const target = targetProgressRef.current;

        if (current >= target) {
          return current;
        }

        const remaining = target - current;
        const step = Math.max(
          1,
          Math.min(4, Math.ceil(remaining / 5))
        );

        return Math.min(
          target,
          current + step
        );
      });
    }, 250);

    return () => window.clearInterval(timer);
  }, []);

  const progress = displayProgress;

  const renderStartedAtRef = useRef(0);
  const renderEtaRef = useRef<number | null>(null);
  const [renderEta, setRenderEta] = useState<number | null>(null);

  const renderStatusMatch =
    status?.status === "rendering" &&
    typeof status.message === "string"
      ? status.message.match(
          /^(?:Rendering clip\\s+(\\d+)\\s+of\\s+(\\d+)|Clip\\s+(\\d+)\\s+of\\s+(\\d+)\\s+completed)$/i
        )
      : null;

  const renderClipNumber = renderStatusMatch
    ? Number(
        renderStatusMatch[1] ||
          renderStatusMatch[3]
      )
    : null;

  const renderClipTotal = renderStatusMatch
    ? Number(
        renderStatusMatch[2] ||
          renderStatusMatch[4]
      )
    : null;

  useEffect(() => {
    if (status?.status !== "rendering") {
      renderStartedAtRef.current = 0;
      renderEtaRef.current = null;
      setRenderEta(null);
      return;
    }

    if (!renderStartedAtRef.current) {
      renderStartedAtRef.current = Date.now();
      return;
    }

    const currentProgress = Math.max(
      50,
      Math.min(
        95,
        Number(status.progress) || 50
      )
    );

    const elapsedSeconds =
      (Date.now() - renderStartedAtRef.current) /
      1000;

    const completedProgress =
      currentProgress - 50;

    if (
      completedProgress >= 1 &&
      elapsedSeconds >= 2
    ) {
      const estimatedTotalSeconds =
        elapsedSeconds *
        (45 / completedProgress);

      const remainingSeconds = Math.max(
        1,
        Math.ceil(
          estimatedTotalSeconds -
            elapsedSeconds
        )
      );

      renderEtaRef.current =
        remainingSeconds;
      setRenderEta(remainingSeconds);
    }
  }, [status?.status, status?.progress]);

  useEffect(() => {
    if (status?.status !== "rendering") {
      return;
    }

    const timer = window.setInterval(() => {
      if (!renderStartedAtRef.current) {
        return;
      }

      const currentProgress = Math.max(
        50,
        Math.min(
          95,
          Number(status.progress) || 50
        )
      );

      const elapsedSeconds =
        (Date.now() -
          renderStartedAtRef.current) /
        1000;

      const completedProgress =
        currentProgress - 50;

      if (
        completedProgress >= 1 &&
        elapsedSeconds >= 2
      ) {
        const estimatedTotalSeconds =
          elapsedSeconds *
          (45 / completedProgress);

        const remainingSeconds = Math.max(
          1,
          Math.ceil(
            estimatedTotalSeconds -
              elapsedSeconds
          )
        );

        if (
          renderEtaRef.current !==
          remainingSeconds
        ) {
          renderEtaRef.current =
            remainingSeconds;
          setRenderEta(
            remainingSeconds
          );
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status?.status, status?.progress]);

  const pollingCancelRef = useRef<(() => void) | null>(null);
  const highestProgressRef = useRef(0);
  const terminalStatusRef = useRef(false);

  const stopPolling = useCallback(() => {
    pollingCancelRef.current?.();
    pollingCancelRef.current = null;

    if (pollingRef.current) {
      clearTimeout(pollingRef.current as unknown as ReturnType<typeof setTimeout>);
      pollingRef.current = null;
    }

    if (renderWatchdogRef.current) {
      clearInterval(renderWatchdogRef.current);
      renderWatchdogRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const cacheGeneratedClips = useCallback(
    async (clips: ClipResult[]) => {
      const cached = await Promise.all(
        clips.map(async (clip) => {
          if (!clip.editedUrl) {
            return clip;
          }

          // Keep the generated MP4 in the browser while this session is open.
          // Render Free uses ephemeral /tmp storage, so a worker restart can
          // otherwise make an already-finished clip return HTTP 404.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const response = await fetch(
                clip.editedUrl,
                { cache: "no-store" }
              );

              if (
                !response.ok ||
                !response.body
              ) {
                throw new Error(
                  "Clip fetch returned HTTP " +
                    response.status
                );
              }

              const contentType =
                response.headers.get(
                  "content-type"
                ) || "";

              if (
                !contentType
                  .toLowerCase()
                  .includes("video/mp4")
              ) {
                throw new Error(
                  "Generated clip was not returned as MP4."
                );
              }

              const blob =
                await response.blob();

              if (blob.size <= 0) {
                throw new Error(
                  "Generated clip is empty."
                );
              }

              return {
                ...clip,
                previewUrl:
                  URL.createObjectURL(blob),
              };
            } catch (error) {
              if (attempt === 2) {
                console.warn(
                  "Could not cache generated clip:",
                  clip.index + 1,
                  error
                );
              } else {
                await new Promise(
                  (resolve) =>
                    setTimeout(
                      resolve,
                      800 * (attempt + 1)
                    )
                );
              }
            }
          }

          return clip;
        })
      );

      return cached;
    },
    []
  );

  const fetchStatus = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          `/api/status/${encodeURIComponent(id)}`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error("Unable to read job status.");
        }

        const data = (await response.json()) as JobStatus;

        // Status must only move forward. Even if a cached/late response ever
        // arrives, it can never pull the UI back from 100% to 41%.
        if (terminalStatusRef.current) {
          return;
        }

        const renderFinished =
          data.status === "done" &&
          Array.isArray(data.clips) &&
          data.clips.length > 0;

        if (
          data.status === "done" ||
          data.status === "error"
        ) {
          terminalStatusRef.current = true;
          highestProgressRef.current =
            data.status === "error" ? highestProgressRef.current : 100;

          const terminalData: JobStatus =
            renderFinished
              ? {
                  ...data,
                  status: "done",
                  progress: 100,
                  message:
                    data.message ||
                    "Clips ready",
                }
              : data;

          stopPolling();

          setStatus(terminalData);

          if (
            terminalData.status === "done" &&
            Array.isArray(terminalData.clips) &&
            terminalData.clips.length > 0
          ) {
            void cacheGeneratedClips(terminalData.clips).then(
              (cachedClips) => {
                setStatus((current) => {
                  if (
                    !current ||
                    current.status !== "done" ||
                    current.jobId !== terminalData.jobId
                  ) {
                    return current;
                  }

                  return {
                    ...current,
                    clips: cachedClips,
                  };
                });
              }
            );
          }

          return;
        }

        const incomingProgress = Math.max(
          0,
          Math.min(100, Number(data.progress) || 0)
        );

        highestProgressRef.current = Math.max(
          highestProgressRef.current,
          incomingProgress
        );

        setStatus((current) => ({
          ...(current || data),
          ...data,
          progress: highestProgressRef.current,
        }));
      } catch (err) {
        console.error(err);
      }
    },
    [
      cacheGeneratedClips,
      stopPolling,
    ]
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();

      let cancelled = false;

      const poll = async () => {
        if (cancelled) return;

        await fetchStatus(id);

        if (cancelled) return;

        // Wait until the previous request has fully completed before making
        // another request. This prevents out-of-order responses from an
        // older 41% status overwriting a newer 100%/done status.
        pollingRef.current = setTimeout(poll, 2500);
      };

      poll();

      pollingCancelRef.current = () => {
        cancelled = true;
      };
    },
    [fetchStatus, stopPolling]
  );

  const handleFile = useCallback(
    async (selectedFile: File | null) => {
      if (!selectedFile) return;

      const validationError = validateFile(selectedFile);

      if (validationError) {
        setError(validationError);
        setFile(null);
        return;
      }

      const extension = getExtension(selectedFile.name);

      if (extension === "mp4" || extension === "mkv") {
        try {
          const resolution = await getVideoResolution(selectedFile);

          if (
            resolution &&
            !(
              (
                resolution.width >= resolution.height &&
                resolution.width <= 2560
              ) ||
              (
                resolution.height > resolution.width &&
                resolution.width <= 1920 &&
                resolution.height < 3840
              )
            )
          ) {
            const label = formatResolution(
              resolution.width,
              resolution.height
            );

            setError(
              label +
                " video (" +
                resolution.width +
                "×" +
                resolution.height +
                ") is not supported. Please use a 1440p-or-lower landscape video, or a portrait video up to 1920×3413."
            );
            setFile(null);

            if (inputRef.current) {
              inputRef.current.value = "";
            }

            return;
          }
        } catch (resolutionError) {
          console.error("Resolution check failed:", resolutionError);
          setError(
            "Could not read this video's resolution. Please use an MP4 or MKV video at 1080p resolution or lower."
          );
          setFile(null);

          if (inputRef.current) {
            inputRef.current.value = "";
          }

          return;
        }
      }

      setError("");
      setFile(selectedFile);
      setStatus(null);
      setJobId("");
      setUploadProgress(0);
      setUploadSpeed(0);
      setUploadEta(0);
      targetProgressRef.current = 0;
      setDisplayProgress(0);
      displayedUploadStatsRef.current = { speed: 0, eta: 0, lastUpdateAt: 0 };
      uploadStatsRef.current = { startedAt: 0, lastSampleAt: 0, lastSampleBytes: 0, samples: [] };
    },
    []
  );

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    handleFile(event.target.files?.[0] || null);
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    setIsDragging(false);

    void handleFile(
      event.dataTransfer.files?.[0] || null
    );
  };

    const handleStart = async () => {
    if (!file || isProcessing) return;

    setError("");
    setStatus(null);

    uploadProgressRef.current = 0;
    highestProgressRef.current = 0;
    terminalStatusRef.current = false;

    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadEta(0);
    targetProgressRef.current = 0;
    setDisplayProgress(0);

    try {
      const newJobId = crypto.randomUUID();

      setJobId(newJobId);

      const createResponse = await fetch(
        "/api/create-job",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jobId: newJobId,
          }),
        }
      );

      if (!createResponse.ok) {
        const data = await createResponse
          .json()
          .catch(() => ({}));

        throw new Error(
          data.error ||
            "Could not create the processing job."
        );
      }

      const createData =
        await createResponse.json();

      const confirmedJobId =
        String(createData.jobId || "");

      if (confirmedJobId !== newJobId) {
        throw new Error(
          "Job ID mismatch. Please try again."
        );
      }

      const uploadUrlBase =
        typeof createData.uploadUrlBase === "string"
          ? createData.uploadUrlBase
          : "";

      const workerBase =
        process.env.NODE_ENV === "production"
          ? "https://captify-worker.onrender.com"
          : uploadUrlBase.replace(
              /\/upload\/[^/]+\/?$/,
              ""
            );

      if (!workerBase) {
        throw new Error(
          "Could not prepare the worker upload."
        );
      }

      const uploadChunks = async (
        targetUrl: string,
        uploadFile: File,
        progressStart: number,
        progressEnd: number
      ) => {
        const CHUNK_SIZE = 8 * 1024 * 1024;
        const MAX_RETRIES = 3;
        const MAX_FULL_RESTARTS = 2;

        const totalBytes = uploadFile.size;

        if (!totalBytes) {
          throw new Error(
            "Upload file is empty."
          );
        }

        const chunkCount = Math.ceil(
          totalBytes / CHUNK_SIZE
        );

        let fullRestart = 0;

        // Render free instances use ephemeral /tmp storage. If the worker
        // restarts between chunks, its partial upload disappears. In that
        // case the worker returns 409/UPLOAD_RESTART_REQUIRED and we restart
        // THIS upload from chunk 0 instead of killing the whole job.
        while (fullRestart <= MAX_FULL_RESTARTS) {
          let restartRequired = false;

          for (
            let index = 0;
            index < chunkCount;
            index++
          ) {
            const start =
              index * CHUNK_SIZE;

            const end = Math.min(
              start + CHUNK_SIZE,
              totalBytes
            );

            const chunk =
              uploadFile.slice(
                start,
                end,
                uploadFile.type ||
                  "application/octet-stream"
              );

            let attempt = 0;

            while (true) {
              try {
                await new Promise<void>(
                  (resolve, reject) => {
                    const xhr =
                      new XMLHttpRequest();

                    xhr.open(
                      "PUT",
                      targetUrl,
                      true
                    );

                    xhr.timeout = 120000;

                    xhr.setRequestHeader(
                      "Content-Type",
                      uploadFile.type ||
                        "application/octet-stream"
                    );

                    xhr.setRequestHeader(
                      "Content-Range",
                      `bytes ${start}-${end - 1}/${totalBytes}`
                    );

                    xhr.setRequestHeader(
                      "X-Chunk-Index",
                      String(index)
                    );

                    xhr.setRequestHeader(
                      "X-Total-Chunks",
                      String(chunkCount)
                    );

                    xhr.onload = () => {
                      if (
                        xhr.status >= 200 &&
                        xhr.status < 300
                      ) {
                        resolve();
                        return;
                      }

                      const responseBody =
                        String(
                          xhr.responseText || ""
                        ).trim();

                      // 409 means the worker lost the partial file.
                      // Let the outer uploader restart from byte 0.
                      if (
                        xhr.status === 409 &&
                        responseBody.includes(
                          "UPLOAD_RESTART_REQUIRED"
                        )
                      ) {
                        reject(
                          new Error(
                            "UPLOAD_RESTART_REQUIRED"
                          )
                        );
                        return;
                      }

                      reject(
                        new Error(
                          `Upload failed (HTTP ${xhr.status})${responseBody ? `: ${responseBody.slice(0, 500)}` : "."}`
                        )
                      );
                    };

                    xhr.onerror = () => {
                      reject(
                        new Error(
                          "Upload connection failed."
                        )
                      );
                    };

                    xhr.ontimeout = () => {
                      reject(
                        new Error(
                          "Upload request timed out."
                        )
                      );
                    };

                    xhr.onabort = () => {
                      reject(
                        new Error(
                          "Upload request was aborted."
                        )
                      );
                    };

                    xhr.upload.onprogress =
                      (event) => {
                        if (
                          !event.lengthComputable
                        ) {
                          return;
                        }

                        const chunkProgress =
                          event.loaded /
                          event.total;

                        const overallProgress =
                          index /
                            chunkCount +
                          chunkProgress /
                            chunkCount;

                        const progress =
                          progressStart +
                          overallProgress *
                            (progressEnd -
                              progressStart);

                        setUploadProgress(
                          Math.max(
                            progressStart,
                            Math.min(
                              progressEnd,
                              progress
                            )
                          )
                        );
                      };

                    xhr.send(chunk);
                  }
                );

                break;
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message ===
                    "UPLOAD_RESTART_REQUIRED"
                ) {
                  restartRequired = true;
                  break;
                }

                if (
                  attempt >= MAX_RETRIES
                ) {
                  throw error instanceof Error
                    ? error
                    : new Error(
                        "Upload connection failed after several retries."
                      );
                }

                attempt += 1;

                await new Promise(
                  (resolve) =>
                    setTimeout(
                      resolve,
                      1000 * attempt
                    )
                );
              }
            }

            if (restartRequired) {
              break;
            }

            const completedProgress =
              progressStart +
              ((index + 1) /
                chunkCount) *
                (progressEnd -
                  progressStart);

            setUploadProgress(
              Math.max(
                progressStart,
                Math.min(
                  progressEnd,
                  completedProgress
                )
              )
            );
          }

          if (!restartRequired) {
            return;
          }

          fullRestart += 1;
          setUploadProgress(progressStart);

          await new Promise(
            (resolve) =>
              setTimeout(resolve, 750)
          );
        }

        throw new Error(
          "Upload state kept resetting on the worker. Please try this upload again."
        );
      };
      /*
       * STEP 1
       * Read the original file locally.
       * Nothing from the 3 GB source is uploaded.
       */
      setStatus({
        jobId: newJobId,
        status: "queued",
        progress: 1,
        message:
          "Reading your media locally..."
      });

      const duration =
        await getMediaDuration(file);

      /*
       * STEP 2
       * Extract only small speech audio locally.
       */
      setStatus({
        jobId: newJobId,
        status: "transcribing",
        progress: 5,
        message:
          "Extracting speech audio on your device..."
      });

      const analysisAudio =
        await extractSpeechAudio(
          file,
          (value: number) => {
            const progress =
              Math.round(value * 20);

            setUploadProgress(
              Math.max(
                uploadProgressRef.current,
                progress
              )
            );

            uploadProgressRef.current =
              Math.max(
                uploadProgressRef.current,
                progress
              );
          }
        );

      const analysisFile =
        new File(
          [analysisAudio],
          "captify-analysis.mp3",
          {
            type: "audio/mpeg",
          }
        );

      /*
       * STEP 3
       * Upload only the extracted audio.
       */
      setStatus({
        jobId: newJobId,
        status: "transcribing",
        progress: 20,
        message:
          "Uploading speech audio for AI analysis..."
      });

      const analysisUploadUrl =
        `${workerBase}/upload-analysis/${encodeURIComponent(
          newJobId
        )}`;

      await uploadChunks(
        analysisUploadUrl,
        analysisFile,
        20,
        35
      );

      /*
       * STEP 4
       * Transcribe + detect complete hooks.
       */
      const analyzeResponse =
        await fetch(
          "/api/analyze",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              jobId: newJobId,
              videoDuration: duration,
              options: {
                bgm,
                captionColor,
                numClips,
                audioLanguage:
                  videoLanguage,
                captionLanguage,
                framing,
              },
            }),
          }
        );

      if (!analyzeResponse.ok) {
        const data =
          await analyzeResponse
            .json()
            .catch(() => ({}));

        throw new Error(
          data.error ||
            "Could not start AI analysis."
        );
      }

      setStatus({
        jobId: newJobId,
        status: "detecting_hooks",
        progress: 40,
        message:
          "AI is finding complete hooks..."
      });

      /*
       * Wait specifically for hook detection.
       */
      let analysisStatus:
        | JobStatus
        | null = null;

      for (;;) {
        const response =
          await fetch(
            `/api/status/${encodeURIComponent(
              newJobId
            )}`,
            {
              cache: "no-store",
            }
          );

        if (!response.ok) {
          throw new Error(
            "Unable to read AI analysis status."
          );
        }

        const data =
          (await response.json()) as JobStatus;

        analysisStatus = data;

        if (data.status === "error") {
          throw new Error(
            data.error ||
              data.message ||
              "AI analysis failed."
          );
        }

        if (
          Array.isArray(data.clips) &&
          data.clips.length > 0
        ) {
          break;
        }

        setStatus(data);

        await new Promise(
          (resolve) =>
            setTimeout(resolve, 1800)
        );
      }

      const segments =
        (analysisStatus?.clips || [])
          .filter(
            (clip) =>
              Number.isFinite(
                clip.startTime
              ) &&
              Number.isFinite(
                clip.endTime
              ) &&
              clip.endTime >
                clip.startTime
          )
          .map((clip) => ({
            index: clip.index,
            title: clip.title,
            hookReason:
              clip.hookReason,
            startTime:
              clip.startTime,
            endTime:
              clip.endTime,
          }));

      if (!segments.length) {
        throw new Error(
          "AI could not find usable hooks in this video."
        );
      }

      /*
       * STEP 5
       * Trim ONLY selected hooks locally.
       */
      const uploadedSegments: typeof segments =
        [];
      const uploadedHookFiles: File[] = [];

      for (
        let i = 0;
        i < segments.length;
        i++
      ) {
        const segment =
          segments[i];

        const baseProgress =
          50 +
          (i /
            segments.length) *
            25;

        setStatus({
          jobId: newJobId,
          status: "rendering",
          progress: Math.round(
            baseProgress
          ),
          message:
            `Preparing hook ${i + 1} of ${segments.length} on your device...`
        });

        const hookFile =
          await trimVideoForUpload(
            file,
            segment.startTime,
            segment.endTime,
            (value: number) => {
              const progress =
                50 +
                ((i + value) /
                  segments.length) *
                  20;

              setUploadProgress(
                Math.max(
                  uploadProgressRef.current,
                  Math.round(
                    progress
                  )
                )
              );

              uploadProgressRef.current =
                Math.max(
                  uploadProgressRef.current,
                  Math.round(
                    progress
                  )
                );
            }
          );

        const clipUploadUrl =
          `${workerBase}/upload-clip/${encodeURIComponent(
            newJobId
          )}/${i + 1}`;

        await uploadChunks(
          clipUploadUrl,
          hookFile,
          50 +
            (i /
              segments.length) *
              20,
          50 +
            ((i + 1) /
              segments.length) *
              20
        );

        uploadedSegments.push(
          segment
        );
        uploadedHookFiles.push(hookFile);
      }

      /*
       * STEP 6
       * Render only the small selected clips.
       */
      setStatus({
        jobId: newJobId,
        status: "rendering",
        progress: 75,
        message:
          "Rendering your selected clips..."
      });

      let workerInstanceId = "";

      try {
        const healthResponse = await fetch(
          workerBase + "/health",
          { cache: "no-store" }
        );
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          workerInstanceId = String(healthData.instanceId || "");
        }
      } catch (healthError) {
        console.warn("Worker health check before render failed:", healthError);
      }

      const renderResponse =
        await fetch(
          "/api/render-selected",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              jobId: newJobId,
              selectedSegments:
                uploadedSegments,
              options: {
                bgm,
                captionColor,
                numClips,
                audioLanguage:
                  videoLanguage,
                captionLanguage,
                framing,
              },
            }),
          }
        );

      if (!renderResponse.ok) {
        const data =
          await renderResponse
            .json()
            .catch(() => ({}));

        throw new Error(
          data.error ||
            "Could not start final rendering."
        );
      }

      highestProgressRef.current =
        75;

      terminalStatusRef.current =
        false;

      setStatus({
        jobId: newJobId,
        status: "rendering",
        progress: 75,
        message:
          "Rendering captions and final clips..."
      });

      setUploadProgress(75);

      startPolling(newJobId);

      let recoveryAttempts = 0;

      renderWatchdogRef.current = window.setInterval(async () => {
        if (terminalStatusRef.current || recoveryAttempts >= 2) {
          return;
        }

        try {
          const healthResponse = await fetch(
            workerBase + "/health",
            { cache: "no-store" }
          );

          if (!healthResponse.ok) return;

          const healthData = await healthResponse.json();
          const currentInstanceId = String(
            healthData.instanceId || ""
          );

          if (
            !workerInstanceId ||
            !currentInstanceId ||
            currentInstanceId === workerInstanceId
          ) {
            return;
          }

          recoveryAttempts += 1;
          workerInstanceId = currentInstanceId;

          setStatus({
            jobId: newJobId,
            status: "rendering",
            progress: 75,
            message:
              "Render worker restarted. Rebuilding your clips automatically..."
          });

          for (
            let i = 0;
            i < uploadedHookFiles.length;
            i++
          ) {
            await uploadChunks(
              workerBase +
                "/upload-clip/" +
                encodeURIComponent(newJobId) +
                "/" +
                (i + 1),
              uploadedHookFiles[i],
              75,
              75
            );
          }

          const retryResponse = await fetch(
            "/api/render-selected",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                jobId: newJobId,
                selectedSegments: uploadedSegments,
                options: {
                  bgm,
                  captionColor,
                  numClips,
                  audioLanguage: videoLanguage,
                  captionLanguage,
                  framing,
                },
              }),
            }
          );

          if (!retryResponse.ok) {
            const data = await retryResponse
              .json()
              .catch(() => ({}));
            throw new Error(
              data.error ||
                "Automatic render recovery failed."
            );
          }
        } catch (recoveryError) {
          console.error(
            "Automatic render recovery failed:",
            recoveryError
          );
        }
      }, 10000);
    } catch (err) {
      console.error(err);

      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";

      setError(message);

      setStatus((current) =>
        current
          ? {
              ...current,
              status: "error",
              error: message,
            }
          : {
              jobId:
                jobId ||
                "",
              status: "error",
              progress: 0,
              error: message,
            }
      );

      stopPolling();
    }
  };


  const copyTimestamps = async (
    clip: ClipResult
  ) => {
    try {
      await navigator.clipboard.writeText(
        `${clip.title}
${timeRange(
          clip.startTime,
          clip.endTime
        )}`
      );

      setCopied(clip.index);

      setTimeout(() => {
        setCopied((current) =>
          current === clip.index
            ? null
            : current
        );
      }, 1800);
    } catch {
      setError(
        "Could not copy the timestamp."
      );
    }
  };

  const startOver = () => {
    cancelRequestedRef.current = true;
    stopPolling();

    setFile(null);
    setJobId("");
    setStatus(null);
    uploadProgressRef.current = 0;
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadEta(0);
    uploadStatsRef.current = { startedAt: 0, lastSampleAt: 0, lastSampleBytes: 0, samples: [] };
    setError("");
    setCopied(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const removeFile = () => {
    cancelRequestedRef.current = true;
    stopPolling();
    setFile(null);
    setStatus(null);
    setJobId("");
    uploadProgressRef.current = 0;
    setUploadProgress(0);
    setError("");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#030303] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute left-[-220px] top-[-220px] h-[650px] w-[650px] rounded-full blur-[150px]"
          style={{
            background:
              "radial-gradient(circle, rgba(247,208,2,.13), transparent 68%)",
          }}
        />

        <div
          className="absolute right-[-220px] top-[12%] h-[600px] w-[600px] rounded-full blur-[160px]"
          style={{
            background:
              "radial-gradient(circle, rgba(240,6,153,.09), transparent 68%)",
          }}
        />

        <div
          className="absolute bottom-[-260px] left-[28%] h-[600px] w-[600px] rounded-full blur-[170px]"
          style={{
            background:
              "radial-gradient(circle, rgba(247,208,2,.06), transparent 68%)",
          }}
        />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,.25)_55%,rgba(0,0,0,.72)_100%)]" />

        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 lg:px-7">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between rounded-[30px] border border-white/[0.09] bg-black/55 px-4 py-3 shadow-[0_25px_90px_rgba(0,0,0,.45)] backdrop-blur-3xl sm:px-6">
          <a
            href="#top"
            className="group flex items-center gap-3"
          >
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[15px] border border-[#F7D002]/30 bg-[#F7D002]/[0.08] shadow-[0_0_35px_rgba(247,208,2,.12)]">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent" />
              <span className="relative text-base font-black text-[#F7D002]">
                C
              </span>
            </div>

            <div>
              <div className="text-sm font-black uppercase tracking-[0.24em]">
                CAPTIFYY
              </div>

              <div className="hidden text-[8px] font-semibold uppercase tracking-[0.28em] text-white/30 sm:block">
                AI Caption Studio
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-1 md:flex">
            <a
              href="/about"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              About
            </a>

            <a
              href="#how-it-works"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              How it works
            </a>

            <a
              href="/support"
              className="rounded-full px-4 py-2.5 text-sm font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              Support
            </a>

            <a
              href="#studio"
              className="ml-2 rounded-full border border-[#F7D002]/25 bg-[#F7D002]/[0.10] px-5 py-2.5 text-sm font-bold text-[#F7D002] transition hover:border-[#F7D002]/45 hover:bg-[#F7D002]/[0.16]"
            >
              Open Studio
            </a>
          </nav>

          <a
            href="#studio"
            className="rounded-full border border-[#F7D002]/25 bg-[#F7D002]/[0.10] px-4 py-2 text-xs font-bold text-[#F7D002] md:hidden"
          >
            Studio
          </a>
        </div>
      </header>

      <div
        id="top"
        className="mx-auto max-w-[1480px] px-4 pb-28 pt-12 sm:px-6 sm:pt-20 lg:px-8"
      >
        {/* Premium creator hero */}
        <section className="relative mb-14">
          <div className="absolute -left-20 top-10 h-32 w-32 rounded-full bg-[#F7D002]/10 blur-[80px]" />

          <div className="relative grid gap-10 lg:grid-cols-[1.4fr_.6fr] lg:items-end">
            <div>
              <div className="mb-6 flex items-center gap-3">
                <span className="h-px w-10 bg-[#F7D002]/60" />

                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#F7D002]">
                  Independent creator studio
                </span>
              </div>

              <h1 className="max-w-6xl text-[13vw] font-black uppercase leading-[0.78] tracking-[-0.075em] sm:text-7xl lg:text-[105px] xl:text-[120px]">
                <span className="block text-white">
                  MADE BY
                </span>

                <span
                  className="block bg-gradient-to-r from-white via-[#F7D002] to-[#F00699] bg-clip-text text-transparent"
                  style={{
                    WebkitBackgroundClip:
                      "text",
                  }}
                >
                  SHIVRAJ
                </span>

                <span className="block text-white/90">
                  KUMAR
                </span>
              </h1>

              <div className="mt-8 flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.28em] text-[#F7D002]">
                    CAPTIFYY - AI CAPTION STUDIO
                  </p>

                  <p className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    Your videos. Captions, perfected.
                  </p>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/40 sm:text-base">
                    Turn speech into polished captions and
                    intelligent short clips with a workflow
                    designed around your content.
                  </p>
                </div>
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="ml-auto max-w-[310px] rounded-[28px] border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/25">
                    CAPTIFYY SYSTEM
                  </span>

                  <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.15em] text-[#F7D002]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#F7D002] shadow-[0_0_12px_#F7D002]" />
                    Online
                  </span>
                </div>

                <div className="mt-6 space-y-3">
                  <MiniStat
                    label="Speech intelligence"
                    value="AI"
                  />

                  <MiniStat
                    label="Caption languages"
                    value="EN - HI - HING"
                  />

                  <MiniStat
                    label="Clip generation"
                    value="1 - 7"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Studio */}
        <section
          id="studio"
          className="scroll-mt-28"
        >
          <div className="grid gap-5 lg:grid-cols-[1.42fr_.68fr]">
            {/* Main studio */}
            <div className="relative overflow-hidden rounded-[36px] border border-white/[0.10] bg-white/[0.045] shadow-[0_40px_130px_rgba(0,0,0,.48)] backdrop-blur-3xl">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,.075),transparent_24%,transparent_72%,rgba(247,208,2,.035))]" />

              <div className="relative p-5 sm:p-7 lg:p-9">
                {/* Studio header */}
                <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#F7D002]/20 bg-[#F7D002]/[0.08] text-[#F7D002]">
                        <Icon
                          name="spark"
                          size={17}
                        />
                      </div>

                      <span className="text-[10px] font-black uppercase tracking-[0.24em] text-white/40">
                        Creation studio
                      </span>
                    </div>

                    <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                      Start with your media
                    </h2>

                    <p className="mt-1.5 text-sm text-white/35">
                    MP3, WAV, MP4 or MKV - maximum 3 GB
                    </p>
                  </div>

                  <div className="flex w-fit items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3.5 py-2.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                    <Icon
                      name="shield"
                      size={13}
                    />
                    Secure workflow
                  </div>
                </div>

                {/* Upload */}
                {!file ? (
                  <div
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={handleDrop}
                    onClick={() =>
                      inputRef.current?.click()
                    }
                    className={`group relative flex min-h-[330px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[30px] border border-dashed px-6 text-center transition duration-500 ${
                      isDragging
                        ? "scale-[1.01] border-[#F7D002]/70 bg-[#F7D002]/[0.08]"
                        : "border-white/[0.13] bg-black/[0.18] hover:border-[#F7D002]/35 hover:bg-white/[0.025]"
                    }`}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(247,208,2,.10),transparent_40%)] opacity-70 transition duration-500 group-hover:opacity-100" />

                    <div className="absolute left-8 top-8 h-2 w-2 rounded-full bg-white/20" />
                    <div className="absolute right-10 top-12 h-1.5 w-1.5 rounded-full bg-[#F7D002]/60" />
                    <div className="absolute bottom-10 left-16 h-1.5 w-1.5 rounded-full bg-[#F00699]/50" />

                    <div className="relative mb-7 flex h-20 w-20 items-center justify-center rounded-[27px] border border-white/[0.10] bg-white/[0.055] text-[#F7D002] shadow-[0_20px_70px_rgba(0,0,0,.4)] backdrop-blur-xl transition duration-500 group-hover:-translate-y-1 group-hover:scale-105 group-hover:border-[#F7D002]/30">
                      <div className="absolute inset-2 rounded-[21px] border border-[#F7D002]/10" />
                      <Icon
                        name="upload"
                        size={30}
                      />
                    </div>

                    <div className="relative">
                      <h3 className="text-xl font-bold">
                        Drop your video here
                      </h3>

                      <p className="mt-2 text-sm text-white/35">
                        or click anywhere to browse your device
                      </p>

                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {[
                          "MP4",
                          "MKV",
                          "MP3",
                          "WAV",
                        ].map((format) => (
                          <span
                            key={format}
                            className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-[9px] font-black tracking-[0.16em] text-white/35"
                          >
                            {format}
                          </span>
                        ))}
                      </div>
                    </div>

                    <input
                      ref={inputRef}
                      type="file"
                      accept=".mp3,.wav,.mp4,.mkv,audio/mpeg,audio/wav,video/mp4,video/x-matroska"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                ) : (
                  <div className="rounded-[30px] border border-white/[0.10] bg-black/[0.20] p-5">
                    {isProcessing && (
                      <button
                        type="button"
                        onClick={startOver}
                        className="mb-4 flex min-h-14 w-full items-center justify-center rounded-2xl border-2 border-[#F7D002]/60 bg-[#F7D002] px-6 py-3 text-sm font-black uppercase tracking-[0.18em] text-black shadow-[0_0_28px_rgba(247,208,2,.32)] transition hover:scale-[1.01] hover:shadow-[0_0_38px_rgba(247,208,2,.48)] active:scale-[0.99] sm:ml-auto sm:w-auto sm:min-w-[150px]"
                      >
                        <span className="drop-shadow-[0_0_8px_rgba(0,0,0,.25)]">
                          Cancel
                        </span>
                      </button>
                    )}
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[22px] border border-[#F7D002]/20 bg-[#F7D002]/[0.07] text-[#F7D002]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(247,208,2,.18),transparent_65%)]" />
                        <Icon
                          name="film"
                          size={30}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-bold sm:text-lg">
                              {file.name}
                            </h3>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/35">
                              <span>
                                {formatFileSize(
                                  file.size
                                )}
                              </span>

                              <span>-</span>

                              <span>
                                {getExtension(
                                  file.name
                                ).toUpperCase()}
                              </span>

                              <span>-</span>

                              <span className="text-[#F7D002]/70">
                                Ready for AI
                              </span>
                            </div>
                          </div>

                          {!isProcessing &&
                            !isDone && (
                              <button
                                type="button"
                                onClick={
                                  removeFile
                                }
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.035] text-white/35 transition hover:border-white/20 hover:text-white"
                                aria-label="Remove file"
                              >
                                <Icon
                                  name="close"
                                  size={15}
                                />
                              </button>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="relative mt-4 overflow-hidden rounded-2xl border border-red-400/30 bg-red-400/[0.06] px-4 py-3.5 text-sm text-red-200 shadow-[0_0_28px_rgba(248,113,113,.16)]">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_50%,rgba(248,113,113,.12),transparent_48%)]" />
                    <div className="relative flex items-start gap-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,.9)]" />
                      <span className="leading-6">{error}</span>
                    </div>
                  </div>
                )}

                {/* Primary controls */}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <GlassSelect
                    label="Video language"
                    value={videoLanguage}
                    onChange={setVideoLanguage}
                    options={VIDEO_LANGUAGES}
                    disabled={isProcessing}
                  />

                  <GlassSelect
                    label="Caption language"
                    value={captionLanguage}
                    onChange={setCaptionLanguage}
                    options={CAPTION_LANGUAGES}
                    disabled={isProcessing}
                  />
                </div>

                {/* Clip slider */}
                <div className="mt-3 rounded-[24px] border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F7D002]/10 text-[#F7D002]">
                          <Icon
                            name="layers"
                            size={14}
                          />
                        </span>

                        <p className="text-sm font-bold">
                          Number of clips
                        </p>
                      </div>

                      <p className="mt-2 text-xs leading-5 text-white/30">
                        Choose how many AI-selected clips
                        CAPTIFYY should generate.
                      </p>
                    </div>

                    <div className="shrink-0 rounded-2xl border border-[#F7D002]/25 bg-[#F7D002]/[0.08] px-4 py-2.5 text-right">
                      <div className="text-2xl font-black leading-none text-[#F7D002]">
                        {numClips}
                      </div>

                      <div className="mt-1 text-[8px] font-black uppercase tracking-[0.18em] text-[#F7D002]/50">
                        {numClips === 1
                          ? "Clip"
                          : "Clips"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <input
                      type="range"
                      min={1}
                      max={7}
                      step={1}
                      value={numClips}
                      onChange={(event) =>
                        setNumClips(
                          Number(
                            event.target.value
                          )
                        )
                      }
                      disabled={isProcessing}
                      aria-label="Number of clips"
                      className="captify-range h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[0.10] accent-[#F7D002] disabled:cursor-not-allowed disabled:opacity-40"
                    />

                    <div className="mt-4 flex justify-between">
                      {[
                        1, 2, 3, 4, 5, 6, 7,
                      ].map((value: number) => (
                        <button
                          key={value}
                          type="button"
                          disabled={isProcessing}
                          onClick={() =>
                            setNumClips(
                              value
                            )
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black transition ${
                            numClips === value
                              ? "bg-[#F7D002] text-black shadow-[0_0_18px_rgba(247,208,2,.20)]"
                              : "text-white/25 hover:bg-white/[0.06] hover:text-white/60"
                          } disabled:cursor-not-allowed`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4 text-[9px] font-black uppercase tracking-[0.15em] text-white/20">
                    <span>Minimum - 1 clip</span>
                    <span>Maximum - 7 clips</span>
                  </div>
                </div>

                {/* Framing */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <GlassSelect
                    label="Framing"
                    value={framing}
                    onChange={(value: string) =>
                      setFraming(
                        value as
                          | "fill"
                          | "fit"
                      )
                    }
                    options={[
                      {
                        name: "Fill Blurred",
                        value: "fill",
                      },
                      {
                        name: "Fit frame",
                        value: "fit",
                      },
                    ]}
                    disabled={isProcessing}
                  />

                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                    <div className="flex h-full items-center justify-between gap-3">
                      <div>
                        <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-white/25">
                          Output
                        </span>

                        <span className="mt-1 block text-sm font-semibold text-white/65">
                          AI captioned clips
                        </span>
                      </div>

                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F00699]/10 text-[#F00699]">
                        <Icon
                          name="captions"
                          size={16}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Advanced styling */}
                <div className="mt-3 rounded-[24px] border border-white/[0.07] bg-black/[0.12]">
                  <button
                    type="button"
                    onClick={() =>
                      setShowAdvanced(
                        (value: boolean) => !value
                      )
                    }
                    className="flex w-full items-center justify-between px-5 py-4 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white/75">
                        Advanced styling
                      </p>

                      <p className="mt-0.5 text-xs text-white/30">
                        Music, caption color and
                        output details
                      </p>
                    </div>

                    <span
                      className={`text-white/35 transition duration-300 ${
                        showAdvanced
                          ? "rotate-180"
                          : ""
                      }`}
                    >
                      <Icon
                        name="chevron"
                        size={17}
                      />
                    </span>
                  </button>

                  {showAdvanced && (
                    <div className="grid gap-4 border-t border-white/[0.06] p-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F00699]/10 text-[#F00699]">
                              <Icon
                                name="music"
                                size={17}
                              />
                            </div>

                            <div>
                              <p className="text-sm font-semibold">
                                Background music
                              </p>

                              <p className="text-[11px] text-white/30">
                                Smart audio ducking
                              </p>
                            </div>
                          </div>

                          <Toggle
                            enabled={bgm}
                            onChange={setBgm}
                            disabled={
                              isProcessing
                            }
                          />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">
                              Caption color
                            </p>

                            <p className="text-[11px] text-white/30">
                              Choose your accent
                            </p>
                          </div>

                          <div
                            className="h-5 w-5 rounded-full border border-white/20 shadow-[0_0_15px_rgba(255,255,255,.05)]"
                            style={{
                              backgroundColor:
                                captionColor,
                            }}
                          />
                        </div>

                        <div className="flex gap-2">
                          {CAPTION_COLORS.map(
                            (color) => (
                              <button
                                key={
                                  color.value
                                }
                                type="button"
                                title={
                                  color.name
                                }
                                disabled={
                                  isProcessing
                                }
                                onClick={() =>
                                  setCaptionColor(
                                    color.value
                                  )
                                }
                                className={`relative h-7 w-7 rounded-full border transition hover:scale-110 disabled:cursor-not-allowed ${
                                  captionColor ===
                                  color.value
                                    ? "border-white ring-2 ring-white/20"
                                    : "border-white/10"
                                }`}
                                style={{
                                  backgroundColor:
                                    color.value,
                                }}
                              >
                                {captionColor ===
                                  color.value && (
                                  <span className="absolute inset-0 flex items-center justify-center text-black">
                                    <Icon
                                      name="check"
                                      size={13}
                                    />
                                  </span>
                                )}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* CTA */}
                {!isDone && (
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={
                      !file || isProcessing
                    }
                    className="group relative mt-5 flex w-full items-center justify-center gap-3 overflow-hidden rounded-[23px] border border-[#F7D002]/30 bg-[#F7D002] px-6 py-4.5 text-sm font-black uppercase tracking-[0.16em] text-black shadow-[0_15px_55px_rgba(247,208,2,.12)] transition duration-300 hover:scale-[1.005] hover:shadow-[0_20px_75px_rgba(247,208,2,.22)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition duration-700 group-hover:translate-x-full" />

                    <span className="relative flex items-center gap-3">
                      <Icon
                        name={
                          isProcessing
                            ? "zap"
                            : "spark"
                        }
                        size={18}
                      />

                      {isProcessing
                        ? "CAPTIFYY IS WORKING"
                        : `CREATE ${numClips} ${
                            numClips === 1
                              ? "CLIP"
                              : "CLIPS"
                          }`}
                    </span>
                  </button>
                )}


              </div>
            </div>

          {/* Intelligence card */}
            <aside className="relative overflow-hidden rounded-[36px] border border-white/[0.09] bg-white/[0.035] p-6 shadow-[0_30px_110px_rgba(0,0,0,.38)] backdrop-blur-3xl lg:p-7">
              <div className="absolute right-[-120px] top-[-120px] h-[300px] w-[300px] rounded-full bg-[#F7D002]/[0.06] blur-[90px]" />

              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F7D002]/20 bg-[#F7D002]/[0.08] text-[#F7D002]">
                    <Icon
                      name="wand"
                      size={22}
                    />
                  </div>

                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">
                    AI FLOW
                  </span>
                </div>

                <p className="mt-8 text-[10px] font-black uppercase tracking-[0.22em] text-[#F7D002]">
                  The CAPTIFYY workflow
                </p>

                <h3 className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">
                  From raw speech
                  <br />
                  to polished clips.
                </h3>

                <p className="mt-3 text-sm leading-6 text-white/35">
                  CAPTIFYY analyzes your media, finds
                  engaging moments and builds captioned
                  clips automatically.
                </p>

                <div className="my-7 h-px bg-white/[0.07]" />

                <WorkflowStep
                  number="01"
                  icon="upload"
                  title="Upload"
                  description="Give CAPTIFYY your video or audio."
                />

                <WorkflowStep
                  number="02"
                  icon="captions"
                  title="Understand"
                  description="Speech is transcribed with timing."
                />

                <WorkflowStep
                  number="03"
                  icon="spark"
                  title="Find hooks"
                  description="Interesting moments are selected."
                />

                <WorkflowStep
                  number="04"
                  icon="film"
                  title="Render"
                  description="Your final captioned clips are created."
                  last
                />
              </div>
            </aside>
          </div>
        </section>

        {/* Processing */}
        {isProcessing && (
          <section className="mt-5">
            <div className="relative overflow-hidden rounded-[34px] border border-[#F7D002]/15 bg-white/[0.035] p-6 shadow-[0_30px_100px_rgba(0,0,0,.35)] backdrop-blur-3xl sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_50%,rgba(247,208,2,.07),transparent_35%)]" />

              <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
                <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full border border-[#F7D002]/10" />
                  <div className="absolute inset-2 rounded-full border border-[#F7D002]/20" />
                  <div className="absolute inset-5 rounded-full bg-[#F7D002]/10 shadow-[0_0_50px_rgba(247,208,2,.18)]" />

                  <div className="relative text-[#F7D002]">
                    <Icon
                      name="spark"
                      size={26}
                    />
                  </div>
                </div>

                <div className="flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">
                        {getStatusLabel(
                          status?.status ||
                            "queued"
                        )}
                      </p>

                      <h3 className="mt-1 text-xl font-bold">
                        CAPTIFYY is creating your clips
                      </h3>
                    </div>

                    <span className="text-2xl font-black text-white/80">
                      {Math.round(
                        progress
                      )}
                      %
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-white/35">
                    {status?.status === "rendering" &&
                    renderClipNumber &&
                    renderClipTotal
                      ? `Rendering clip ${renderClipNumber} of ${renderClipTotal}`
                      : status?.message ||
                        "Preparing your media..."}
                  </p>

                  {status?.status === "rendering" &&
                    renderClipNumber &&
                    renderClipTotal && (
                      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/[0.18] px-4 py-3">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs font-bold text-white/65">
                            Clip {renderClipNumber} of {renderClipTotal}
                          </span>
                          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#F7D002]">
                            Rendering
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] text-white/30">
                          {renderEta
                            ? `Estimated time remaining: ${formatTime(renderEta)}`
                            : "Calculating remaining time..."}
                        </p>
                      </div>
                    )}

                  {(uploadSpeed > 0 || uploadEta > 0) && (
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.07] bg-black/[0.18] p-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/20">
                        Approx. speed
                      </p>
                      <p className="mt-1 text-xs font-bold text-white/65">
                        {formatMbps(uploadSpeed)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/20">
                        Time remaining
                      </p>
                      <p className="mt-1 text-xs font-bold text-white/65">
                        {formatEta(uploadEta)}
                      </p>
                    </div>
                  </div>

                  )}


                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className="relative h-full rounded-full bg-[#F7D002] transition-all duration-700"
                      style={{
                        width: `${progress}%`,
                      }}
                    >
                      <span className="absolute inset-y-0 right-0 w-20 bg-gradient-to-r from-transparent to-white/50 blur-sm" />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.12em] text-white/20">
                    <span>AI analysis</span>
                    <span>Clip rendering</span>
                    <span>Almost there</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Results */}
        {isDone &&
          status?.clips && (
            <section className="mt-16 scroll-mt-28">
              <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#F7D002] shadow-[0_0_10px_#F7D002]" />
                    Finished
                  </div>

                  <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                    Your clips are ready.
                  </h2>

                  <p className="mt-2 text-sm text-white/35">
                    {status.clips.length} AI-selected{" "}
                    {status.clips.length === 1
                      ? "clip"
                      : "clips"}{" "}
                    generated from your media.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={startOver}
                  className="flex w-fit items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-4 py-2.5 text-xs font-bold text-white/55 transition hover:border-white/20 hover:text-white"
                >
                  <Icon
                    name="refresh"
                    size={14}
                  />
                  Start over
                </button>
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {status.clips.map(
                  (clip) => (
                    <article
                      key={clip.index}
                      className="group overflow-hidden rounded-[30px] border border-white/[0.09] bg-white/[0.035] shadow-[0_25px_80px_rgba(0,0,0,.3)] backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-white/[0.15]"
                    >
                      <div className="relative aspect-[9/16] overflow-hidden bg-black">
                        <video
                          src={
                            clip.previewUrl ||
                            clip.editedUrl
                          }
                          controls
                          preload="metadata"
                          className="h-full w-full object-contain captify-preview-video"
                        />

                        <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-white/70 backdrop-blur-xl">
                          Clip{" "}
                          {String(
                            clip.index + 1
                          ).padStart(
                            2,
                            "0"
                          )}
                        </div>
                      </div>

                      <div className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-bold">
                              {clip.title}
                            </h3>

                            <div className="mt-2 flex items-center gap-2 text-xs text-white/30">
                              <Icon
                                name="clock"
                                size={13}
                              />

                              {timeRange(
                                clip.startTime,
                                clip.endTime
                              )}

                              <span>
                                -
                              </span>

                              {clipLength(
                                clip.startTime,
                                clip.endTime
                              ).toFixed(1)}
                              s
                            </div>
                          </div>

                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F7D002]/[0.08] text-[#F7D002]">
                            <Icon
                              name="spark"
                              size={14}
                            />
                          </div>
                        </div>

                        {clip.hookReason && (
                          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/[0.16] p-3.5">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/20">
                              Why this moment
                            </p>

                            <p className="mt-1.5 text-xs leading-5 text-white/45">
                              {
                                clip.hookReason
                              }
                            </p>
                          </div>
                        )}

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <button
                             type="button"
                             onClick={() =>
                               downloadClip(
                                 clip.previewUrl ||
                                 clip.editedUrl,
                                 "captify-clip-" + (clip.index + 1) + ".mp4"
                               )
                             }
                             className="flex items-center justify-center gap-2 rounded-xl bg-[#F7D002] px-3 py-3 text-xs font-black uppercase tracking-[0.08em] text-black transition hover:brightness-105"
                           >
                             <Icon
                               name="download"
                               size={14}
                             />
                             Download
                           </button>

                          <button
                            type="button"
                            onClick={() =>
                              copyTimestamps(
                                clip
                              )
                            }
                            className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-3 text-xs font-bold text-white/50 transition hover:border-white/15 hover:text-white"
                          >
                            {copied ===
                            clip.index ? (
                              <>
                                <Icon
                                  name="check"
                                  size={14}
                                />
                                Copied
                              </>
                            ) : (
                              <>
                                <Icon
                                  name="copy"
                                  size={14}
                                />
                                Timestamp
                              </>
                            )}
                          </button>
                        </div>

                        {clip.rawUrl && (
                          <button
                             type="button"
                             onClick={() =>
                               downloadClip(
                                 clip.rawUrl,
                                 "captify-clip-" + (clip.index + 1) + "-raw.mp4"
                               )
                             }
                             className="mt-3 flex items-center justify-center gap-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/20 transition hover:text-white/50"
                           >
                             Download raw clip
                             <Icon
                               name="arrow"
                               size={12}
                             />
                           </button>
                        )}
                      </div>
                    </article>
                  )
                )}
              </div>
            </section>
          )}

        {/* Error */}
        {status?.status ===
          "error" && (
          <section className="mt-5">
            <div className="rounded-[30px] border border-red-400/15 bg-red-400/[0.05] p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-400/10 text-red-300">
                  <Icon
                    name="close"
                    size={18}
                  />
                </div>

                <div>
                  <h3 className="font-bold">
                    Processing stopped
                  </h3>

                  <p className="mt-1 text-sm leading-6 text-red-100/50">
                    {status.error ||
                      status.message ||
                      "CAPTIFYY could not finish this job."}
                  </p>

                  <button
                    type="button"
                    onClick={startOver}
                    className="mt-4 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/60 transition hover:text-white"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* How it works */}
        <section
          id="how-it-works"
          className="mt-28 scroll-mt-28 border-t border-white/[0.07] pt-16"
        >
          <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#F7D002]">
                How it works
              </p>

              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
                One upload.
                <br />
                Multiple polished moments.
              </h2>
            </div>

            <p className="max-w-xl text-sm leading-6 text-white/35 sm:text-base">
              CAPTIFYY handles the repetitive work so
              you can focus on the content. Upload,
              choose your preferences and let the
              processing pipeline handle the rest.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon="layers"
              number="01"
              title="Understand"
              description="Your speech is converted into a timed transcript ready for intelligent analysis."
            />

            <FeatureCard
              icon="spark"
              number="02"
              title="Discover"
              description="CAPTIFYY looks for moments that can work as engaging short-form clips."
            />

            <FeatureCard
              icon="captions"
              number="03"
              title="Polish"
              description="Captions, audio treatment and clip rendering turn the selected moments into usable outputs."
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-24 border-t border-white/[0.07] pt-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em]">
                CAPTIFYY
              </p>

              <p className="mt-1 text-xs text-white/25">
                Your videos. Captions, perfected.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-5 text-xs text-white/30">
              <a
                href="/about"
                className="transition hover:text-white"
              >
                About
              </a>

              <a
                href="#how-it-works"
                className="transition hover:text-white"
              >
                How it works
              </a>

              <a
                href="/support"
                className="transition hover:text-white"
              >
                Support
              </a>

              <span className="text-white/10">
                |
              </span>

              <span className="font-semibold tracking-wide">
                MADE BY SHIVRAJ KUMAR
              </span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

function GlassSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: {
    name: string;
    value: string;
  }[];
  disabled?: boolean;
}) {
  return (
    <label className="group relative block">
      <span className="mb-2 block px-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/25">
        {label}
      </span>

      <div className="relative">
        <select
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          disabled={disabled}
          className="w-full appearance-none rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3.5 pr-10 text-sm font-semibold text-white/75 outline-none transition hover:border-white/[0.14] focus:border-[#F7D002]/30 focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {options.map(
            (option) => (
              <option
                key={option.value}
                value={option.value}
                className="bg-[#111111] text-white"
              >
                {option.name}
              </option>
            )
          )}
        </select>

        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/25">
          <Icon
            name="chevron"
            size={15}
          />
        </span>
      </div>
    </label>
  );
}

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() =>
        onChange(!enabled)
      }
      className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
        enabled
          ? "border-[#F7D002]/30 bg-[#F7D002]/20"
          : "border-white/10 bg-white/[0.04]"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full transition-all ${
          enabled
            ? "left-[25px] bg-[#F7D002] shadow-[0_0_15px_rgba(247,208,2,.35)]"
            : "left-1 bg-white/30"
        }`}
      />
    </button>
  );
}

function WorkflowStep({
  number,
  icon,
  title,
  description,
  last = false,
}: {
  number: string;
  icon:
    | "upload"
    | "captions"
    | "spark"
    | "film";
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-4">
      {!last && (
        <div className="absolute left-[18px] top-[40px] h-[calc(100%-18px)] w-px bg-gradient-to-b from-white/[0.12] to-transparent" />
      )}

      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-[#F7D002]">
        <Icon
          name={icon}
          size={15}
        />
      </div>

      <div className="pb-6">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black tracking-[0.12em] text-white/20">
            {number}
          </span>

          <h4 className="text-sm font-bold">
            {title}
          </h4>
        </div>

        <p className="mt-1 text-xs leading-5 text-white/30">
          {description}
        </p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  number,
  title,
  description,
}: {
  icon:
    | "layers"
    | "spark"
    | "captions";
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-white/[0.14]">
      <div className="absolute right-[-60px] top-[-60px] h-40 w-40 rounded-full bg-[#F7D002]/[0.04] blur-3xl transition group-hover:bg-[#F7D002]/[0.07]" />

      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#F7D002]/15 bg-[#F7D002]/[0.07] text-[#F7D002]">
            <Icon
              name={icon}
              size={19}
            />
          </div>

          <span className="text-[10px] font-black tracking-[0.2em] text-white/15">
            {number}
          </span>
        </div>

        <h3 className="mt-7 text-xl font-bold">
          {title}
        </h3>

        <p className="mt-2 text-sm leading-6 text-white/35">
          {description}
        </p>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/25">
        {label}
      </span>

      <span className="text-[9px] font-black tracking-[0.12em] text-white/60">
        {value}
      </span>
    </div>
  );
}



