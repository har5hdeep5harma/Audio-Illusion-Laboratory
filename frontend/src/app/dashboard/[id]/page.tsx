/**
 * dashboard/[id]/page.tsx — Auditory Stability Dashboard.
 *
 * The primary analysis surface. Fetches the report, timeline, and hallucination
 * analysis for an experiment, then renders three headline cards plus a
 * two-column body of Plotly charts (stability, confidence, WER) and a
 * comparison / failure-timeline panel.
 *
 * Plotly is loaded client-only via next/dynamic (it needs `window`). All charts
 * share a hand-built dark theme matching the design system — no default styling.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import api from "@/services/api";
import type {
  DistortionReport,
  ExperimentReport,
  FailureStage,
  HallucinationAnalysis,
  RobustnessGrade,
  TimelineEntry,
} from "@/types";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

/* Design tokens (hex mirrors of CSS vars, for Plotly/SVG) */

const COLOR = {
  bgCard: "#F8F4EA",
  bgElevated: "#FFFAF0",
  border: "#C8BDA9",
  textPrimary: "#1D2925",
  textSecondary: "#5F665D",
  textMuted: "#8D8A7D",
  cyan: "#D34A2F",
  amber: "#C49125",
  green: "#657D4D",
  orange: "#C86D3C",
  purple: "#69578F",
  red: "#B7353D",
} as const;

const STAGE_COLOR: Record<FailureStage, string> = {
  stable_perception: COLOR.green,
  perceptual_drift: COLOR.amber,
  semantic_drift: COLOR.orange,
  hallucination: COLOR.purple,
  collapse: COLOR.red,
};

const STAGE_LABEL: Record<FailureStage, string> = {
  stable_perception: "Stable",
  perceptual_drift: "Drift",
  semantic_drift: "Semantic",
  hallucination: "Hallucination",
  collapse: "Collapse",
};

const DISTORTION_COLOR: Record<string, string> = {
  WHITE_NOISE: COLOR.cyan,
  ECHO: COLOR.amber,
  COMPRESSION: COLOR.orange,
  SPEED_SHIFT: COLOR.green,
  PITCH_SHIFT: COLOR.purple,
  COMBINED: COLOR.red,
};

const ROBUSTNESS_COLOR: Record<RobustnessGrade, string> = {
  high: COLOR.green,
  moderate: COLOR.amber,
  low: COLOR.orange,
  critical: COLOR.red,
};

/* Helpers */

const humanize = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Understanding Quality (0–100): confidence blended with 1 − hallucination. */
const quality = (confidence: number, hallucination: number) =>
  clamp(0.5 * confidence + 50 * (1 - hallucination));

function severityFor(r: RobustnessGrade): { label: string; color: string } {
  if (r === "high") return { label: "ROBUST", color: COLOR.green };
  if (r === "moderate") return { label: "MODERATE", color: COLOR.amber };
  return { label: "HIGH RISK", color: r === "critical" ? COLOR.red : COLOR.orange };
}

/* Page */

export default function DashboardPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [hallucination, setHallucination] = useState<HallucinationAnalysis | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getReport(id),
      api.getTimeline(id),
      api.getHallucinationAnalysis(id),
    ])
      .then(([rep, tl, hall]) => {
        if (!alive) return;
        setReport(rep);
        setTimeline(tl);
        setHallucination(hall);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load experiment.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="py-10">
      <style>{SHIMMER_CSS}</style>
      <DashboardHeader id={id} report={report} />

      {error ? (
        <ErrorState id={id} message={error} />
      ) : loading || !report ? (
        <DashboardSkeleton />
      ) : (
        <DashboardBody
          report={report}
          timeline={timeline}
          hallucination={hallucination}
        />
      )}
    </div>
  );
}

