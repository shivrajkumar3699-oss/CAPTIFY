"use client";

import { FormEvent, useState } from "react";

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

export default function VideoEditChat({
  onApply,
}: {
  onApply: (edits: EditPlan["edits"]) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<EditPlan | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Editing assistant is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-[28px] border border-[#F7D002]/15 bg-white/[0.025] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#F7D002]/10 text-lg text-[#F7D002]">✦</div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F7D002]">AI Video Director</p>
          <h2 className="mt-1 text-lg font-bold">Tell CAPTIFY what to change</h2>
          <p className="mt-1 text-xs leading-5 text-white/40">Short replies. Structured edit plan. No OpenAI key required.</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 2000))}
          maxLength={2000}
          rows={2}
          placeholder="Example: Keep the full video visible with black space around it and use white captions."
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
            {plan.edits.logoPosition && <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/60">Logo: {plan.edits.logoPosition}</span>}
            {plan.edits.logoSize && <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/60">Logo size: {plan.edits.logoSize}</span>}
          </div>
          <button
            type="button"
            onClick={() => onApply(plan.edits)}
            className="mt-4 rounded-xl border border-[#F7D002]/20 bg-[#F7D002]/10 px-4 py-2.5 text-xs font-black text-[#F7D002] transition hover:bg-[#F7D002]/15"
          >
            Apply supported settings
          </button>
          <p className="mt-2 text-[10px] leading-4 text-white/30">Applies framing and caption color to the current settings. Logo placement is parsed as a plan only; logo image upload and FFmpeg overlay are not enabled yet.</p>
        </div>
      )}
    </section>
  );
}
