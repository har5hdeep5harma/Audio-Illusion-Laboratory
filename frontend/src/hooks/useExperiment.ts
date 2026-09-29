/**
 * useExperiment.ts — Experiment state machine.
 *
 * Orchestrates the full pipeline as a sequence of backend calls, surfacing a
 * single status, a coarse progress fraction, the current human-readable stage,
 * and any error:
 *
 *   idle → uploading → distorting → transcribing → analyzing → complete
 *                                                            ↘ error
 *
 * `startExperiment(file, distortions)` runs the steps in order, advancing status
 * between each. The resulting `experimentId` and computed `metrics` are exposed
 * for downstream pages.
 */
"use client";

import { useCallback, useState } from "react";

import api, { ApiError } from "@/services/api";
import type { DistortionType, MetricsPayload } from "@/types";

export type ExperimentStatus =
  | "idle"
  | "uploading"
  | "distorting"
  | "transcribing"
  | "analyzing"
  | "complete"
  | "error";

/** Coarse progress + label for each pipeline status. */
const STATUS_META: Record<
  ExperimentStatus,
  { progress: number; stage: string }
> = {
  idle: { progress: 0, stage: "Idle" },
  uploading: { progress: 0.15, stage: "Uploading audio" },
  distorting: { progress: 0.4, stage: "Generating distortions" },
  transcribing: { progress: 0.7, stage: "Transcribing variants" },
  analyzing: { progress: 0.9, stage: "Computing metrics" },
  complete: { progress: 1, stage: "Complete" },
  error: { progress: 0, stage: "Error" },
};

export interface UseExperiment {
  experimentId: string | null;
  status: ExperimentStatus;
  progress: number;
  currentStage: string;
  error: string | null;
  metrics: MetricsPayload | null;
  startExperiment: (file: File, distortions: DistortionType[], levels: number[]) => Promise<void>;
  reset: () => void;
}

export function useExperiment(): UseExperiment {
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [status, setStatus] = useState<ExperimentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);

  const reset = useCallback(() => {
    setExperimentId(null);
    setStatus("idle");
    setError(null);
    setMetrics(null);
  }, []);

  const startExperiment = useCallback(
    async (file: File, distortions: DistortionType[], levels: number[]) => {
      setError(null);
      setMetrics(null);
      try {
        // 1. Upload → experiment id.
        setStatus("uploading");
        const meta = await api.uploadAudio(file);
        setExperimentId(meta.experiment_id);

        // 2. Generate distortion variants.
        setStatus("distorting");
        await api.startDistortion(meta.experiment_id, distortions, levels);

        // 3. Transcribe original + all variants.
        setStatus("transcribing");
        await api.startTranscription(meta.experiment_id);

        // 4. Compute the metric suite.
        setStatus("analyzing");
        const payload = await api.computeMetrics(meta.experiment_id);
        setMetrics(payload);

        // 5. Done.
        setStatus("complete");
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unexpected error";
        setError(message);
        setStatus("error");
      }
    },
    [],
  );

  return {
    experimentId,
    status,
    progress: STATUS_META[status].progress,
    currentStage: STATUS_META[status].stage,
    error,
    metrics,
    startExperiment,
    reset,
  };
}

export default useExperiment;