function DashboardHeader({
  id,
  report,
}: {
  id: string;
  report: ExperimentReport | null;
}) {
  return (
    <header className="mb-8">
      <p className="mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
        Auditory Stability Dashboard
      </p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          {report ? report.filename : "Loading experiment…"}
        </h1>
        <div className="flex items-center gap-3">
          <span className="mono text-xs text-text-muted">{id}</span>
          {report && (
            <Link
              href={`/report/${id}`}
              className="mono rounded-md border border-accent-cyan/60 px-3 py-2 text-xs font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/10"
            >
              Open Report &amp; Export
            </Link>
          )}
        </div>
      </div>
      {report?.executive_summary && (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-secondary">
          {report.executive_summary}
        </p>
      )}
      <hr className="signal-line mt-5" />
    </header>
  );
}

/* Body */

type Series = {
  type: string;
  name: string;
  color: string;
  levels: number[];
  quality: number[];
  confidence: number[];
  wer: number[];
  stages: { level: number; stage_name: FailureStage }[];
  hallThreshold: number | null;
  collapse: number | null;
  robustness: RobustnessGrade;
};

function DashboardBody({
  report,
  timeline,
  hallucination,
}: {
  report: ExperimentReport;
  timeline: TimelineEntry[];
  hallucination: HallucinationAnalysis | null;
}) {
  const series: Series[] = useMemo(
    () =>
      report.per_distortion.map((d: DistortionReport) => {
        const stages = [...d.stages].sort((a, b) => a.level - b.level);
        return {
          type: d.distortion_type,
          name: humanize(d.distortion_type),
          color: DISTORTION_COLOR[d.distortion_type] ?? COLOR.cyan,
          levels: stages.map((s) => s.level),
          quality: stages.map((s) => quality(s.confidence, s.hallucination_score)),
          confidence: stages.map((s) => s.confidence),
          wer: stages.map((s) => s.wer * 100),
          stages: stages.map((s) => ({ level: s.level, stage_name: s.stage_name })),
          hallThreshold: d.hallucination_threshold_level,
          collapse: d.collapse_point_level,
          robustness: d.overall_robustness,
        };
      }),
    [report],
  );

  // Transcript lookup for failure-timeline tooltips.
  const transcriptMap = useMemo(() => {
    const m = new Map<string, string>();
    timeline.forEach((e) => m.set(`${e.distortion_type}:${e.level}`, e.transcript));
    return m;
  }, [timeline]);

  const maxLevel = useMemo(
    () => Math.max(0, ...series.flatMap((s) => s.levels)),
    [series],
  );

  // Aggregate (experiment-level) threshold + collapse, used for chart zones.
  const hallX =
    report.earliest_hallucination_level >= 0
      ? report.earliest_hallucination_level
      : null;
  const collapseLevels = series
    .map((s) => s.collapse)
    .filter((c): c is number => c != null);
  const collapseX = collapseLevels.length ? Math.min(...collapseLevels) : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Headline cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HallucinationThresholdCard report={report} />
        <CollapseCard series={series} />
        <RobustnessCard report={report} />
      </div>

      {/* Two-column content */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
        {/* Left: charts */}
        <div className="flex flex-col gap-8 xl:col-span-3">
          <ChartCard title="Auditory Stability Curve">
            <Plot
              {...stabilityChart(series, hallX, collapseX, maxLevel)}
              useResizeHandler
              style={{ width: "100%", height: "340px" }}
            />
          </ChartCard>

          <ChartCard title="Confidence Trajectory">
            <Plot
              {...confidenceChart(series)}
              useResizeHandler
              style={{ width: "100%", height: "300px" }}
            />
          </ChartCard>

          <ChartCard title="Word Error Rate Curve">
            <Plot
              {...werChart(series, hallX, collapseX, maxLevel)}
              useResizeHandler
              style={{ width: "100%", height: "300px" }}
            />
          </ChartCard>
        </div>

        {/* Right: comparison + timelines */}
        <div className="flex flex-col gap-8 xl:col-span-2">
          <ComparisonPanel series={series} />
          <FailureTimelinePanel
            series={series}
            transcriptMap={transcriptMap}
            referenceTranscript={hallucination?.reference_transcript ?? ""}
          />
        </div>
      </div>
    </div>
  );
}

/* Headline cards */

