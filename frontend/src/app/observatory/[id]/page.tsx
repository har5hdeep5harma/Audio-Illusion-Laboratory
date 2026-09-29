/**
 * observatory/[id]/page.tsx — The Observatory.
 *
 * Two tabs that tell the story of perception breaking down:
 *   1. Transcript Evolution — a per-level vertical timeline with word-level diff
 *      highlighting (kept / changed / deleted / invented), and dramatic reveals
 *      when the model hallucinates or collapses.
 *   2. Hallucination Observatory — a score heatmap, a per-distortion signal-bar
 *      timeline, a circular severity gauge, and a sortable summary table.
 *
 * The word diff uses a hand-written LCS (no diff library). All tab and selection
 * changes animate via Framer Motion (AnimatePresence + slide).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

import api from "@/services/api";
import type {
  FailureStage,
  HallucinationAnalysis,
  HallucinationSeverity,
  MetricsPayload,
  TimelineEntry,
} from "@/types";

/* Tokens */

const COLOR = {
  green: "#657D4D",
  amber: "#C49125",
  orange: "#C86D3C",
  purple: "#69578F",
  red: "#B7353D",
  cyan: "#D34A2F",
} as const;

const STAGE_COLOR: Record<FailureStage, string> = {
  stable_perception: COLOR.green,
  perceptual_drift: COLOR.amber,
  semantic_drift: COLOR.orange,
  hallucination: COLOR.purple,
  collapse: COLOR.red,
};

const STAGE_LABEL: Record<FailureStage, string> = {
  stable_perception: "Stable Perception",
  perceptual_drift: "Perceptual Drift",
  semantic_drift: "Semantic Drift",
  hallucination: "Hallucination",
  collapse: "Perceptual Collapse",
};

const SEVERITY_LABEL: Record<HallucinationSeverity, string> = {
  none: "None",
  minor_drift: "Minor Drift",
  semantic_drift: "Semantic Drift",
  hallucination: "Hallucination",
  collapse: "Collapse",
};

const SEVERITY_TO_STAGE: Record<HallucinationSeverity, FailureStage> = {
  none: "stable_perception",
  minor_drift: "perceptual_drift",
  semantic_drift: "semantic_drift",
  hallucination: "hallucination",
  collapse: "collapse",
};

const DISTORTION_COLOR: Record<string, string> = {
  WHITE_NOISE: COLOR.cyan,
  ECHO: COLOR.amber,
  COMPRESSION: COLOR.orange,
  SPEED_SHIFT: COLOR.green,
  PITCH_SHIFT: COLOR.purple,
  COMBINED: COLOR.red,
};

const humanize = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const fmtIntensity = (i: number | null): string =>
  i == null ? "—" : i <= 1 ? `${(i * 100).toFixed(0)}%` : i.toFixed(1);

/** Interpolate the hallucination color scale: green→amber→purple→red. */
function hallColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  const stops: [number, [number, number, number]][] = [
    [0.0, [101, 125, 77]],
    [0.4, [196, 145, 37]],
    [0.75, [105, 87, 143]],
    [1.0, [183, 53, 61]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (s <= p1) {
      const t = (s - p0) / (p1 - p0 || 1);
      const ch = (k: number) => Math.round(c0[k] + (c1[k] - c0[k]) * t);
      return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
    }
  }
  return "rgb(183, 53, 61)";
}

function severityBand(score: number): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (score < 0.25) return "LOW";
  if (score < 0.5) return "MODERATE";
  if (score < 0.75) return "HIGH";
  return "CRITICAL";
}

/* Word-level diff (hand-written LCS) */

type DiffKind = "kept" | "changed" | "deleted" | "inserted";
type DiffToken = { kind: DiffKind; text: string };

const tokenize = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);
const norm = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Classify each hypothesis word vs the reference using an LCS alignment.
 * Adjacent deletion+insertion runs are paired into substitutions ("changed");
 * leftover deletions become "deleted", leftover insertions "inserted".
 */
