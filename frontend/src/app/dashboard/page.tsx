/**
 * dashboard/page.tsx — index for the experiment-scoped dashboard.
 *
 * The dashboard lives at /dashboard/[id]; this bare route gates entry by
 * experiment id so the route resolves instead of 404-ing.
 */
import ExperimentGate from "@/components/shared/ExperimentGate";

export default function DashboardIndex() {
  return (
    <ExperimentGate
      base="/dashboard"
      title="Auditory Stability Dashboard"
      description="The dashboard charts an experiment's stability, confidence, and word-error trajectories. Enter an experiment ID to open it."
    />
  );
}