function HeadlineCard({
  label,
  accent,
  children,
}: {
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border bg-bg-card p-5"
      style={{ borderColor: `color-mix(in srgb, ${accent} 35%, var(--border-subtle))` }}
    >
      <p className="mono text-[0.65rem] uppercase tracking-[0.25em] text-text-secondary">
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function HallucinationThresholdCard({ report }: { report: ExperimentReport }) {
  const detected = report.earliest_hallucination_level >= 0;
  const accent = detected ? COLOR.purple : COLOR.green;
  const dist = report.per_distortion.find(
    (d) => d.distortion_type === report.earliest_hallucination_distortion,
  );
  const intensity = dist?.hallucination_threshold_intensity ?? null;

  return (
    <HeadlineCard label="Hallucination Threshold" accent={accent}>
      {detected ? (
        <>
          <p className="metric-value" style={{ color: accent }}>
            {humanize(report.earliest_hallucination_distortion)}
          </p>
          <hr className="signal-line my-3" />
          <p className="mono text-sm text-text-primary">
            LEVEL {report.earliest_hallucination_level}
            {intensity != null && (
              <span className="text-text-secondary">
                {" / "}
                {intensity <= 1
                  ? `${(intensity * 100).toFixed(0)}%`
                  : intensity.toFixed(1)}
              </span>
            )}
          </p>
          <p className="mono mt-2 text-xs font-bold tracking-widest" style={{ color: accent }}>
            DETECTED
          </p>
        </>
      ) : (
        <>
          <p className="metric-value glow-green" style={{ color: accent }}>
            ROBUST
          </p>
          <hr className="signal-line my-3" />
          <p className="mono text-xs font-bold tracking-widest" style={{ color: accent }}>
            NOT DETECTED
          </p>
        </>
      )}
    </HeadlineCard>
  );
}

function CollapseCard({ series }: { series: Series[] }) {
  const collapsed = series
    .filter((s) => s.collapse != null)
    .sort((a, b) => (a.collapse! - b.collapse!));
  const first = collapsed[0];
  const accent = first ? COLOR.red : COLOR.green;

  // Confidence at the collapse level for that distortion.
  const conf =
    first != null
      ? first.confidence[first.levels.indexOf(first.collapse!)] ?? null
      : null;

  return (
    <HeadlineCard label="Perception Collapse" accent={accent}>
      {first ? (
        <>
          <p className="metric-value" style={{ color: accent }}>
            LEVEL {first.collapse}
          </p>
          <p className="mono mt-1 text-xs text-text-secondary">{first.name}</p>
          <hr className="signal-line my-3" />
          {conf != null && (
            <p className="mono text-sm text-text-primary">
              CONFIDENCE: <span style={{ color: accent }}>{conf.toFixed(0)}%</span>
            </p>
          )}
          <p className="mono mt-2 text-xs font-bold tracking-widest glow-red" style={{ color: accent }}>
            CRITICAL
          </p>
        </>
      ) : (
        <>
          <p className="metric-value glow-green" style={{ color: accent }}>
            STABLE
          </p>
          <hr className="signal-line my-3" />
          <p className="mono text-xs font-bold tracking-widest" style={{ color: accent }}>
            NO COLLAPSE DETECTED
          </p>
        </>
      )}
    </HeadlineCard>
  );
}

function RobustnessCard({ report }: { report: ExperimentReport }) {
  const accent = ROBUSTNESS_COLOR[report.overall_robustness];
  return (
    <HeadlineCard label="Overall Robustness" accent={accent}>
      <p className="metric-value uppercase" style={{ color: accent }}>
        {report.overall_robustness}
      </p>
      <hr className="signal-line my-3" />
      <p className="mono text-xs text-text-secondary">
        <span className="text-text-primary">
          {humanize(report.most_dangerous_distortion)}
        </span>{" "}
        is most dangerous
      </p>
    </HeadlineCard>
  );
}

/* Plotly chart builders */

/* eslint-disable @typescript-eslint/no-explicit-any */

function baseLayout(title: string): any {
  return {
    title: {
      text: title,
      font: { family: "Space Mono, monospace", color: COLOR.textPrimary, size: 14 },
      x: 0,
      xanchor: "left",
    },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Space Mono, monospace", color: COLOR.textSecondary, size: 11 },
    margin: { l: 52, r: 18, t: 44, b: 44 },
    legend: {
      orientation: "h",
      y: -0.22,
      font: { color: COLOR.textSecondary, size: 10 },
      bgcolor: "rgba(0,0,0,0)",
    },
    hoverlabel: {
      bgcolor: COLOR.bgElevated,
      bordercolor: COLOR.border,
      font: { family: "Space Mono, monospace", color: COLOR.textPrimary },
    },
    xaxis: axis("Distortion Intensity Level"),
    yaxis: axis(""),
  };
}

function axis(title: string): any {
  return {
    title: title ? { text: title, font: { size: 11, color: COLOR.textMuted } } : undefined,
    gridcolor: COLOR.border,
    zerolinecolor: COLOR.border,
    linecolor: COLOR.border,
    tickfont: { color: COLOR.textSecondary, size: 10 },
  };
}

const CHART_CONFIG: any = {
  responsive: true,
  displaylogo: false,
  displayModeBar: false,
};

/** Green/yellow/red background bands based on aggregate threshold + collapse. */
function zoneShapes(
  hallX: number | null,
  collapseX: number | null,
  maxLevel: number,
): any[] {
  const shapes: any[] = [];
  const band = (x0: number, x1: number, color: string) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0,
    x1,
    y0: 0,
    y1: 1,
    fillcolor: color,
    line: { width: 0 },
    layer: "below",
  });
  const greenEnd = hallX ?? collapseX ?? maxLevel;
  shapes.push(band(0, greenEnd, "rgba(0,230,118,0.06)"));
  if (hallX != null) {
    const yellowEnd = collapseX ?? maxLevel;
    shapes.push(band(hallX, yellowEnd, "rgba(255,179,0,0.07)"));
  }
  if (collapseX != null) {
    shapes.push(band(collapseX, maxLevel, "rgba(255,23,68,0.08)"));
  }
  return shapes;
}

