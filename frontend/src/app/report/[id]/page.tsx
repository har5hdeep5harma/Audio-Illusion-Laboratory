/**
 * report/[id]/page.tsx — Failure Report (flagship output artifact).
 *
 * An archival, instrument-generated scientific report: executive summary,
 * per-distortion analysis (collapsible, with a compact stability curve, key
 * findings, and a failure-path strip), comparative analysis, a tabbed metric
 * breakdown, conditionally-generated recommendations, and export actions.
 *
 * Plotly is loaded client-only via next/dynamic. The report is fetched from
 * GET /api/report; drift data comes from GET /api/metrics (best-effort).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

import api from "@/services/api";
import type {
  DistortionReport,
  ExperimentReport,
  FailureStage,
  MetricsPayload,
  RobustnessGrade,
} from "@/types";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded bg-bg-secondary" />,
});

/* Tokens & helpers */

const COLOR = {
  bgElevated: "#FFFAF0",
  border: "#C8BDA9",
  textPrimary: "#1D2925",
  textSecondary: "#5F665D",
  textMuted: "#8D8A7D",
  cyan: "#D34A2F",
  green: "#657D4D",
  amber: "#C49125",
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

const STAGE_SHORT: Record<FailureStage, string> = {
  stable_perception: "STABLE",
  perceptual_drift: "DRIFT",
  semantic_drift: "SEM·DRIFT",
  hallucination: "HALLUC",
  collapse: "COLLAPSE",
};

const DISTORTION_COLOR: Record<string, string> = {
  WHITE_NOISE: COLOR.cyan,
  ECHO: COLOR.amber,
  COMPRESSION: COLOR.orange,
  SPEED_SHIFT: COLOR.green,
  PITCH_SHIFT: COLOR.purple,
  COMBINED: COLOR.red,
};

const RISK: Record<RobustnessGrade, { label: string; color: string }> = {
  high: { label: "Robust", color: COLOR.green },
  moderate: { label: "Moderate Risk", color: COLOR.amber },
  low: { label: "Elevated Risk", color: COLOR.orange },
  critical: { label: "Critical Risk", color: COLOR.red },
};

const humanize = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const quality = (c: number, h: number) => clamp(0.5 * c + 50 * (1 - h));
const fmtIntensity = (i: number | null) =>
  i == null ? "—" : i <= 1 ? `${(i * 100).toFixed(0)}%` : i.toFixed(1);

/* Derived series */

type Series = {
  type: string;
  name: string;
  color: string;
  levels: number[];
  wer: number[];
  confidence: number[];
  hallucination: number[];
  quality: number[];
  drift: number[] | null;
};

/* Page */

export default function ReportPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([api.getReport(id), api.getMetrics(id).catch(() => null)])
      .then(([rep, met]) => {
        if (!alive) return;
        setReport(rep);
        setMetrics(met);
      })
      .catch((e: unknown) =>
        alive && setError(e instanceof Error ? e.message : "Failed to load report."),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const series: Series[] = useMemo(() => {
    if (!report) return [];
    return report.per_distortion.map((d) => {
      const stages = [...d.stages].sort((a, b) => a.level - b.level);
      const driftBlock = metrics?.distortions[d.distortion_type];
      const driftByLevel = new Map(
        driftBlock?.levels.map((l) => [l.level_index, l.drift_index]) ?? [],
      );
      const levels = stages.map((s) => s.level);
      return {
        type: d.distortion_type,
        name: humanize(d.distortion_type),
        color: DISTORTION_COLOR[d.distortion_type] ?? COLOR.cyan,
        levels,
        wer: stages.map((s) => s.wer * 100),
        confidence: stages.map((s) => s.confidence),
        hallucination: stages.map((s) => s.hallucination_score),
        quality: stages.map((s) => quality(s.confidence, s.hallucination_score)),
        drift: driftBlock ? levels.map((lv) => (driftByLevel.get(lv) ?? 0) * 100) : null,
      };
    });
  }, [report, metrics]);

  if (error) return <Shell><ErrorState id={id} message={error} /></Shell>;
  if (loading || !report) return <Shell><LoadingState /></Shell>;

  return (
    <Shell>
      <ReportHeader report={report} />
      <ExecutiveSummary report={report} />
      <PerDistortionSection report={report} series={series} />
      <ComparativeSection report={report} />
      <MetricBreakdown series={series} hasDrift={!!metrics} />
      <Recommendations report={report} series={series} />
      <ExportActions report={report} onNew={() => router.push("/experiment")} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-10">
      <style>{REPORT_CSS}</style>
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

/* Header */

function ReportHeader({ report }: { report: ExperimentReport }) {
  const generated = safeDate(report.generated_at);
  return (
    <header className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* AIL seal */}
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent-cyan/60 bg-bg-card">
            <span className="mono text-sm font-bold tracking-[0.15em] text-accent-cyan glow-cyan">
              AIL
            </span>
          </div>
          <div>
            <p className="mono text-[0.65rem] uppercase tracking-[0.35em] text-text-muted">
              Audio Illusion Laboratory
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
              Auditory Failure Report
            </h1>
          </div>
        </div>
        <span className="mono rounded border border-border-subtle px-2 py-1 text-[0.6rem] text-text-muted">
          CONFIDENTIAL · INSTRUMENT-GENERATED
        </span>
      </div>

      <dl className="mono mt-6 grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
        <Meta label="Specimen" value={report.filename} />
        <Meta label="Duration" value={`${report.duration_seconds.toFixed(1)} s`} />
        <Meta label="Generated" value={generated} />
      </dl>

      <Divider label="REPORT BEGINS" />
    </header>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6rem] uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-text-primary">{value}</dd>
    </div>
  );
}

/* Section 1: Executive summary */

function ExecutiveSummary({ report }: { report: ExperimentReport }) {
  const risk = RISK[report.overall_robustness];
  const firstLevel =
    report.earliest_hallucination_level >= 0
      ? `Level ${report.earliest_hallucination_level}`
      : "None";
  return (
    <section className="mb-10">
      <SectionLabel n="01" title="Executive Summary" />
      <div className="rounded-lg border border-border-subtle bg-bg-elevated p-6 shadow-glow-cyan/0">
        <p className="text-base leading-relaxed text-text-primary">
          {report.executive_summary}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Verdict label="Robustness" value={risk.label} color={risk.color} />
          <Verdict
            label="Most Dangerous"
            value={humanize(report.most_dangerous_distortion)}
            color={COLOR.red}
          />
          <Verdict
            label="First Hallucination"
            value={firstLevel}
            color={report.earliest_hallucination_level >= 0 ? COLOR.purple : COLOR.green}
          />
        </div>
      </div>
    </section>
  );
}

function Verdict({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="rounded-md border px-4 py-2"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--border-subtle))` }}
    >
      <p className="mono text-[0.55rem] uppercase tracking-[0.2em] text-text-muted">{label}</p>
      <p className="mono mt-0.5 text-sm font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

/* Section 2: Per-distortion analysis */

function PerDistortionSection({
  report,
  series,
}: {
  report: ExperimentReport;
  series: Series[];
}) {
  const [open, setOpen] = useState<string | null>(
    report.per_distortion[0]?.distortion_type ?? null,
  );
  return (
    <section className="mb-10">
      <SectionLabel n="02" title="Per-Distortion Analysis" />
      <div className="flex flex-col gap-3">
        {report.per_distortion.map((d) => (
          <DistortionPanel
            key={d.distortion_type}
            d={d}
            s={series.find((x) => x.type === d.distortion_type)}
            isOpen={open === d.distortion_type}
            onToggle={() =>
              setOpen((cur) => (cur === d.distortion_type ? null : d.distortion_type))
            }
          />
        ))}
      </div>
    </section>
  );
}

function DistortionPanel({
  d,
  s,
  isOpen,
  onToggle,
}: {
  d: DistortionReport;
  s: Series | undefined;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const color = DISTORTION_COLOR[d.distortion_type] ?? COLOR.cyan;
  const risk = RISK[d.overall_robustness];
  const collapseWer =
    d.collapse_point_level != null
      ? d.stages.find((x) => x.level === d.collapse_point_level)?.wer
      : undefined;

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-bg-elevated"
      >
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
          <span className="text-sm font-semibold text-text-primary">{humanize(d.distortion_type)}</span>
          <span className="stage-badge" style={{ color: risk.color }}>
            {risk.label}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="mono hidden text-xs text-text-secondary sm:inline">
            peak {d.peak_hallucination_score.toFixed(2)} · thr{" "}
            {d.hallucination_threshold_level ?? "—"}
          </span>
          <span className="mono text-text-muted">{isOpen ? "−" : "+"}</span>
        </div>
      </button>

      {isOpen && (
        <div className="grid grid-cols-1 gap-6 border-t border-border-subtle p-5 lg:grid-cols-2">
          <div>
            <p className="mono mb-2 text-[0.6rem] uppercase tracking-wider text-text-muted">
              Stability Curve
            </p>
            {s ? (
              <Plot
                {...miniStability(s)}
                useResizeHandler
                style={{ width: "100%", height: "170px" }}
              />
            ) : (
              <p className="mono text-xs text-text-muted">No data.</p>
            )}
            <FailurePath stages={d.stages} />
          </div>

          <div>
            <p className="mono mb-2 text-[0.6rem] uppercase tracking-wider text-text-muted">
              Key Findings
            </p>
            <table className="w-full border-collapse text-sm">
              <tbody>
                <FindingRow
                  label="Hallucination Threshold"
                  value={
                    d.hallucination_threshold_level != null
                      ? `Level ${d.hallucination_threshold_level} (${fmtIntensity(d.hallucination_threshold_intensity)})`
                      : "Not detected"
                  }
                />
                <FindingRow
                  label="Perception Collapse"
                  value={d.collapse_point_level != null ? `Level ${d.collapse_point_level}` : "None"}
                />
                <FindingRow
                  label="Confidence at Collapse"
                  value={d.collapse_confidence != null ? `${d.collapse_confidence.toFixed(0)}%` : "—"}
                />
                <FindingRow
                  label="WER at Collapse"
                  value={collapseWer != null ? `${(collapseWer * 100).toFixed(0)}%` : "—"}
                />
                <FindingRow label="Failure Classification" value={risk.label} valueColor={risk.color} />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FindingRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <tr className="border-b border-border-subtle/60">
      <td className="py-2 pr-4 text-text-secondary">{label}</td>
      <td className="mono py-2 text-right font-bold" style={{ color: valueColor ?? "var(--text-primary)" }}>
        {value}
      </td>
    </tr>
  );
}

function FailurePath({ stages }: { stages: DistortionReport["stages"] }) {
  const ordered = [...stages].sort((a, b) => a.level - b.level);
  return (
    <div className="mt-4">
      <p className="mono mb-2 text-[0.6rem] uppercase tracking-wider text-text-muted">
        Failure Path
      </p>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {ordered.map((st, i) => (
          <div key={st.level} className="flex items-center gap-1">
            {i > 0 && <span className="text-text-muted">→</span>}
            <span
              title={`Level ${st.level}: ${st.label}`}
              className="mono whitespace-nowrap rounded px-1.5 py-1 text-[0.55rem] font-bold"
              style={{
                color: STAGE_COLOR[st.stage_name],
                background: `color-mix(in srgb, ${STAGE_COLOR[st.stage_name]} 14%, transparent)`,
              }}
            >
              {STAGE_SHORT[st.stage_name]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Section 3: Comparative analysis */

function ComparativeSection({ report }: { report: ExperimentReport }) {
  const maxLevel = Math.max(
    1,
    ...report.per_distortion.map((d) => d.stages.length - 1),
  );

  // Most robust: prefer never-hallucinated; else highest threshold level.
  const mostRobust = useMemo(() => {
    const sorted = [...report.per_distortion].sort((a, b) => {
      const av = a.hallucination_threshold_level ?? Number.POSITIVE_INFINITY;
      const bv = b.hallucination_threshold_level ?? Number.POSITIVE_INFINITY;
      if (av !== bv) return bv - av; // higher threshold = more robust
      return a.peak_hallucination_score - b.peak_hallucination_score;
    });
    return sorted[0] ?? null;
  }, [report]);

  return (
    <section className="mb-10">
      <SectionLabel n="03" title="Comparative Analysis" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="rounded-lg border border-border-subtle bg-bg-card p-4 lg:col-span-3">
          <p className="mono mb-2 text-[0.6rem] uppercase tracking-wider text-text-muted">
            Hallucination Onset by Distortion (shorter = more dangerous)
          </p>
          <Plot
            {...thresholdBarChart(report, maxLevel)}
            useResizeHandler
            style={{ width: "100%", height: "260px" }}
          />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Spotlight
            label="Most Dangerous Distortion"
            name={humanize(report.most_dangerous_distortion)}
            detail={
              report.earliest_hallucination_level >= 0
                ? `Hallucinated at level ${report.earliest_hallucination_level}`
                : "Most destabilizing perturbation"
            }
            color={COLOR.red}
            icon="⚠"
          />
          {mostRobust && (
            <Spotlight
              label="Most Robust Against"
              name={humanize(mostRobust.distortion_type)}
              detail={
                mostRobust.hallucination_threshold_level == null
                  ? "No hallucination across range"
                  : `Held until level ${mostRobust.hallucination_threshold_level}`
              }
              color={COLOR.green}
              icon="✓"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Spotlight({
  label,
  name,
  detail,
  color,
  icon,
}: {
  label: string;
  name: string;
  detail: string;
  color: string;
  icon: string;
}) {
  return (
    <div
      className="rounded-lg border bg-bg-card p-5"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--border-subtle))` }}
    >
      <p className="mono text-[0.6rem] uppercase tracking-[0.2em] text-text-muted">{label}</p>
      <p className="mt-2 flex items-center gap-2 text-xl font-semibold" style={{ color }}>
        <span aria-hidden>{icon}</span>
        {name}
      </p>
      <p className="mono mt-1 text-xs text-text-secondary">{detail}</p>
    </div>
  );
}

