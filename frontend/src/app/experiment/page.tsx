/**
 * experiment/page.tsx - Experiment Setup ("/experiment").
 *
 * A two-column scientific apparatus: configure on the left (audio upload with a
 * Web-Audio waveform preview, distortion selection, intensity ladder, launch),
 * watch the pipeline on the right. All orchestration runs through the
 * `useExperiment` hook; on completion we auto-navigate to the dashboard.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

import useExperiment, { type ExperimentStatus } from "@/hooks/useExperiment";
import type { DistortionType } from "@/types";

/* Constants */

const MAX_DURATION_S = 120; // mirrors backend config.MAX_AUDIO_DURATION
const ACCEPTED_EXT = ["wav", "mp3", "m4a", "flac"] as const;
const ACCEPT_ATTR = ".wav,.mp3,.m4a,.flac,audio/*";

type DistortionOption = {
  type: DistortionType;
  name: string;
  color: string; // CSS variable
  icon: React.ReactNode;
  recommended?: boolean;
};

const DISTORTIONS: DistortionOption[] = [
  { type: "WHITE_NOISE", name: "White Noise", color: "var(--accent-cyan)", icon: <IconNoise /> },
  { type: "ECHO", name: "Echo", color: "var(--stage-drift)", icon: <IconEcho /> },
  { type: "COMPRESSION", name: "Compression", color: "var(--stage-semantic)", icon: <IconCompression /> },
  { type: "SPEED_SHIFT", name: "Speed Shift", color: "var(--success-green)", icon: <IconSpeed /> },
  { type: "PITCH_SHIFT", name: "Pitch Shift", color: "var(--hallucination)", icon: <IconPitch /> },
  { type: "COMBINED", name: "Combined", color: "var(--danger-red)", icon: <IconCombined />, recommended: true },
];

const PIPELINE_STEPS = [
  "Audio Uploaded",
  "Generating Distortions",
  "Whisper Inference",
  "Computing Metrics",
  "Failure Analysis",
  "Building Report",
] as const;

// Index of the actively-running step for each hook status.
// (The hook's `analyzing` stage covers metrics + failure analysis; the report is
// finalized downstream, so steps 4–5 resolve together at completion.)
const ACTIVE_INDEX: Record<ExperimentStatus, number> = {
  idle: -1,
  uploading: 0,
  distorting: 1,
  transcribing: 2,
  analyzing: 3,
  complete: PIPELINE_STEPS.length, // all done
  error: -1,
};

const RUNNING: ExperimentStatus[] = [
  "uploading",
  "distorting",
  "transcribing",
  "analyzing",
];

/* Page */