function markerLines(hallX: number | null, collapseX: number | null): any[] {
  const lines: any[] = [];
  const vline = (x: number, color: string) => ({
    type: "line",
    xref: "x",
    yref: "paper",
    x0: x,
    x1: x,
    y0: 0,
    y1: 1,
    line: { color, width: 1.5, dash: "dash" },
  });
  if (hallX != null) lines.push(vline(hallX, COLOR.purple));
  if (collapseX != null) lines.push(vline(collapseX, COLOR.red));
  return lines;
}

function markerAnnotations(
  hallX: number | null,
  collapseX: number | null,
  maxLevel: number,
): any[] {
  const anns: any[] = [];
  const annotation = (x: number, y: number, text: string, color: string) => {
    const nearRightEdge = x >= maxLevel - 1;
    return {
      x,
      y,
      yref: "paper",
      text,
      showarrow: true,
      arrowhead: 0,
      arrowsize: 0.6,
      arrowwidth: 1,
      arrowcolor: color,
      ax: nearRightEdge ? -10 : 10,
      ay: 0,
      xanchor: nearRightEdge ? "right" : "left",
      yanchor: "bottom",
      align: nearRightEdge ? "right" : "left",
      bgcolor: COLOR.bgElevated,
      bordercolor: color,
      borderwidth: 1,
      borderpad: 4,
      font: { color, size: 10, family: "Space Mono, monospace" },
    };
  };
  if (hallX != null)
    anns.push({
      ...annotation(hallX, 0.98, "Hallucination detected", COLOR.purple),
    });
  if (collapseX != null)
    anns.push({
      ...annotation(collapseX, 0.84, "Collapse", COLOR.red),
    });
  return anns;
}

function lineTrace(s: Series, ys: number[]): any {
  return {
    x: s.levels,
    y: ys,
    type: "scatter",
    mode: "lines+markers",
    name: s.name,
    line: { color: s.color, width: 2, shape: "spline" },
    marker: { size: 5, color: s.color },
  };
}

