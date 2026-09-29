/**
 * StageChip.tsx — reusable failure-stage badge.
 *
 * Renders a stage pill colored by the canonical stage palette (context.md §2),
 * using the shared `.stage-badge` design-system class. Used across the
 * dashboard, observatory, and report views.
 */
import type { FailureStage } from "@/types";

const STAGE_COLOR: Record<FailureStage, string> = {
  stable_perception: "var(--stage-stable)",
  perceptual_drift: "var(--stage-drift)",
  semantic_drift: "var(--stage-semantic)",
  hallucination: "var(--stage-hallucination)",
  collapse: "var(--stage-collapse)",
};

const STAGE_LABEL: Record<FailureStage, string> = {
  stable_perception: "Stable Perception",
  perceptual_drift: "Perceptual Drift",
  semantic_drift: "Semantic Drift",
  hallucination: "Hallucination",
  collapse: "Perceptual Collapse",
};

/** Optional dramatic labels for the most severe stages. */
const STAGE_LABEL_LOUD: Partial<Record<FailureStage, string>> = {
  hallucination: "⚡ Hallucination",
  collapse: "💀 Collapse",
};

export function StageChip({
  stage,
  loud = false,
  className = "",
}: {
  stage: FailureStage;
  /** Use the dramatic label variant for hallucination / collapse. */
  loud?: boolean;
  className?: string;
}) {
  const label = (loud && STAGE_LABEL_LOUD[stage]) || STAGE_LABEL[stage];
  return (
    <span className={`stage-badge ${className}`} style={{ color: STAGE_COLOR[stage] }}>
      {label}
    </span>
  );
}

export { STAGE_COLOR, STAGE_LABEL };
export default StageChip;