function diffWords(reference: string, hypothesis: string): DiffToken[] {
  const a = tokenize(reference);
  const b = tokenize(hypothesis);
  const al = a.map(norm);
  const bl = b.map(norm);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack into equal / delete / insert ops.
  const ops: { t: "eq" | "del" | "ins"; w: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      ops.push({ t: "eq", w: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "del", w: a[i] });
      i++;
    } else {
      ops.push({ t: "ins", w: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: "del", w: a[i++] });
  while (j < m) ops.push({ t: "ins", w: b[j++] });

  // Collapse adjacent del/ins runs into substitutions.
  const out: DiffToken[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === "eq") {
      out.push({ kind: "kept", text: ops[k].w });
      k++;
      continue;
    }
    const dels: string[] = [];
    const inss: string[] = [];
    while (k < ops.length && ops[k].t !== "eq") {
      if (ops[k].t === "del") dels.push(ops[k].w);
      else inss.push(ops[k].w);
      k++;
    }
    const pairs = Math.min(dels.length, inss.length);
    for (let p = 0; p < pairs; p++) out.push({ kind: "changed", text: inss[p] });
    for (let p = pairs; p < dels.length; p++) out.push({ kind: "deleted", text: dels[p] });
    for (let p = pairs; p < inss.length; p++) out.push({ kind: "inserted", text: inss[p] });
  }
  return out;
}

/* Derived model */

type PerLevel = {
  level: number;
  label: string;
  intensity: number | null;
  transcript: string;
  stage: FailureStage;
  severity: HallucinationSeverity;
  confidence: number;
  wer: number;
  score: number;
};

type DistortionView = {
  type: string;
  name: string;
  color: string;
  levels: PerLevel[];
  peak: number;
  thresholdLevel: number | null;
};

/* Page */

type Tab = "transcripts" | "hallucination";