function stabilityChart(
  series: Series[],
  hallX: number | null,
  collapseX: number | null,
  maxLevel: number,
) {
  const layout = baseLayout("Auditory Stability Curve");
  layout.yaxis = { ...axis("Understanding Quality"), range: [0, 100] };
  layout.shapes = [...zoneShapes(hallX, collapseX, maxLevel), ...markerLines(hallX, collapseX)];
  layout.annotations = markerAnnotations(hallX, collapseX, maxLevel);
  return {
    data: series.map((s) => lineTrace(s, s.quality)),
    layout,
    config: CHART_CONFIG,
  };
}

function confidenceChart(series: Series[]) {
  const layout = baseLayout("Confidence Trajectory");
  layout.yaxis = { ...axis("Confidence Score"), range: [0, 100] };
  layout.shapes = [
    {
      type: "line",
      xref: "paper",
      yref: "y",
      x0: 0,
      x1: 1,
      y0: 25,
      y1: 25,
      line: { color: COLOR.red, width: 1.5, dash: "dash" },
    },
  ];
  layout.annotations = [
    {
      x: 1,
      y: 25,
      xref: "paper",
      yref: "y",
      text: "Collapse threshold (25)",
      showarrow: false,
      xanchor: "right",
      yanchor: "bottom",
      font: { color: COLOR.red, size: 10, family: "Space Mono, monospace" },
    },
  ];
  return {
    data: series.map((s) => lineTrace(s, s.confidence)),
    layout,
    config: CHART_CONFIG,
  };
}

