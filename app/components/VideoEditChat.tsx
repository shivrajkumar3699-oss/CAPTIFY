"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type EditPlan = {
  reply: string;
  edits: {
    logoPosition: string | null;
    logoSize: string | null;
    captionColor: string | null;
    framing: "fill" | "fit" | "fit-black" | null;
    notes: string[];
  };
};

type AppliedEdits = EditPlan["edits"] & {
  logoId: string | null;
  logoPosition: string | null;
  logoSize: string | null;
};

const LOGO_MAX_BYTES = 100 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_POSITIONS = [
  { label: "Top right", value: "top-right" },
  { label: "Top center", value: "top-center" },
  { label: "Top left", value: "top-left" },
  { label: "Bottom right", value: "bottom-right" },
  { label: "Bottom center", value: "bottom-center" },
  { label: "Bottom left", value: "bottom-left" },
];

export default function VideoEditChat({
  onApply,
}: {
  onApply: (edits: AppliedEdits) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [logoId, setLogoId] = useState<string | null>(null);
  const [logoName, setLogoName] = useState("");
  const [logoPosition, setLogoPosition] = useState("top-right");
  const [logoSize, setLogoSize] = useState("small");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = message.trim();
    if (!request || busy) return;
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const response = await fetch("/api/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: request }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Couldn't understand that edit.");
      setPlan(data as EditPlan);
      if (data?.edits?.logoPosition && LOGO_POSITIONS.some((item) => item.value === data.edits.logoPosition)) {
        setLogoPosition(data.edits.logoPosition);
      }
      if (["small", "medium", "large"].includes(data?.edits?.logoSize)) {
        setLogoSize(data.edits.logoSize);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Editing assistant is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLogoError("");
    if (!LOGO_TYPES.has(file.type)) {
      setLogoError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size <= 0 || file.size > LOGO_MAX_BYTES) {
      setLogoError("Logo image must be larger than 0 bytes and no more than 100 MB.");
      return;
    }

    setLogoUploading(true);
    setLogoId(null);
    setLogoName("");
    try {
      const id = crypto.randomUUID();
      const ticketResponse = await fetch("/api/logo-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoId: id,
          contentType: file.type,
          size: file.size,
        }),
      });
      const ticket = await ticketResponse.json().catch(() => ({}));
      if (!ticketResponse.ok) throw new Error(ticket.error || "Could not prepare the logo upload.");
      if (typeof ticket.uploadUrl !== "string" || typeof ticket.uploadToken !== "string") {
        throw new Error("The secure upload link was invalid. Please try again.");
      }

      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "x-logo-upload-token": ticket.uploadToken,
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Logo upload failed.");
      setLogoId(String(data.logoId || id));
      setLogoName(file.name);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Logo upload failed. Please try again.");
    } finally {
      setLogoUploading(false);
    }
  }

  return (
    <section className="mt-8 rounded-[28px] border border-[#F7D002]/15 bg-white/[0.025] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#F7D002]/10 text-lg text-[#F7D002]">✦</div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">AI Video Director</p>
          <h2 className="mt-1 text-lg font-bold">Tell CAPTIFY what to change</h2>
          <p className="mt-1 text-xs leading-5 text-white/40">Short replies, compact edit plans, and actual FFmpeg logo overlays. No OpenAI key required.</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 2000))}
          maxLength={2000}
          rows={2}
          placeholder="Example: Keep the full video visible and use white captions."
          className="min-h-14 flex-1 resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#F7D002]/30"
          aria-label="Describe video edits"
        />
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="rounded-2xl bg-[#F7D002] px-5 py-3 text-sm font-black text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Understand"}
        </button>
      </form>

      <div className="mt-2 text-right text-[10px] text-white/25">{message.length}/2000</div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-5 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
        <p className="text-xs font-bold text-white">Logo overlay</p>
        <p className="mt-1 text-[11px] leading-5 text-white/40">PNG, JPEG or WebP · maximum 100 MB. The logo is burned into the final rendered clip.</p>
        <label className="mt-3 inline-flex cursor-pointer items-center rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/80 hover:border-[#F7D002]/30">
          {logoUploading ? "Uploading logo…" : logoName ? "Replace logo" : "Upload logo"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} disabled={logoUploading} className="sr-only" />
        </label>
        {logoId && <p className="mt-2 text-xs text-emerald-300">Ready: {logoName}</p>}
        {logoError && <p role="alert" className="mt-2 text-xs text-red-300">{logoError}</p>}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-[10px] font-bold uppercase tracking-wide text-white/45">
            Position
            <select value={logoPosition} onChange={(event) => setLogoPosition(event.target.value)} className="mt-1 block w-full rounded-xl border border-white/10 bg-[#151515] px-3 py-2.5 text-sm normal-case tracking-normal text-white">
              {LOGO_POSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-white/45">
            Size
            <select value={logoSize} onChange={(event) => setLogoSize(event.target.value)} className="mt-1 block w-full rounded-xl border border-white/10 bg-[#151515] px-3 py-2.5 text-sm normal-case tracking-normal text-white">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
        </div>
      </div>

      {plan && (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
          <p className="text-sm font-bold text-white">{plan.reply || "I got you."}</p>
          {plan.edits.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-white/50">
              {plan.edits.notes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide">
            {plan.edits.framing && <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/60">Frame: {plan.edits.framing}</span>}
            {plan.edits.captionColor && <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/60">Caption: {plan.edits.captionColor}</span>}
            {logoId && <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/60">Logo overlay: {logoPosition}, {logoSize}</span>}
          </div>
          <button
            type="button"
            onClick={() => onApply({
              ...plan.edits,
              logoId,
              logoPosition: logoId ? logoPosition : null,
              logoSize: logoId ? logoSize : null,
            })}
            disabled={logoUploading}
            className="mt-4 rounded-xl border border-[#F7D002]/20 bg-[#F7D002]/10 px-4 py-2.5 text-xs font-black text-[#F7D002] transition hover:bg-[#F7D002]/15 disabled:opacity-50"
          >
            Apply settings to next render
          </button>
          <p className="mt-2 text-[10px] leading-4 text-white/30">Settings are used for the next render. Nothing is published automatically.</p>
        </div>
      )}
    </section>
  );
}
