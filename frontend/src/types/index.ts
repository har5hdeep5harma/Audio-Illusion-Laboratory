/**
 * index.ts — TypeScript mirror of the backend API contract.
 *
 * These types match the FastAPI response shapes exactly (see backend
 * api/schemas.py, metrics.json, and the analysis/report routes). Keep them in
 * sync with the backend — they are the single source of truth for the UI.
 */

/* Enums */

/** Distortion types, matching the backend `DistortionType` enum. */
export type DistortionType =
  | "WHITE_NOISE"
  | "ECHO"
  | "COMPRESSION"
  | "SPEED_SHIFT"
  | "PITCH_SHIFT"
  | "COMBINED";

/** All distortion types, in canonical order (handy for selectors/iteration). */
export const DISTORTION_TYPES: DistortionType[] = [
  "WHITE_NOISE",
  "ECHO",
  "COMPRESSION",
  "SPEED_SHIFT",
  "PITCH_SHIFT",
  "COMBINED",
];

/** The five failure stages (backend `stage_name` values). */
export type FailureStage =
  | "stable_perception"
  | "perceptual_drift"
  | "semantic_drift"
  | "hallucination"
  | "collapse";

/** Hallucination severity bands (backend `classify_severity`). */
export type HallucinationSeverity =
  | "none"
  | "minor_drift"
  | "semantic_drift"
  | "hallucination"
  | "collapse";

/** Overall robustness grade (backend `classify_robustness`). */
export type RobustnessGrade = "high" | "moderate" | "low" | "critical";

/* Upload / experiment*/

/** Response from `POST /api/upload`. */
export interface ExperimentMetadata {
  experiment_id: string;
  filename: string;
  duration_seconds: number;
  sample_rate: number;
  status: string;
}

/** A user's chosen distortion configuration before launching an experiment. */
export interface DistortionConfig {
  distortionTypes: DistortionType[];
  /** Optional explicit level override; omit to use every level of each type. */
  levels?: number[];
}

/*  Distort / transcribe responses  */

export interface DistortionVariant {
  distortion_type: DistortionType;
  level_index: number;
  intensity: number;
  label: string;
  file_path: string;
}

export interface DistortResponse {
  experiment_id: string;
  status: string;
  total_variants: number;
  distortion_types: DistortionType[];
  variants: DistortionVariant[];
  manifest_path: string;
}

export interface TranscribeResponse {
  experiment_id: string;
  total_variants: number;
  status: string;
}

export interface JobResponse<T = unknown> {
  job_id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  result: T | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/* Metrics */

/** One distortion level's full metric row (from metrics.json). */
export interface MetricsLevel {
  level_index: number;
  intensity: number | null;
  label: string;
  wer: number;
  insertions: number;
  deletions: number;
  substitutions: number;
  reference_length: number;
  hypothesis_length: number;
  confidence: number;
  drift_index: number;
  semantic_preservation: number;
  hallucination_score: number;
  severity: HallucinationSeverity;
  is_collapse: boolean;
}

/** One entry of a distortion's hallucination timeline. */
export interface HallucinationTimelinePoint {
  level: number;
  score: number;
  stage: HallucinationSeverity;
  label: string;
}

/** Per-distortion metrics block. */
export interface DistortionMetrics {
  levels: MetricsLevel[];
  confidence_curve: number[];
  collapse_rate: number;
  collapse_region: number | null;
  hallucination_scores: number[];
  hallucination_threshold: number | null;
  hallucination_timeline: HallucinationTimelinePoint[];
}

/** Complete response from `POST /api/metrics` (and `GET /api/metrics/{id}`). */
export interface MetricsPayload {
  experiment_id: string;
  reference_transcript: string;
  distortion_types: DistortionType[];
  distortions: Record<string, DistortionMetrics>;
  status: string;
}

/* Timeline */

/** One per-distortion, per-level timeline entry (flattened client-side). */
export interface TimelineEntry {
  distortion_type: DistortionType;
  level: number;
  stage: FailureStage;
  transcript: string;
  confidence: number;
  wer: number;
  hallucination_score: number;
}

/** Raw `GET /api/timeline/{id}` shape: keyed by distortion type. */
export type TimelineResponse = Record<
  string,
  Omit<TimelineEntry, "distortion_type">[]
>;

/**
 * A single variant transcript with its scored metrics + classified stage.
 * (Alias of {@link TimelineEntry} — the observatory's atomic unit.)
 */
export type TranscriptEntry = TimelineEntry;

/*  Hallucination analysis*/

/** A word that was substituted: original reference words → model output words. */
export interface AlteredWord {
  original: string[];
  output: string[];
}

/** Word-level diff at the hallucination stage. */
export interface WordDiff {
  level: number;
  hypothesis: string;
  preserved: string[];
  altered: AlteredWord[];
  invented: string[];
  dropped: string[];
  counts: {
    preserved: number;
    altered: number;
    invented: number;
    dropped: number;
  };
}

export interface HallucinationSeverityPoint {
  level: number;
  score: number;
  severity: HallucinationSeverity;
}

/** Per-distortion hallucination analysis block. */
export interface DistortionHallucination {
  hallucination_scores: number[];
  hallucination_threshold_level: number | null;
  hallucination_threshold_intensity: number | null;
  peak_hallucination_score: number;
  severities: HallucinationSeverityPoint[];
  word_diff: WordDiff | null;
}

/** Complete response from `GET /api/hallucination/{id}`. */
export interface HallucinationAnalysis {
  experiment_id: string;
  reference_transcript: string;
  distortions: Record<string, DistortionHallucination>;
}

/* Report */

/** One classified failure stage within a report's per-distortion section. */
export interface ReportFailureStage {
  level: number;
  stage_name: FailureStage;
  wer: number;
  confidence: number;
  hallucination_score: number;
  label: string;
}

/** Per-distortion report section. */
export interface DistortionReport {
  distortion_type: DistortionType;
  overall_robustness: RobustnessGrade;
  hallucination_threshold_level: number | null;
  hallucination_threshold_intensity: number | null;
  collapse_point_level: number | null;
  collapse_confidence: number | null;
  confidence_collapse_rate: number;
  peak_hallucination_score: number;
  failure_path: string[];
  stages: ReportFailureStage[];
}

/** Complete response from `GET /api/report/{id}`. */
export interface ExperimentReport {
  experiment_id: string;
  filename: string;
  duration_seconds: number;
  distortions_tested: DistortionType[];
  per_distortion: DistortionReport[];
  most_dangerous_distortion: string;
  earliest_hallucination_distortion: string;
  earliest_hallucination_level: number;
  overall_robustness: RobustnessGrade;
  executive_summary: string;
  generated_at: string;
}

/* Error envelope */

/** Structured error body returned by the backend exception handlers. */
export interface ApiErrorBody {
  error: string;
  detail: string;
}