function werChart(
  series: Series[],
  hallX: number | null,
  collapseX: number | null,
  maxLevel: number,
) {
  const layout = baseLayout("Word Error Rate Curve");
  layout.yaxis = { ...axis("WER"), ticksuffix: "%", rangemode: "tozero" };
  layout.shapes = [...zoneShapes(hallX, collapseX, maxLevel), ...markerLines(hallX, collapseX)];
  layout.annotations = markerAnnotations(hallX, collapseX, maxLevel);
  return {
    data: series.map((s) => lineTrace(s, s.wer)),
    layout,
    config: CHART_CONFIG,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/* Right column: comparison panel */

function ComparisonPanel({ series }: { series: Series[] }) {
  return (
    <PanelCard title="Distortion Comparison">
      <div className="flex flex-col divide-y divide-border-subtle">
        {series.map((s) => {
          const sev = severityFor(s.robustness);
          return (
            <div key={s.type} className="flex items-center gap-3 py-3">
              <div className="w-28 shrink-0">
                <p className="text-sm font-semibold text-text-primary">{s.name}</p>
                <p className="mono text-xs" style={{ color: s.color }}>
                  {s.hallThreshold != null ? `Threshold L${s.hallThreshold}` : "Robust"}
                </p>
              </div>
              <Sparkline values={s.confidence} color={s.color} />
              <span
                className="mono ml-auto shrink-0 rounded-full px-2 py-1 text-[0.6rem] font-bold tracking-wider"
                style={{
                  color: sev.color,
                  border: `1px solid ${sev.color}`,
                  background: `color-mix(in srgb, ${sev.color} 12%, transparent)`,
                }}
              >
                {sev.label}
              </span>
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}

/** Hand-coded SVG sparkline of a 0–100 series. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 96;
  const h = 30;
  const pad = 2;
  if (values.length < 2) {
    return <svg width={w} height={h} className="opacity-50" />;
  }
  const max = 100;
  const pts = values
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
      const y = h - pad - (clamp(v, 0, max) / max) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Right column: failure stage timelines */

function FailureTimelinePanel({
  series,
  transcriptMap,
  referenceTranscript,
}: {
  series: Series[];
  transcriptMap: Map<string, string>;
  referenceTranscript: string;
}) {
  return (
    <PanelCard title="Failure Stage Timeline">
      {referenceTranscript && (
        <p className="mono mb-4 rounded-md border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
          <span className="text-text-muted">REFERENCE: </span>
          {referenceTranscript}
        </p>
      )}

      <div className="flex flex-col gap-5">
        {series.map((s) => (
          <StageRow key={s.type} series={s} transcriptMap={transcriptMap} />
        ))}
      </div>

      {/* Stage color legend */}
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 border-t border-border-subtle pt-4">
        {(Object.keys(STAGE_COLOR) as FailureStage[]).map((stage) => (
          <span key={stage} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: STAGE_COLOR[stage], boxShadow: `0 0 5px ${STAGE_COLOR[stage]}` }}
            />
            <span className="mono text-[0.6rem] uppercase tracking-wider text-text-secondary">
              {STAGE_LABEL[stage]}
            </span>
          </span>
        ))}
      </div>
    </PanelCard>
  );
}

function StageRow({
  series,
  transcriptMap,
}: {
  series: Series;
  transcriptMap: Map<string, string>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const excerpt =
    hover != null
      ? transcriptMap.get(`${series.type}:${hover}`) ?? "(no transcript)"
      : "";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">{series.name}</span>
      </div>
      <div className="relative flex items-center">
        {/* connector line */}
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border-subtle" />
        <div className="relative flex w-full items-center justify-between">
          {series.stages.map((st) => {
            const color = STAGE_COLOR[st.stage_name];
            const active = hover === st.level;
            return (
              <button
                key={st.level}
                type="button"
                title={transcriptMap.get(`${series.type}:${st.level}`) ?? ""}
                onMouseEnter={() => setHover(st.level)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(st.level)}
                onBlur={() => setHover(null)}
                aria-label={`Level ${st.level}: ${STAGE_LABEL[st.stage_name]}`}
                className="relative z-10 flex h-4 w-4 items-center justify-center rounded-full border transition-transform hover:scale-125"
                style={{
                  background: color,
                  borderColor: active ? COLOR.textPrimary : "transparent",
                  boxShadow: active ? `0 0 8px ${color}` : "none",
                }}
              />
            );
          })}
        </div>
      </div>
      <p className="mono mt-2 h-8 text-xs text-text-secondary">
        {hover != null ? (
          <>
            <span className="text-text-muted">L{hover}: </span>
            {excerpt.length > 90 ? `${excerpt.slice(0, 90)}…` : excerpt || "(empty)"}
          </>
        ) : (
          <span className="text-text-muted">Hover a level to inspect its transcript.</span>
        )}
      </p>
    </div>
  );
}

/* Shared shells */

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <h2 className="sr-only">{title}</h2>
      {children}
    </div>
  );
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="mono mb-4 text-xs uppercase tracking-[0.25em] text-text-secondary">
        {title}
      </h2>
      {children}
    </div>
  );
}

/* Loading / error / chart-loading states */

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonBox key={i} className="h-40" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
        <div className="flex flex-col gap-8 xl:col-span-3">
          <SkeletonBox className="h-[340px]" />
          <SkeletonBox className="h-[300px]" />
          <SkeletonBox className="h-[300px]" />
        </div>
        <div className="flex flex-col gap-8 xl:col-span-2">
          <SkeletonBox className="h-64" />
          <SkeletonBox className="h-80" />
        </div>
      </div>
    </div>
  );
}

function SkeletonBox({ className = "" }: { className?: string }) {
  return (
    <div
      className={`skeleton rounded-lg border border-border-subtle bg-bg-card ${className}`}
    />
  );
}

function ChartSkeleton() {
  return <SkeletonBox className="h-[300px] w-full" />;
}

function ErrorState({ id, message }: { id: string; message: string }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-8 text-center">
      <p className="mono text-sm font-bold text-danger glow-red">
        Could not load experiment
      </p>
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

const SHIMMER_CSS = `
.skeleton {
  position: relative;
  overflow: hidden;
}
.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 229, 255, 0.06) 50%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: shimmer 1.6s ease-in-out infinite;
}
@keyframes shimmer {
  100% { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton::after { animation: none; }
}
`;
