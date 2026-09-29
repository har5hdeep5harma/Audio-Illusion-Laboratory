/**
 * report/page.tsx — index for the experiment-scoped Failure Report.
 *
 * The report lives at /report/[id]; this bare route gates entry by experiment
 * id so the route resolves instead of 404-ing.
 */
import ExperimentGate from "@/components/shared/ExperimentGate";

export default function ReportIndex() {
  return (
    <ExperimentGate
      base="/report"
      title="Auditory Failure Report"
      description="The report is the assembled scientific artifact for one experiment. Enter an experiment ID to open it."
    />
  );
}