export default function ObservatoryPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [hallucination, setHallucination] = useState<HallucinationAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("transcripts");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getMetrics(id),
      api.getTimeline(id),
      api.getHallucinationAnalysis(id),
    ])
      .then(([m, tl, hall]) => {
        if (!alive) return;
        setMetrics(m);
        setTimeline(tl);
        setHallucination(hall);
        setSelected(m.distortion_types[0] ?? null);
      })
      .catch((e: unknown) =>
        alive && setError(e instanceof Error ? e.message : "Failed to load experiment."),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const distortions: DistortionView[] = useMemo(() => {
    if (!metrics || !hallucination) return [];
    const byKey = new Map<string, TimelineEntry>();
    timeline.forEach((e) => byKey.set(`${e.distortion_type}:${e.level}`, e));

    return metrics.distortion_types.map((type) => {
      const block = metrics.distortions[type];
      const levels: PerLevel[] = [...block.levels]
        .sort((x, y) => x.level_index - y.level_index)
        .map((l) => {
          const tl = byKey.get(`${type}:${l.level_index}`);
          return {
            level: l.level_index,
            label: l.label,
            intensity: l.intensity,
            transcript: tl?.transcript ?? "",
            stage: tl?.stage ?? SEVERITY_TO_STAGE[l.severity],
            severity: l.severity,
            confidence: l.confidence,
            wer: l.wer,
            score: l.hallucination_score,
          };
        });
      const hall = hallucination.distortions[type];
      return {
        type,
        name: humanize(type),
        color: DISTORTION_COLOR[type] ?? COLOR.cyan,
        levels,
        peak: hall?.peak_hallucination_score ?? Math.max(0, ...levels.map((x) => x.score)),
        thresholdLevel: hall?.hallucination_threshold_level ?? null,
      };
    });
  }, [metrics, hallucination, timeline]);

  const selectedView = distortions.find((d) => d.type === selected) ?? null;

  return (
    <div className="py-10">
      <style>{OBSERVATORY_CSS}</style>

      <header className="mb-6">
        <p className="mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          The Observatory
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Perception Evolution
          </h1>
          <span className="mono text-xs text-text-muted">{id}</span>
        </div>
      </header>

      {error ? (
        <ErrorState id={id} message={error} />
      ) : loading || !metrics || !hallucination ? (
        <LoadingState />
      ) : (
        <>
          <TabBar tab={tab} onChange={setTab} />

          <AnimatePresence mode="wait">
            {tab === "transcripts" ? (
              <motion.div
                key="transcripts"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.3 }}
              >
                <TranscriptEvolution
                  distortions={distortions}
                  selected={selected}
                  onSelect={setSelected}
                  reference={hallucination.reference_transcript}
                  view={selectedView}
                />
              </motion.div>
            ) : (
              <motion.div
                key="hallucination"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.3 }}
              >
                <HallucinationObservatory
                  distortions={distortions}
                  selected={selected}
                  onSelect={setSelected}
                  view={selectedView}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/* Tab bar + distortion selector  */

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "transcripts", label: "Transcript Evolution" },
    { key: "hallucination", label: "Hallucination Observatory" },
  ];
  return (
    <div className="mb-8 flex gap-1 border-b border-border-subtle">
      {tabs.map((t) => {
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={[
              "relative px-5 py-3 text-sm font-semibold transition-colors",
              active ? "text-accent-cyan" : "text-text-secondary hover:text-text-primary",
            ].join(" ")}
          >
            {t.label}
            {active && (
              <motion.span
                layoutId="tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 bg-accent-cyan shadow-glow-cyan"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function DistortionSelector({
  distortions,
  selected,
  onSelect,
}: {
  distortions: DistortionView[];
  selected: string | null;
  onSelect: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {distortions.map((d) => {
        const active = d.type === selected;
        return (
          <button
            key={d.type}
            type="button"
            onClick={() => onSelect(d.type)}
            className="mono rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              borderColor: active ? d.color : "var(--border-subtle)",
              color: active ? d.color : "var(--text-secondary)",
              background: active ? `color-mix(in srgb, ${d.color} 12%, transparent)` : "transparent",
            }}
          >
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

/* Tab 1: Transcript Evolution */

function TranscriptEvolution({
  distortions,
  selected,
  onSelect,
  reference,
  view,
}: {
  distortions: DistortionView[];
  selected: string | null;
  onSelect: (t: string) => void;
  reference: string;
  view: DistortionView | null;
}) {
  return (
    <div>
      <div className="mb-6">
        <DistortionSelector distortions={distortions} selected={selected} onSelect={onSelect} />
      </div>

      {/* Sticky original-transcript reference. */}
      <div className="sticky top-16 z-20 mb-6 rounded-lg border border-border-subtle bg-bg-card/90 p-4 backdrop-blur-md">
        <p className="mono mb-1 text-[0.65rem] uppercase tracking-[0.25em] text-text-muted">
          Original (Clean) Transcript
        </p>
        <p className="text-sm text-text-primary">{reference || "(empty)"}</p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view?.type ?? "none"}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.28 }}
          className="relative flex flex-col gap-5 pl-6"
        >
          {/* vertical spine */}
          <div className="absolute bottom-2 left-1.5 top-2 w-px bg-border-subtle" />
          {view?.levels.map((lvl) => (
            <TranscriptEntry key={lvl.level} level={lvl} reference={reference} />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function TranscriptEntry({ level, reference }: { level: PerLevel; reference: string }) {
  const isHallucination = level.stage === "hallucination";
  const isCollapse = level.stage === "collapse";
  const tokens = useMemo(() => diffWords(reference, level.transcript), [reference, level.transcript]);

  return (
    <div className="relative">
      {/* spine node */}
      <span
        className="absolute -left-[18px] top-2 h-3 w-3 rounded-full border-2 border-bg-primary"
        style={{ background: STAGE_COLOR[level.stage], boxShadow: `0 0 6px ${STAGE_COLOR[level.stage]}` }}
      />

      <article
        className={[
          "rounded-lg border bg-bg-card p-5",
          isHallucination ? "halluc-pulse" : "border-border-subtle",
        ].join(" ")}
        style={isHallucination ? { borderColor: STAGE_COLOR.hallucination } : undefined}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mono text-sm font-bold text-text-primary">
              Level {level.level}
              <span className="font-normal text-text-secondary">: {level.label}</span>
            </p>
          </div>
          <StageBadge stage={level.stage} />
        </div>

        <div className="mb-3 flex gap-5">
          <Metric label="Confidence" value={`${level.confidence.toFixed(0)}%`} color={STAGE_COLOR[level.stage]} />
          <Metric label="WER" value={`${(level.wer * 100).toFixed(0)}%`} />
          <Metric label="Hallucination" value={level.score.toFixed(2)} />
        </div>

        {/* Transcript with diff highlighting. */}
        <div
          className={[
            "rounded-md border border-border-subtle bg-bg-secondary p-3 text-sm leading-relaxed",
            isCollapse ? "select-none opacity-60 blur-[0.6px]" : "",
          ].join(" ")}
        >
          {tokens.length === 0 ? (
            <span className="mono text-text-muted">(no output)</span>
          ) : (
            <DiffText tokens={tokens} hallucinating={isHallucination} />
          )}
        </div>

        {isHallucination && (
          <p className="mono mt-3 text-xs text-stage-hallucination glow-red">
            The model began generating content that was never spoken.
          </p>
        )}
        {isCollapse && (
          <p className="mono mt-3 text-xs text-danger glow-red">
            Understanding has failed. The model is no longer perceiving the input.
          </p>
        )}
      </article>
    </div>
  );
}

function DiffText({ tokens, hallucinating }: { tokens: DiffToken[]; hallucinating: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      {tokens.map((tok, i) => {
        if (tok.kind === "kept") {
          return (
            <span key={i} className="text-text-primary">
              {tok.text}
            </span>
          );
        }
        if (tok.kind === "changed") {
          return (
            <span
              key={i}
              title="substituted"
              className="rounded-sm bg-accent-amber/15 px-1 text-accent-amber underline decoration-dotted underline-offset-2"
            >
              {tok.text}
            </span>
          );
        }
        if (tok.kind === "deleted") {
          return (
            <span key={i} title="deleted" className="text-text-muted line-through opacity-70">
              {tok.text}
            </span>
          );
        }
        // inserted / invented
        return (
          <span
            key={i}
            title="invented"
            className={[
              "rounded-sm bg-danger/15 px-1 text-danger",
              hallucinating ? "glow-red" : "",
            ].join(" ")}
          >
            <span aria-hidden className="mr-0.5">
              ⚡
            </span>
            {tok.text}
          </span>
        );
      })}
    </p>
  );
}

function StageBadge({ stage }: { stage: FailureStage }) {
  const color = STAGE_COLOR[stage];
  let label = STAGE_LABEL[stage];
  if (stage === "hallucination") label = "⚡ HALLUCINATION DETECTED";
  if (stage === "collapse") label = "💀 PERCEPTUAL COLLAPSE";
  return (
    <span className="stage-badge" style={{ color }}>
      {label}
    </span>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="mono text-[0.6rem] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mono text-base font-bold" style={{ color: color ?? "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

/* Tab 2: Hallucination Observatory */

function HallucinationObservatory({
  distortions,
  selected,
  onSelect,
  view,
}: {
  distortions: DistortionView[];
  selected: string | null;
  onSelect: (t: string) => void;
  view: DistortionView | null;
}) {
  const maxLevel = Math.max(0, ...distortions.flatMap((d) => d.levels.map((l) => l.level)));

  return (
    <div className="flex flex-col gap-8">
      <Heatmap distortions={distortions} maxLevel={maxLevel} onSelect={onSelect} selected={selected} />

      <div className="mb-2">
        <DistortionSelector distortions={distortions} selected={selected} onSelect={onSelect} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ScoreTimeline view={view} />
        </div>
        <div className="lg:col-span-2">
          <SeverityGauge view={view} />
        </div>
      </div>

      <SummaryTable distortions={distortions} />
    </div>
  );
}

function Heatmap({
  distortions,
  maxLevel,
  selected,
  onSelect,
}: {
  distortions: DistortionView[];
  maxLevel: number;
  selected: string | null;
  onSelect: (t: string) => void;
}) {
  const cols = Array.from({ length: maxLevel + 1 }, (_, i) => i);
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mono mb-4 text-xs uppercase tracking-[0.25em] text-text-secondary">
        Hallucination Heatmap
      </h2>
      <div className="inline-block min-w-full">
        {/* column headers */}
        <div className="flex">
          <div className="w-28 shrink-0" />
          {cols.map((c) => (
            <div key={c} className="mono w-10 shrink-0 text-center text-[0.6rem] text-text-muted">
              L{c}
            </div>
          ))}
        </div>
        {distortions.map((d) => {
          const byLevel = new Map(d.levels.map((l) => [l.level, l]));
          return (
            <button
              key={d.type}
              type="button"
              onClick={() => onSelect(d.type)}
              className="flex w-full items-center text-left"
            >
              <div
                className="mono w-28 shrink-0 truncate py-1 pr-2 text-xs"
                style={{ color: selected === d.type ? d.color : "var(--text-secondary)" }}
              >
                {d.name}
              </div>
              {cols.map((c) => {
                const lvl = byLevel.get(c);
                if (!lvl) return <div key={c} className="m-0.5 h-8 w-9 shrink-0 rounded-sm bg-bg-secondary/40" />;
                return (
                  <div
                    key={c}
                    title={`${d.name} · L${c} (${fmtIntensity(lvl.intensity)})\nscore ${lvl.score.toFixed(2)} · ${SEVERITY_LABEL[lvl.severity]}`}
                    className="m-0.5 h-8 w-9 shrink-0 rounded-sm transition-transform hover:scale-110"
                    style={{ background: hallColor(lvl.score) }}
                  />
                );
              })}
            </button>
          );
        })}
      </div>
      {/* scale legend */}
      <div className="mt-4 flex items-center gap-2">
        <span className="mono text-[0.6rem] text-text-muted">0.0</span>
        <div
          className="h-2 w-40 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${hallColor(0)}, ${hallColor(0.4)}, ${hallColor(0.75)}, ${hallColor(1)})`,
          }}
        />
        <span className="mono text-[0.6rem] text-text-muted">1.0 hallucination</span>
      </div>
    </div>
  );
}

function ScoreTimeline({ view }: { view: DistortionView | null }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mono mb-4 text-xs uppercase tracking-[0.25em] text-text-secondary">
        Hallucination Timeline {view ? `· ${view.name}` : ""}
      </h2>
      <AnimatePresence mode="wait">
        <motion.div
          key={view?.type ?? "none"}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.25 }}
          className="flex flex-col gap-2.5"
        >
          {view?.levels.map((l) => (
            <div key={l.level} className="flex items-center gap-3">
              <span className="mono w-14 shrink-0 text-xs text-text-muted">L{l.level}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-sm bg-bg-secondary">
                <motion.div
                  className="h-full rounded-sm"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, l.score * 100)}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  style={{ background: hallColor(l.score) }}
                />
              </div>
              <span className="mono w-10 shrink-0 text-right text-xs" style={{ color: hallColor(l.score) }}>
                {l.score.toFixed(2)}
              </span>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SeverityGauge({ view }: { view: DistortionView | null }) {
  const peak = view?.peak ?? 0;
  const band = severityBand(peak);
  const color = hallColor(peak);

  // Needle endpoint: fraction 0..1 → semicircle angle 180°(left)→360°(right).
  const r = 64;
  const angle = (180 + peak * 180) * (Math.PI / 180);
  const tip = { x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle) };

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mono mb-2 text-xs uppercase tracking-[0.25em] text-text-secondary">
        Severity Gauge {view ? `· ${view.name}` : ""}
      </h2>
      <svg viewBox="0 0 200 120" className="mx-auto w-full max-w-[260px]">
        {/* track */}
        <path d={arcPath(100, 100, 80, 0, 1)} fill="none" stroke="#1E2D3D" strokeWidth="12" strokeLinecap="round" />
        {/* value arc */}
        <path
          d={arcPath(100, 100, 80, 0, Math.max(0.001, peak))}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* needle */}
        <motion.line
          x1={100}
          y1={100}
          initial={false}
          animate={{ x2: tip.x, y2: tip.y }}
          transition={{ type: "spring", stiffness: 90, damping: 14 }}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx={100} cy={100} r={5} fill={color} />
      </svg>

      <p className="mono mt-1 text-center">
        <span className="metric-value" style={{ color }}>
          {peak.toFixed(2)}
        </span>
      </p>
      <p className="mono mt-1 text-center text-sm font-bold tracking-widest" style={{ color }}>
        {band}
      </p>
      <div className="mono mt-4 flex justify-between text-[0.55rem] uppercase tracking-wider text-text-muted">
        <span>Low</span>
        <span>Moderate</span>
        <span>High</span>
        <span>Critical</span>
      </div>
    </div>
  );
}

/** SVG arc over the top semicircle, for fractions [startF, endF] of 0→1. */
function arcPath(cx: number, cy: number, r: number, startF: number, endF: number): string {
  const polar = (f: number) => {
    const a = (180 + f * 180) * (Math.PI / 180);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const p0 = polar(startF);
  const p1 = polar(endF);
  const largeArc = endF - startF > 0.5 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/* Summary table (sortable) */

type SortKey = "type" | "first" | "peak" | "stage";

function SummaryTable({ distortions }: { distortions: DistortionView[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("first");
  const [dir, setDir] = useState<1 | -1>(1);

  const rows = useMemo(
    () =>
      distortions.map((d) => ({
        type: d.type,
        name: d.name,
        first: d.thresholdLevel,
        peak: d.peak,
        stageLabel: SEVERITY_LABEL[scoreToSeverity(d.peak)],
        stageColor: hallColor(d.peak),
      })),
    [distortions],
  );

  // Earliest onset (min non-null first level) — the row to highlight.
  const earliestType = useMemo(() => {
    const onset = rows.filter((r) => r.first != null).sort((a, b) => a.first! - b.first!);
    return onset[0]?.type ?? null;
  }, [rows]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "type") {
        av = a.name;
        bv = b.name;
      } else if (sortKey === "stage") {
        av = a.peak;
        bv = b.peak;
      } else if (sortKey === "peak") {
        av = a.peak;
        bv = b.peak;
      } else {
        // first: nulls sort last regardless of direction
        const an = a.first ?? Number.POSITIVE_INFINITY;
        const bn = b.first ?? Number.POSITIVE_INFINITY;
        return (an - bn) * dir;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [rows, sortKey, dir]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setDir(1);
    }
  };

  const Header = ({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) => (
    <th className={`cursor-pointer select-none px-3 py-2 text-left ${className}`} onClick={() => toggle(k)}>
      <span className="mono text-[0.65rem] uppercase tracking-wider text-text-secondary">
        {label}
        {sortKey === k && <span className="ml-1 text-accent-cyan">{dir === 1 ? "▲" : "▼"}</span>}
      </span>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mono mb-4 text-xs uppercase tracking-[0.25em] text-text-secondary">
        Hallucination Summary
      </h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-subtle">
            <Header k="type" label="Distortion Type" />
            <Header k="first" label="First Hallucination Level" />
            <Header k="peak" label="Peak Score" />
            <Header k="stage" label="Overall Stage" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const highlight = r.type === earliestType;
            return (
              <tr
                key={r.type}
                className="border-b border-border-subtle/60"
                style={highlight ? { background: "color-mix(in srgb, var(--accent-cyan) 8%, transparent)" } : undefined}
              >
                <td className="px-3 py-2.5 text-sm font-semibold text-text-primary">
                  {r.name}
                  {highlight && (
                    <span className="mono ml-2 text-[0.55rem] uppercase tracking-wider text-accent-cyan">
                      ◀ earliest onset
                    </span>
                  )}
                </td>
                <td className="mono px-3 py-2.5 text-sm text-text-secondary">
                  {r.first != null ? `Level ${r.first}` : "—"}
                </td>
                <td className="mono px-3 py-2.5 text-sm" style={{ color: r.stageColor }}>
                  {r.peak.toFixed(2)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="stage-badge" style={{ color: r.stageColor }}>
                    {r.stageLabel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function scoreToSeverity(score: number): HallucinationSeverity {
  if (score < 0.15) return "none";
  if (score < 0.3) return "minor_drift";
  if (score < 0.5) return "semantic_drift";
  if (score < 0.75) return "hallucination";
  return "collapse";
}

/* States */

function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="skeleton h-12 rounded-lg border border-border-subtle bg-bg-card" />
      <div className="skeleton h-64 rounded-lg border border-border-subtle bg-bg-card" />
      <div className="skeleton h-80 rounded-lg border border-border-subtle bg-bg-card" />
    </div>
  );
}

function ErrorState({ id, message }: { id: string; message: string }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-8 text-center">
      <p className="mono text-sm font-bold text-danger glow-red">Could not load experiment</p>
      <p className="mt-2 text-sm text-text-secondary">{message}</p>
      <p className="mono mt-1 text-xs text-text-muted">{id}</p>
      <Link
        href="/experiment"
        className="mono mt-5 inline-block rounded-md border border-accent-cyan/60 px-5 py-2 text-xs font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/10"
      >
        ← Start a new experiment
      </Link>
    </div>
  );
}

const OBSERVATORY_CSS = `
.halluc-pulse {
  border: 1px solid var(--stage-hallucination);
  animation: halluc-pulse 1.6s ease-in-out infinite;
}
@keyframes halluc-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(213, 0, 249, 0.0); border-color: rgba(213,0,249,0.5); }
  50% { box-shadow: 0 0 16px 2px rgba(213, 0, 249, 0.45); border-color: rgba(213,0,249,1); }
}
.skeleton { position: relative; overflow: hidden; }
.skeleton::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(0,229,255,0.06), transparent);
  transform: translateX(-100%); animation: shimmer 1.6s ease-in-out infinite;
}
@keyframes shimmer { 100% { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) {
  .halluc-pulse, .skeleton::after { animation: none; }
}
`;