/* Section 4: Metric breakdown */

type MetricKey = "wer" | "confidence" | "hallucination" | "drift";

function MetricBreakdown({ series, hasDrift }: { series: Series[]; hasDrift: boolean }) {
  const [tab, setTab] = useState<MetricKey>("wer");
  const tabs: { key: MetricKey; label: string }[] = [
    { key: "wer", label: "WER" },
    { key: "confidence", label: "Confidence" },
    { key: "hallucination", label: "Hallucination" },
    { key: "drift", label: "Drift" },
  ];
  return (
    <section className="mb-10">
      <SectionLabel n="04" title="Metric Breakdown" />
      <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
        <div className="mb-3 flex gap-1 border-b border-border-subtle">
          {tabs.map((t) => {
            const active = tab === t.key;
            const disabled = t.key === "drift" && !hasDrift;
            return (
              <button
                key={t.key}
                type="button"
                disabled={disabled}
                onClick={() => setTab(t.key)}
                className={[
                  "mono px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-40",
                  active ? "border-b-2 border-accent-cyan text-accent-cyan" : "text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {tab === "drift" && !hasDrift ? (
          <p className="mono py-12 text-center text-xs text-text-muted">
            Drift data unavailable.
          </p>
        ) : (
          <Plot
            {...metricChart(series, tab)}
            useResizeHandler
            style={{ width: "100%", height: "300px" }}
          />
        )}
      </div>
    </section>
  );
}

/* Section 5: Recommendations */

type Rec = { title: string; body: string; color: string };

function Recommendations({ report, series }: { report: ExperimentReport; series: Series[] }) {
  const recs = useMemo(() => buildRecommendations(report, series), [report, series]);
  return (
    <section className="mb-10">
      <SectionLabel n="05" title="Recommendations" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {recs.map((r, i) => (
          <div
            key={i}
            className="rounded-lg border bg-bg-card p-5"
            style={{ borderColor: `color-mix(in srgb, ${r.color} 35%, var(--border-subtle))` }}
          >
            <div className="mb-2 h-1 w-8 rounded-full" style={{ background: r.color }} />
            <p className="text-sm font-semibold text-text-primary">{r.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-text-secondary">{r.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildRecommendations(report: ExperimentReport, series: Series[]): Rec[] {
  const recs: Rec[] = [];
  const earliest = report.earliest_hallucination_distortion;

  const collapses = report.per_distortion
    .filter((d) => d.collapse_point_level != null)
    .sort((a, b) => (a.collapse_point_level! - b.collapse_point_level!));
  const earliestCollapse = collapses[0];

  if (
    report.most_dangerous_distortion === "COMBINED" ||
    earliest === "COMBINED" ||
    earliestCollapse?.distortion_type === "COMBINED"
  ) {
    recs.push({
      title: "Vulnerable to compound distortion",
      body: "Model is particularly vulnerable to simultaneous perturbations — avoid deployment in noisy reverberant environments.",
      color: COLOR.red,
    });
  }

  if (confidenceLeadsWer(series)) {
    recs.push({
      title: "Confidence is an early-warning signal",
      body: "Confidence collapsed before word error rate — monitor confidence drops as a precursor to quality degradation.",
      color: COLOR.cyan,
    });
  }

  if (report.earliest_hallucination_level >= 0 && report.earliest_hallucination_level <= 2) {
    recs.push({
      title: "Hallucinates under mild distortion",
      body: `${humanize(earliest)} induced fabricated output by level ${report.earliest_hallucination_level} — gate transcripts behind a confidence threshold before trusting them.`,
      color: COLOR.purple,
    });
  }

  if (report.overall_robustness === "high" || report.earliest_hallucination_level < 0) {
    recs.push({
      title: "Degrades gracefully",
      body: "No early hallucination was observed — the model stays usable across the tested distortion range with light confidence monitoring.",
      color: COLOR.green,
    });
  }

  // Always-available fallback so we can show three cards.
  recs.push({
    title: `Harden against ${humanize(report.most_dangerous_distortion)}`,
    body: `${humanize(report.most_dangerous_distortion)} was the most destabilizing perturbation — prioritize preprocessing and robustness testing against it before deployment.`,
    color: COLOR.amber,
  });

  return recs.slice(0, 3);
}

/** True if any distortion's confidence falls below 25 before its WER exceeds 60%. */
function confidenceLeadsWer(series: Series[]): boolean {
  return series.some((s) => {
    const confLevel = s.confidence.findIndex((c) => c < 25);
    const werLevel = s.wer.findIndex((w) => w > 60);
    if (confLevel < 0) return false;
    if (werLevel < 0) return true; // confidence collapsed; WER never did
    return confLevel < werLevel;
  });
}

/* Export actions */

function ExportActions({
  report,
  onNew,
}: {
  report: ExperimentReport;
  onNew: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(report.experiment_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${report.experiment_id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = () => {
    const headers = [
      "distortion_type",
      "level",
      "label",
      "stage",
      "wer",
      "confidence",
      "hallucination_score",
    ];
    const rows = report.per_distortion.flatMap((distortion) =>
      distortion.stages.map((stage) => [
        distortion.distortion_type,
        stage.level,
        stage.label,
        stage.stage_name,
        stage.wer,
        stage.confidence,
        stage.hallucination_score,
      ]),
    );
    const escape = (value: string | number) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${report.experiment_id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadHtml = () => {
    const sections = report.per_distortion
      .map((distortion) => {
        const rows = distortion.stages
          .map(
            (stage) => `<tr><td>${escapeHtml(String(stage.level))}</td><td>${escapeHtml(stage.label)}</td><td>${escapeHtml(stage.stage_name)}</td><td>${stage.wer.toFixed(3)}</td><td>${stage.confidence.toFixed(1)}</td><td>${stage.hallucination_score.toFixed(3)}</td></tr>`,
          )
          .join("");
        return `<section><h2>${escapeHtml(humanize(distortion.distortion_type))}</h2>${buildReportChart(distortion)}<table><thead><tr><th>Level</th><th>Label</th><th>Stage</th><th>WER</th><th>Confidence</th><th>Hallucination</th></tr></thead><tbody>${rows}</tbody></table></section>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Audio Illusion Report ${escapeHtml(report.experiment_id)}</title><style>${REPORT_EXPORT_CSS}</style></head><body><header><p>Audio Illusion Laboratory</p><h1>Auditory Failure Report</h1><dl><dt>Specimen</dt><dd>${escapeHtml(report.filename)}</dd><dt>Generated</dt><dd>${escapeHtml(report.generated_at)}</dd><dt>Overall robustness</dt><dd>${escapeHtml(report.overall_robustness)}</dd></dl></header><article><h2>Executive Summary</h2><p>${escapeHtml(report.executive_summary)}</p>${sections}</article></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${report.experiment_id}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Divider label="END OF REPORT" />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={copyId}
          className="mono rounded-md border border-border-subtle px-5 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent-cyan hover:text-accent-cyan"
        >
          {copied ? "✓ Copied" : "Copy Report ID"}
        </button>
        <button
          type="button"
          onClick={downloadJson}
          className="mono rounded-md border border-accent-cyan/60 px-5 py-2.5 text-xs font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/10"
        >
          Download JSON
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          className="mono rounded-md border border-border-subtle px-5 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent-cyan hover:text-accent-cyan"
        >
          Download CSV
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="mono rounded-md border border-border-subtle px-5 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent-cyan hover:text-accent-cyan"
        >
          Print / Save PDF
        </button>
        <button
          type="button"
          onClick={downloadHtml}
          className="mono rounded-md border border-border-subtle px-5 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent-cyan hover:text-accent-cyan"
        >
          Download HTML
        </button>
        <button
          type="button"
          onClick={onNew}
          className="mono ml-auto rounded-md bg-accent-cyan px-5 py-2.5 text-xs font-bold text-bg-primary shadow-glow-cyan transition-transform hover:-translate-y-0.5"
        >
          Start New Experiment →
        </button>
      </div>
    </>
  );
}

/* Plotly builders */

/* eslint-disable @typescript-eslint/no-explicit-any */

function baseLayout(): any {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Space Mono, monospace", color: COLOR.textSecondary, size: 10 },
    margin: { l: 44, r: 14, t: 10, b: 36 },
    legend: { orientation: "h", y: -0.25, font: { size: 9, color: COLOR.textSecondary } },
    hoverlabel: {
      bgcolor: COLOR.bgElevated,
      bordercolor: COLOR.border,
      font: { family: "Space Mono, monospace", color: COLOR.textPrimary },
    },
    xaxis: axis("Level"),
    yaxis: axis(""),
  };
}

function axis(title: string): any {
  return {
    title: title ? { text: title, font: { size: 10, color: COLOR.textMuted } } : undefined,
    gridcolor: COLOR.border,
    zerolinecolor: COLOR.border,
    linecolor: COLOR.border,
    tickfont: { color: COLOR.textSecondary, size: 9 },
  };
}

const CHART_CONFIG: any = { responsive: true, displaylogo: false, displayModeBar: false };

function miniStability(s: Series): any {
  const layout = baseLayout();
  layout.yaxis = { ...axis("Quality"), range: [0, 100] };
  layout.showlegend = false;
  return {
    data: [
      {
        x: s.levels,
        y: s.quality,
        type: "scatter",
        mode: "lines+markers",
        line: { color: s.color, width: 2, shape: "spline" },
        marker: { size: 4, color: s.color },
        hovertemplate: "L%{x}: %{y:.0f}<extra></extra>",
      },
    ],
    layout,
    config: CHART_CONFIG,
  };
}

function thresholdBarChart(report: ExperimentReport, maxLevel: number): any {
  const layout = baseLayout();
  layout.xaxis = { ...axis(""), automargin: true };
  layout.yaxis = { ...axis("Hallucination Onset Level"), range: [0, maxLevel + 1] };
  layout.showlegend = false;
  const names = report.per_distortion.map((d) => humanize(d.distortion_type));
  // Never-hallucinated bars reach the top (safest); danger color by earliness.
  const values = report.per_distortion.map((d) =>
    d.hallucination_threshold_level == null ? maxLevel + 1 : d.hallucination_threshold_level,
  );
  const colors = report.per_distortion.map((d) => {
    if (d.hallucination_threshold_level == null) return COLOR.green;
    const danger = 1 - d.hallucination_threshold_level / (maxLevel || 1);
    return hallColor(danger);
  });
  const text = report.per_distortion.map((d) =>
    d.hallucination_threshold_level == null ? "robust" : `L${d.hallucination_threshold_level}`,
  );
  return {
    data: [
      {
        x: names,
        y: values,
        type: "bar",
        marker: { color: colors },
        text,
        textposition: "outside",
        textfont: { color: COLOR.textSecondary, size: 9, family: "Space Mono, monospace" },
        hovertemplate: "%{x}<br>onset %{text}<extra></extra>",
      },
    ],
    layout,
    config: CHART_CONFIG,
  };
}

function metricChart(series: Series[], key: MetricKey): any {
  const layout = baseLayout();
  const yTitle =
    key === "wer" ? "WER" : key === "confidence" ? "Confidence" : key === "drift" ? "Drift" : "Hallucination";
  if (key === "wer") layout.yaxis = { ...axis(yTitle), ticksuffix: "%", rangemode: "tozero" };
  else if (key === "confidence") layout.yaxis = { ...axis(yTitle), range: [0, 100] };
  else if (key === "drift") layout.yaxis = { ...axis(yTitle), ticksuffix: "%", rangemode: "tozero" };
  else layout.yaxis = { ...axis(yTitle), range: [0, 1] };

  const pick = (s: Series): number[] => {
    if (key === "wer") return s.wer;
    if (key === "confidence") return s.confidence;
    if (key === "drift") return s.drift ?? [];
    return s.hallucination;
  };

  return {
    data: series.map((s) => ({
      x: s.levels,
      y: pick(s),
      type: "scatter",
      mode: "lines+markers",
      name: s.name,
      line: { color: s.color, width: 2, shape: "spline" },
      marker: { size: 4, color: s.color },
    })),
    layout,
    config: CHART_CONFIG,
  };
}

function hallColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  const stops: [number, [number, number, number]][] = [
    [0.0, [0, 230, 118]],
    [0.4, [255, 179, 0]],
    [0.75, [213, 0, 249]],
    [1.0, [255, 23, 68]],
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
  return "rgb(255, 23, 68)";
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/* Shared bits & states  */

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="mono text-xs text-accent-cyan">§{n}</span>
      <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-text-primary">
        {title}
      </h2>
      <hr className="signal-line flex-1" />
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-8 flex items-center gap-4">
      <hr className="signal-line flex-1" />
      <span className="mono text-[0.6rem] uppercase tracking-[0.3em] text-text-muted">{label}</span>
      <hr className="signal-line flex-1" />
    </div>
  );
}

function safeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function buildReportChart(report: DistortionReport): string {
  const width = 720;
  const height = 220;
  const pad = 32;
  const values = report.stages.map((stage) => quality(stage.confidence, stage.hallucination_score));
  const maxIndex = Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => {
      const x = pad + (index / maxIndex) * (width - pad * 2);
      const y = height - pad - (value / 100) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Quality across distortion levels"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"/><polyline points="${points}"/><text x="${pad}" y="18">quality</text><text x="${width - pad}" y="${height - 8}" text-anchor="end">level</text></svg>`;
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="skeleton h-20 rounded-lg border border-border-subtle bg-bg-card" />
      <div className="skeleton h-40 rounded-lg border border-border-subtle bg-bg-card" />
      <div className="skeleton h-64 rounded-lg border border-border-subtle bg-bg-card" />
    </div>
  );
}

function ErrorState({ id, message }: { id: string; message: string }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-8 text-center">
      <p className="mono text-sm font-bold text-danger glow-red">Report unavailable</p>
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

const REPORT_CSS = `
.skeleton { position: relative; overflow: hidden; }
.skeleton::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(0,229,255,0.06), transparent);
  transform: translateX(-100%); animation: shimmer 1.6s ease-in-out infinite;
}
@keyframes shimmer { 100% { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .skeleton::after { animation: none; } }
`;

const REPORT_EXPORT_CSS = `
body { margin: 0; padding: 40px; color: #17212b; background: #f7fafc; font: 14px Georgia, serif; }
body > header, article { max-width: 960px; margin: 0 auto 32px; }
h1 { margin: 0 0 20px; font: 700 30px Arial, sans-serif; }
h2 { margin-top: 28px; font: 700 20px Arial, sans-serif; border-bottom: 2px solid #00a8bd; padding-bottom: 8px; }
header p { color: #007d8e; font: 700 12px Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; }
dt { color: #52606d; font-weight: 700; } dd { margin: 0; }
table { width: 100%; border-collapse: collapse; background: white; }
th, td { padding: 8px; border: 1px solid #d7e0e8; text-align: left; }
th { background: #eaf4f6; font: 700 11px Arial, sans-serif; text-transform: uppercase; }
.chart { display: block; width: 100%; max-width: 720px; height: auto; margin: 14px 0; background: white; border: 1px solid #d7e0e8; }
.chart line { stroke: #c5d4dc; stroke-width: 1; } .chart polyline { fill: none; stroke: #008b9e; stroke-width: 3; } .chart text { fill: #52606d; font: 12px Arial, sans-serif; }
@media print { body { padding: 0; background: white; } section { break-inside: avoid; } }
`;