export default function ExperimentPage() {
  const router = useRouter();
  const experiment = useExperiment();
  const { status, experimentId } = experiment;

  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [selected, setSelected] = useState<Set<DistortionType>>(
    new Set<DistortionType>(["COMBINED"]),
  );
  const [ladder, setLadder] = useState<"standard" | "extended">("standard");

  const isRunning = RUNNING.includes(status);
  const canLaunch = !!file && selected.size > 0 && !isRunning;

  const handleFile = useCallback(async (picked: File) => {
    setFileError(null);
    setFile(null);
    setDuration(null);
    setPeaks([]);

    const ext = picked.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXT.includes(ext as (typeof ACCEPTED_EXT)[number])) {
      setFileError(
        `Unsupported format ".${ext || "?"}". Accepted: ${ACCEPTED_EXT.join(", ")}.`,
      );
      return;
    }

    setAnalyzing(true);
    try {
      const { duration: dur, peaks: pk } = await analyzeAudio(picked);
      if (dur > MAX_DURATION_S) {
        setFileError(
          `Audio too long (${dur.toFixed(0)}s). Maximum is ${MAX_DURATION_S}s.`,
        );
        return;
      }
      setFile(picked);
      setDuration(dur);
      setPeaks(pk);
    } catch {
      // Could not decode locally — accept it and let the backend validate.
      setFile(picked);
      setDuration(null);
      setPeaks([]);
      setFileError(
        "Could not preview this file in-browser; it will be validated on upload.",
      );
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const toggleDistortion = useCallback((type: DistortionType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleLaunch = useCallback(() => {
    if (!file || selected.size === 0) return;
    const levels = ladder === "extended" ? Array.from({ length: 9 }, (_, i) => i) : Array.from({ length: 6 }, (_, i) => i);
    void experiment.startExperiment(file, Array.from(selected), levels);
  }, [file, selected, ladder, experiment]);

  // Auto-navigate to the dashboard shortly after completion.
  useEffect(() => {
    if (status === "complete" && experimentId) {
      const t = setTimeout(() => router.push(`/dashboard/${experimentId}`), 1600);
      return () => clearTimeout(t);
    }
  }, [status, experimentId, router]);

  return (
    <div className="py-12">
      <header className="mb-10">
        <p className="mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          Apparatus Setup
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
          Configure Experiment
        </h1>
        <hr className="signal-line mt-5" />
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        {/* Left — configuration (60%) */}
        <div className="flex flex-col gap-8 lg:col-span-3">
          <UploadSection
            file={file}
            duration={duration}
            peaks={peaks}
            error={fileError}
            analyzing={analyzing}
            disabled={isRunning}
            onFile={handleFile}
          />

          <DistortionSection
            selected={selected}
            disabled={isRunning}
            onToggle={toggleDistortion}
          />

          <IntensitySection value={ladder} disabled={isRunning} onChange={setLadder} />

          <button
            type="button"
            onClick={handleLaunch}
            disabled={!canLaunch}
            className="mono w-full rounded-md bg-accent-cyan py-4 text-sm font-bold uppercase tracking-widest text-bg-primary shadow-glow-cyan transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-bg-elevated disabled:text-text-muted disabled:shadow-none"
          >
            {isRunning ? "Experiment Running…" : "Launch Experiment"}
          </button>
        </div>

        {/* Right — status (40%) */}
        <div className="lg:col-span-2">
          <StatusPanel experiment={experiment} onViewResults={() => {
            if (experimentId) router.push(`/dashboard/${experimentId}`);
          }} />
        </div>
      </div>
    </div>
  );
}

/* Left: Upload */

function UploadSection({
  file,
  duration,
  peaks,
  error,
  analyzing,
  disabled,
  onFile,
}: {
  file: File | null;
  duration: number | null;
  peaks: number[];
  error: string | null;
  analyzing: boolean;
  disabled: boolean;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  return (
    <section>
      <SectionTitle index="01" title="Audio Upload" />
      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (disabled) return;
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
        className={[
          "group relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          disabled ? "cursor-not-allowed opacity-60" : "",
          dragActive
            ? "border-accent-cyan bg-accent-cyan/5"
            : "border-border-subtle bg-bg-card hover:border-accent-cyan hover:bg-bg-elevated",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) onFile(picked);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />

        {file ? (
          <div className="w-full">
            <Waveform peaks={peaks} />
            <div className="mono mt-4 flex items-center justify-center gap-3 text-xs text-text-secondary">
              <span className="text-text-primary">{file.name}</span>
              {duration != null && (
                <span className="rounded-full border border-border-subtle px-2 py-0.5 text-accent-cyan">
                  {duration.toFixed(1)}s
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Click or drop to replace
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 text-accent-cyan opacity-80 group-hover:opacity-100">
              <IconUpload />
            </div>
            <p className="text-sm text-text-primary">
              {analyzing ? "Analyzing audio…" : "Drag & drop an audio file, or click to browse"}
            </p>
            <p className="mono mt-2 text-xs text-text-muted">
              {ACCEPTED_EXT.join(" · ").toUpperCase()} — max {MAX_DURATION_S}s
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="mono mt-3 flex items-center gap-2 text-xs text-danger glow-red">
          <span aria-hidden>⚠</span>
          {error}
        </p>
      )}
    </section>
  );
}

/** Static amplitude waveform on a canvas (mirrored bars). */
function Waveform({ peaks }: { peaks: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = 72;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    if (peaks.length === 0) return;
    const mid = cssH / 2;
    const gap = 2;
    const barW = Math.max(1, cssW / peaks.length - gap);
    ctx.fillStyle = "#00E5FF";
    peaks.forEach((p, i) => {
      const h = Math.max(2, p * (cssH - 6));
      const x = i * (barW + gap);
      ctx.fillRect(x, mid - h / 2, barW, h);
    });
  }, [peaks]);

  return <canvas ref={canvasRef} className="h-[72px] w-full" />;
}

/* Left: Distortions */

function DistortionSection({
  selected,
  disabled,
  onToggle,
}: {
  selected: Set<DistortionType>;
  disabled: boolean;
  onToggle: (t: DistortionType) => void;
}) {
  return (
    <section>
      <SectionTitle index="02" title="Select Perturbations" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {DISTORTIONS.map((d) => {
          const active = selected.has(d.type);
          return (
            <button
              key={d.type}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onToggle(d.type)}
              className="group relative flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: active ? d.color : "var(--border-subtle)",
                background: active
                  ? `color-mix(in srgb, ${d.color} 14%, var(--bg-card))`
                  : "var(--bg-card)",
                boxShadow: active ? `0 0 12px color-mix(in srgb, ${d.color} 35%, transparent)` : "none",
              }}
            >
              {d.recommended && (
                <span
                  className="mono absolute right-2 top-2 rounded-full px-2 py-0.5 text-[0.55rem] uppercase tracking-wider"
                  style={{ color: d.color, border: `1px solid ${d.color}` }}
                >
                  Recommended
                </span>
              )}
              <span style={{ color: active ? d.color : "var(--text-secondary)" }}>
                {d.icon}
              </span>
              <span
                className="text-sm font-semibold"
                style={{ color: active ? d.color : "var(--text-primary)" }}
              >
                {d.name}
              </span>

              {/* checkmark when selected */}
              <span
                className="absolute bottom-3 right-3 flex h-5 w-5 items-center justify-center rounded-full transition-opacity"
                style={{
                  opacity: active ? 1 : 0,
                  background: d.color,
                  color: "var(--bg-primary)",
                }}
                aria-hidden
              >
                <IconCheck />
              </span>
            </button>
          );
        })}
      </div>
      {selected.size === 0 && (
        <p className="mono mt-3 text-xs text-accent-amber">
          Select at least one perturbation to run an experiment.
        </p>
      )}
    </section>
  );
}

/* Left: Intensity ladder */

function IntensitySection({
  value,
  disabled,
  onChange,
}: {
  value: "standard" | "extended";
  disabled: boolean;
  onChange: (v: "standard" | "extended") => void;
}) {
  const options: { key: "standard" | "extended"; label: string }[] = [
    { key: "standard", label: "Standard (6 levels)" },
    { key: "extended", label: "Extended (9 levels)" },
  ];
  return (
    <section>
      <SectionTitle index="03" title="Intensity Ladder" />
      <div className="grid grid-cols-2 gap-3">
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(o.key)}
              className={[
                "mono rounded-md border px-4 py-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan"
                  : "border-border-subtle bg-bg-card text-text-secondary hover:border-accent-cyan/50",
              ].join(" ")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        More levels = longer processing, richer analysis.
      </p>
    </section>
  );
}

/* Right: Status panel */

function StatusPanel({
  experiment,
  onViewResults,
}: {
  experiment: ReturnType<typeof useExperiment>;
  onViewResults: () => void;
}) {
  const { status, error } = experiment;
  const activeIndex = ACTIVE_INDEX[status];

  // Per-step elapsed timing, derived from status transitions.
  const [times, setTimes] = useState<{ start: number | null; end: number | null }[]>(
    () => PIPELINE_STEPS.map(() => ({ start: null, end: null })),
  );

  useEffect(() => {
    if (status === "idle" || status === "error") {
      if (status === "idle") setTimes(PIPELINE_STEPS.map(() => ({ start: null, end: null })));
      return;
    }
    const now = performance.now();
    setTimes((prev) => {
      const next = prev.map((t) => ({ ...t }));
      if (status === "complete") {
        for (const t of next) {
          if (t.start == null) t.start = now;
          if (t.end == null) t.end = now;
        }
        return next;
      }
      const k = ACTIVE_INDEX[status];
      if (k >= 0) {
        if (next[k] && next[k].start == null) next[k].start = now;
        for (let i = 0; i < k; i++) {
          if (next[i].start == null) next[i].start = now;
          if (next[i].end == null) next[i].end = now;
        }
      }
      return next;
    });
  }, [status]);

  return (
    <div className="sticky top-20 rounded-lg border border-border-subtle bg-bg-card p-6">
      <p className="mono mb-5 text-xs uppercase tracking-[0.3em] text-text-secondary">
        Pipeline Status
      </p>

      <AnimatePresence mode="wait">
        {status === "idle" ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-12 text-center"
          >
            <div className="text-text-muted">
              <IdleWave />
            </div>
            <p className="mono mt-4 text-sm text-text-secondary">Ready to begin</p>
            <p className="mt-1 text-xs text-text-muted">
              Configure the apparatus, then launch.
            </p>
          </motion.div>
        ) : (
          <motion.ol
            key="tracker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-1"
          >
            {PIPELINE_STEPS.map((label, i) => {
              const state = stepStateFor(i, status, activeIndex, times);
              const elapsed =
                times[i].start != null && times[i].end != null
                  ? (times[i].end! - times[i].start!) / 1000
                  : null;
              return (
                <StepRow key={label} label={label} state={state} elapsed={elapsed} />
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>

      {status === "error" && error && (
        <div className="mt-5 rounded-md border border-danger/40 bg-danger/10 px-3 py-3">
          <p className="mono text-xs text-danger">{error}</p>
          <button
            type="button"
            onClick={experiment.reset}
            className="mono mt-3 rounded-md border border-danger/50 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-danger transition-colors hover:bg-danger/10"
          >
            ↻ Reset &amp; try again
          </button>
        </div>
      )}

      <AnimatePresence>
        {status === "complete" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-md border border-success/40 bg-success/10 p-4 text-center"
          >
            <p className="mono text-sm font-bold text-success glow-green">
              ✓ Analysis Complete
            </p>
            <button
              type="button"
              onClick={onViewResults}
              className="mono mt-3 inline-flex items-center gap-2 rounded-md bg-success px-5 py-2 text-xs font-bold uppercase tracking-widest text-bg-primary transition-transform hover:translate-x-0.5"
            >
              View Results →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type StepState = "pending" | "active" | "done" | "error";

function StepRow({
  label,
  state,
  elapsed,
}: {
  label: string;
  state: StepState;
  elapsed: number | null;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {state === "done" && <span className="text-success glow-green">✓</span>}
        {state === "active" && (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-cyan border-t-transparent" />
        )}
        {state === "error" && <span className="text-danger glow-red">✕</span>}
        {state === "pending" && (
          <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
        )}
      </span>
      <span
        className={[
          "mono flex-1 text-sm",
          state === "pending" ? "text-text-muted" : "",
          state === "active" ? "text-accent-cyan" : "",
          state === "done" ? "text-text-primary" : "",
          state === "error" ? "text-danger" : "",
        ].join(" ")}
      >
        {label}
        {state === "active" && "…"}
      </span>
      {elapsed != null && state === "done" && (
        <span className="mono text-xs text-text-muted">{elapsed.toFixed(1)}s</span>
      )}
    </li>
  );
}

/* Helpers */

/** Per-step visual state, derived from status + recorded timings.
 *
 * On error, finished steps (with an end time) stay "done", the step that was
 * in flight (started, never finished) becomes "error", the rest "pending".
 */
function stepStateFor(
  i: number,
  status: ExperimentStatus,
  activeIndex: number,
  times: { start: number | null; end: number | null }[],
): StepState {
  if (status === "error") {
    if (times[i].end != null) return "done";
    if (times[i].start != null) return "error";
    return "pending";
  }
  if (i < activeIndex) return "done";
  if (i === activeIndex) return "active";
  return "pending";
}

/** Decode audio in-browser → duration + normalized amplitude peaks. */
async function analyzeAudio(
  file: File,
): Promise<{ duration: number; peaks: number[] }> {
  const arrayBuf = await file.arrayBuffer();
  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audioBuf: AudioBuffer = await ctx.decodeAudioData(arrayBuf);
    const channel = audioBuf.getChannelData(0);
    const bars = 140;
    const block = Math.floor(channel.length / bars) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(channel[i * block + j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const norm = Math.max(...peaks, 0.0001);
    return { duration: audioBuf.duration, peaks: peaks.map((p) => p / norm) };
  } finally {
    void ctx.close();
  }
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="mono text-xs text-accent-cyan">{index}</span>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
        {title}
      </h2>
      <hr className="signal-line flex-1" />
    </div>
  );
}

/* Icons */

function IconUpload() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-11" />
    </svg>
  );
}
function IconNoise() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      {[
        [4, 6], [9, 4], [14, 8], [19, 5], [6, 12], [12, 11], [18, 13],
        [4, 18], [10, 17], [15, 19], [20, 18],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.3" />
      ))}
    </svg>
  );
}
function IconEcho() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M5 12a3 3 0 0 1 0 0" />
      <path d="M6 8a6 6 0 0 1 0 8" />
      <path d="M10 5a10 10 0 0 1 0 14" />
      <path d="M14 3a14 14 0 0 1 0 18" />
    </svg>
  );
}
function IconCompression() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18h3v-4h4v-4h4V6h4V3" />
    </svg>
  );
}
function IconSpeed() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h17" />
      <path d="M15 7l5 5-5 5" />
      <path d="M2 8v8" opacity="0.5" />
    </svg>
  );
}
function IconPitch() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="15" r="2" />
      <path d="M8 18V6l11-2v11" />
    </svg>
  );
}
function IconCombined() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </svg>
  );
}
function IdleWave() {
  return (
    <svg width="120" height="60" viewBox="0 0 120 60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-pulse-glow text-accent-cyan/40">
      <path d="M2 30 Q 15 5 30 30 T 60 30 T 90 30 T 118 30" />
    </svg>
  );
}
