/**
 * api.ts — Typed API client for the FastAPI backend.
 *
 * One method per backend endpoint, all built on `fetch` with consistent error
 * handling. The base URL comes from `NEXT_PUBLIC_API_URL`, defaulting to
 * `http://localhost:8000`. Errors surface as {@link ApiError}, carrying the
 * backend's structured `{ error, detail }` message when available.
 */

import type {
  ApiErrorBody,
  DistortionType,
  ExperimentMetadata,
  ExperimentReport,
  HallucinationAnalysis,
  JobResponse,
  MetricsPayload,
  TimelineEntry,
  TimelineResponse,
} from "@/types";

// Default to the IPv4 loopback (127.0.0.1) rather than "localhost": on Windows
// "localhost" often resolves to IPv6 (::1) first, which can hit a *different*
// server than our uvicorn backend (bound to 127.0.0.1). Override via env.
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

/** Error thrown for any non-2xx response or network failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: unknown, status: number, code = "request_failed") {
    super(typeof message === "string" && message ? message : String(message));
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Flatten any backend `detail` value into a readable string.
 *
 * Our handlers return a string detail, but FastAPI's built-in validation errors
 * are arrays of `{ loc, msg, type }` objects — stuffing those straight into an
 * error message renders as "[object Object]". This normalizes every shape.
 */
function extractDetail(d: unknown): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((item) => {
        if (item && typeof item === "object") {
          const e = item as Record<string, unknown>;
          const loc = Array.isArray(e.loc)
            ? e.loc.filter((p) => p !== "body").join(".")
            : "";
          const msg = typeof e.msg === "string" ? e.msg : JSON.stringify(item);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .join("; ");
  }
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

/** Parse a response, throwing {@link ApiError} on failure. */
async function parse<T>(res: Response): Promise<T> {
  if (res.ok) {
    // 204 / empty bodies → resolve as undefined.
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  let detail = res.statusText || `HTTP ${res.status}`;
  let code = "request_failed";
  try {
    const body = (await res.json()) as Partial<ApiErrorBody> & {
      detail?: unknown;
    };
    const extracted = extractDetail(body?.detail);
    if (extracted) detail = extracted;
    if (typeof body?.error === "string") code = body.error;
  } catch {
    /* non-JSON error body — keep statusText */
  }
  throw new ApiError(detail, res.status, code);
}

/** Issue a JSON request, normalizing network errors into {@link ApiError}. */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : "Network request failed",
      0,
      "network_error",
    );
  }
  return parse<T>(res);
}

/** Sleep helper. */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `checkFn` until it resolves a non-null value, then return it.
 *
 * Long-running steps (transcription can take ~20s for longer audio) are served
 * synchronously by the backend, but flaky networks or cold model loads can make
 * a single request fail transiently. This retries `checkFn(experimentId)` up to
 * `maxAttempts` times, `intervalMs` apart, treating both a null result and a
 * thrown {@link ApiError} as "not ready yet". Throws the last error (or a
 * timeout {@link ApiError}) once attempts are exhausted.
 */
export async function pollUntilReady<T>(
  experimentId: string,
  checkFn: (id: string) => Promise<T | null>,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await checkFn(experimentId);
      if (result != null) return result;
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxAttempts - 1) await delay(intervalMs);
  }
  if (lastError instanceof Error) throw lastError;
  throw new ApiError(
    `Timed out after ${maxAttempts} attempts waiting on ${experimentId}.`,
    0,
    "timeout",
  );
}

async function waitForJob<T>(job: JobResponse<T>): Promise<T> {
  const completed = await pollUntilReady<JobResponse<T> | null>(
    job.job_id,
    async (jobId) => {
      const current = await requestJson<JobResponse<T>>(`/api/jobs/${jobId}`);
      return current.status === "succeeded" || current.status === "failed"
        ? current
        : null;
    },
    180,
    2000,
  );
  if (!completed) {
    throw new ApiError("Background job did not reach a terminal state", 500, "job_timeout");
  }
  if (completed.status === "failed") {
    throw new ApiError(completed.error ?? "Background job failed", 500, "job_failed");
  }
  if (completed.result == null) {
    throw new ApiError("Background job completed without a result", 500, "job_empty");
  }
  return completed.result;
}

export const api = {
  /** Upload an audio file → create an experiment. */
  async uploadAudio(file: File): Promise<ExperimentMetadata> {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      // Note: no Content-Type header — the browser sets the multipart boundary.
      res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
    } catch (err) {
      throw new ApiError(
        err instanceof Error ? err.message : "Upload failed",
        0,
        "network_error",
      );
    }
    return parse<ExperimentMetadata>(res);
  },

  /** Generate the distortion sweep for the given types. */
  async startDistortion(
    experimentId: string,
    distortionTypes: DistortionType[],
    levels?: number[],
  ): Promise<void> {
    const job = await requestJson<JobResponse>("/api/distort", {
      method: "POST",
      body: JSON.stringify({
        experiment_id: experimentId,
        distortion_types: distortionTypes,
        levels,
      }),
    });
    await waitForJob(job);
  },

  /** Transcribe the original + all variants with Whisper. */
  async startTranscription(experimentId: string): Promise<void> {
    const job = await requestJson<JobResponse>("/api/transcribe", {
      method: "POST",
      body: JSON.stringify({
        experiment_id: experimentId,
        run_all_variants: true,
      }),
    });
    await waitForJob(job);
  },

  /** Compute the full metric suite. */
  async computeMetrics(experimentId: string): Promise<MetricsPayload> {
    const job = await requestJson<JobResponse<MetricsPayload>>("/api/metrics", {
      method: "POST",
      body: JSON.stringify({ experiment_id: experimentId }),
    });
    return waitForJob(job);
  },

  /** Fetch the already-computed metric suite (no recompute). */
  async getMetrics(experimentId: string): Promise<MetricsPayload> {
    return requestJson<MetricsPayload>(`/api/metrics/${experimentId}`);
  },

  /** Fetch the per-distortion failure timeline (flattened to a single array). */
  async getTimeline(experimentId: string): Promise<TimelineEntry[]> {
    const raw = await requestJson<TimelineResponse>(
      `/api/timeline/${experimentId}`,
    );
    return Object.entries(raw).flatMap(([distortionType, entries]) =>
      entries.map((e) => ({
        distortion_type: distortionType as DistortionType,
        ...e,
      })),
    );
  },

  /** Fetch hallucination-specific analysis. */
  async getHallucinationAnalysis(
    experimentId: string,
  ): Promise<HallucinationAnalysis> {
    return requestJson<HallucinationAnalysis>(
      `/api/hallucination/${experimentId}`,
    );
  },

  /** Fetch (and generate, server-side) the full experiment report. */
  async getReport(experimentId: string): Promise<ExperimentReport> {
    return requestJson<ExperimentReport>(`/api/report/${experimentId}`);
  },
};

export default api;
