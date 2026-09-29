/**
 * ExperimentGate.tsx — landing for experiment-scoped routes hit without an id.
 *
 * The dashboard / observatory / report views all live at `<base>/<experimentId>`.
 * When a user lands on the bare `<base>` (e.g. via the nav), this gate lets them
 * paste an experiment id to jump in, or start a fresh experiment.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function ExperimentGate({
  base,
  title,
  description,
}: {
  base: string;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const [id, setId] = useState("");

  const go = () => {
    const v = id.trim();
    if (v) router.push(`${base}/${encodeURIComponent(v)}`);
  };

  return (
    <div className="py-16">
      <div className="mx-auto max-w-lg rounded-lg border border-border-subtle bg-bg-card p-8 text-center">
        <p className="mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          {title}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
          Select an experiment
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          {description}
        </p>

        <div className="mt-6 flex gap-2">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
            }}
            placeholder="experiment id (uuid)"
            spellCheck={false}
            className="mono flex-1 rounded-md border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
          />
          <button
            type="button"
            onClick={go}
            disabled={!id.trim()}
            className="mono rounded-md bg-accent-cyan px-5 py-2 text-sm font-bold text-bg-primary transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Go
          </button>
        </div>

        <p className="mt-6 text-xs text-text-muted">No experiment yet?</p>
        <Link
          href="/experiment"
          className="mono mt-2 inline-block rounded-md border border-accent-cyan/60 px-5 py-2 text-xs font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/10"
        >
          Start a new experiment →
        </Link>
      </div>
    </div>
  );
}

export default ExperimentGate;
