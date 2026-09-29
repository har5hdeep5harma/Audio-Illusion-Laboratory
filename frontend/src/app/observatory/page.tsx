/**
 * observatory/page.tsx — index for the experiment-scoped Observatory.
 *
 * The Observatory lives at /observatory/[id]; this bare route gates entry by
 * experiment id so the nav link resolves instead of 404-ing.
 */
import ExperimentGate from "@/components/shared/ExperimentGate";

export default function ObservatoryIndex() {
  return (
    <ExperimentGate
      base="/observatory"
      title="The Observatory"
      description="The Observatory visualizes a single experiment's transcript evolution and hallucination breakdown. Enter an experiment ID to open it."
    />
  );
}
