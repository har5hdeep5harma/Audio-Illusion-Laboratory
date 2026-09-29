/**
 * page.tsx — Landing page ("/").
 *
 * The observatory's front door: a full-viewport hero over an animated blueprint
 * grid with a floating waveform, the five failure stages, the metrics it
 * measures, the experiment flow, and a single-line footer.
 *
 * Animations are CSS-only (scroll reveals via IntersectionObserver, grid drift,
 * traveling dot) plus Framer Motion for the hero entrance. NOTE: the brief asked
 * for `motion/react`; only `framer-motion` is installed here (the `motion`
 * package rebrand is not), and it exposes the identical API — so we import from
 * `framer-motion`.
 */
"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/* Data*/

const STAT_CHIPS = ["6 DISTORTION TYPES", "8 FAILURE METRICS", "5 PERCEPTION STAGES"];

type Stage = {
  n: string;
  name: string;
  color: string; // CSS variable
  description: string;
  input: string;
  output: string;
};

const STAGES: Stage[] = [
  {
    n: "01",
    name: "Stable Perception",
    color: "var(--stage-stable)",
    description: "Transcript essentially correct; the model is unaffected.",
    input: "The cat sat on the mat.",
    output: "The cat sat on the mat.",
  },
  {
    n: "02",
    name: "Perceptual Drift",
    color: "var(--stage-drift)",
    description: "Minor word-level errors creep in; meaning stays intact.",
    input: "The cat sat on the mat.",
    output: "The cat sat on a mat.",
  },
  {
    n: "03",
    name: "Semantic Drift",
    color: "var(--stage-semantic)",
    description: "Errors begin to change the meaning of the utterance.",
    input: "The cat sat on the mat.",
    output: "The cat rested on the floor.",
  },
  {
    n: "04",
    name: "Hallucination",
    color: "var(--stage-hallucination)",
    description: "The model emits confident but fabricated content.",
    input: "The cat sat on the mat.",
    output: "The captain arrived in Manhattan.",
  },
  {
    n: "05",
    name: "Perceptual Collapse",
    color: "var(--stage-collapse)",
    description: "Output is broken, empty, or repetitive — the model gives up.",
    input: "The cat sat on the mat.",
    output: "…unintelligible fragments…",
  },
];

type Metric = { name: string; description: string; icon: JSX.Element };

const METRICS: Metric[] = [
  {
    name: "Word Error Rate",
    description: "Substitutions, deletions, and insertions against the reference.",
    icon: <IconWave />,
  },
  {
    name: "Confidence Collapse",
    description: "How fast the model's self-reported certainty falls per level.",
    icon: <IconGauge />,
  },
  {
    name: "Hallucination Threshold",
    description: "The distortion level where fabrication first crosses 0.4.",
    icon: <IconThreshold />,
  },
  {
    name: "Drift Index",
    description: "Cosine distance between meaning of reference and transcript.",
    icon: <IconDrift />,
  },
  {
    name: "Collapse Point",
    description: "Where confidence drops below 25 while WER exceeds 60%.",
    icon: <IconCollapse />,
  },
  {
    name: "Semantic Preservation",
    description: "How much of the original meaning survives the distortion.",
    icon: <IconShield />,
  },
];

const STEPS = [
  "Upload Audio",
  "Select Distortions",
  "Generate Variants",
  "Run Whisper",
  "Observe Degradation",
  "Receive Failure Report",
];

/* Page */

export default function HomePage() {
  return (
    <>
      <style>{PAGE_CSS}</style>

      <Hero />
      <FailureStagesSection />
      <MeasuresSection />
      <HowItWorksSection />
      <Footer />
    </>
  );
}

/* Hero */

function Hero() {
  return (
    <section className="relative -mx-6 flex min-h-[calc(100vh-3.5rem)] items-center overflow-hidden px-6">
      {/* Animated blueprint grid. */}
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden />
      {/* Radial vignette to focus the center. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,var(--bg-primary)_85%)]" aria-hidden />
      {/* Floating decorative waveform behind the text. */}
      <WaveformBackdrop />

      <div className="relative mx-auto w-full max-w-4xl text-center">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
          }}
        >
          <motion.p
            variants={fadeUp}
            className="eyebrow mb-6 inline-flex items-center gap-2"
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-glow rounded-full bg-accent-cyan" />
            Auditory Robustness Observatory
          </motion.p>

          <motion.h1
            variants={fadeUp}
            className="display text-balance text-5xl font-semibold leading-[0.98] text-text-primary sm:text-6xl md:text-8xl"
          >
            Observe the Moment <br className="hidden sm:block" />
            <span className="text-accent-cyan">Machine Hearing</span> Breaks.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-text-secondary"
          >
            A scientific instrument for studying how speech recognition systems
            drift from accurate perception into hallucination under controlled
            distortions.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <Link
              href="/experiment"
              className="group inline-flex items-center gap-2 border border-text-primary bg-text-primary px-7 py-3 font-display text-base font-semibold text-bg-primary transition-transform hover:-translate-y-0.5 hover:bg-accent-cyan hover:text-bg-elevated"
            >
              Begin Experiment
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
            <a
              href="#failure-stages"
              className="inline-flex items-center gap-2 border border-border-subtle px-7 py-3 font-display text-base font-semibold text-text-primary transition-colors hover:border-text-primary hover:bg-bg-card"
            >
              View Sample Report
            </a>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            {STAT_CHIPS.map((chip) => (
              <span
                key={chip}
                className="mono border border-border-subtle bg-bg-card/60 px-4 py-1.5 text-[0.6rem] tracking-widest text-text-secondary"
              >
                {chip}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function WaveformBackdrop() {
  // A subtly pulsing sine-wave SVG sitting behind the hero text.
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.18]"
      aria-hidden
    >
      <svg
        viewBox="0 0 1200 200"
        className="h-64 w-[120%] animate-pulse-glow text-accent-cyan"
        fill="none"
        preserveAspectRatio="none"
      >
        <path
          d="M0 100 C 75 20, 150 180, 225 100 S 375 20, 450 100 S 600 180, 675 100 S 825 20, 900 100 S 1050 180, 1125 100 S 1200 60, 1200 100"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M0 100 C 100 140, 200 60, 300 100 S 500 140, 600 100 S 800 60, 900 100 S 1100 140, 1200 100"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.5"
        />
      </svg>
    </div>
  );
}

/* Failure stages */

function FailureStagesSection() {
  return (
    <section id="failure-stages" className="py-24">
      <SectionHeading
        kicker="Perception → Hallucination"
        title="The 5 Stages of Auditory Failure"
      />
      <div className="mt-12 flex flex-col gap-4">
        {STAGES.map((stage, i) => (
          <Reveal key={stage.n} delay={i * 80}>
            <article
              className="group relative overflow-hidden border border-border-subtle bg-bg-card p-6 transition-colors hover:bg-bg-elevated"
              style={{ borderLeft: `3px solid ${stage.color}` }}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-5">
                  <span
                    className="mono text-2xl font-bold"
                    style={{ color: stage.color }}
                  >
                    {stage.n}
                  </span>
                  <div className="max-w-md">
                    <h3
                      className="text-lg font-semibold"
                      style={{ color: stage.color }}
                    >
                      {stage.name}
                    </h3>
                    <p className="mt-1 text-sm text-text-secondary">
                      {stage.description}
                    </p>
                  </div>
                </div>

                {/* input → output example */}
                <div className="mono flex items-center gap-3 text-xs">
                  <span className="rounded border border-border-subtle bg-bg-secondary px-3 py-2 text-text-muted">
                    {stage.input}
                  </span>
                  <span style={{ color: stage.color }}>→</span>
                  <span
                    className="rounded border px-3 py-2"
                    style={{
                      color: stage.color,
                      borderColor: stage.color,
                      background: `color-mix(in srgb, ${stage.color} 10%, transparent)`,
                    }}
                  >
                    {stage.output}
                  </span>
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* What this measures */

function MeasuresSection() {
  return (
    <section id="what-it-measures" className="py-24">
      <SectionHeading
        kicker="Instrumentation"
        title="What This Measures"
      />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRICS.map((metric, i) => (
          <Reveal key={metric.name} delay={(i % 3) * 80}>
            <div className="group h-full border border-border-subtle bg-bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan hover:shadow-glow-cyan">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md border border-border-subtle bg-bg-secondary text-accent-cyan transition-colors group-hover:border-accent-cyan">
                {metric.icon}
              </div>
              <h3 className="font-display text-xl font-semibold text-text-primary">
                {metric.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {metric.description}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* How it works */

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24">
      <SectionHeading kicker="Pipeline" title="How It Works" />

      <div className="relative mt-16">
        {/* Connecting line with a traveling dot (hidden on small screens). */}
        <div className="absolute left-0 right-0 top-5 hidden md:block">
          <div className="signal-line relative">
            <span className="dot-travel absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-accent-cyan shadow-glow-cyan" />
          </div>
        </div>

        <ol className="relative grid grid-cols-2 gap-y-10 md:grid-cols-6 md:gap-y-0">
          {STEPS.map((step, i) => (
            <li key={step} className="flex flex-col items-center text-center">
              <span className="mono z-10 flex h-10 w-10 items-center justify-center rounded-full border border-accent-cyan/50 bg-bg-secondary text-sm font-bold text-accent-cyan">
                {i + 1}
              </span>
              <span className="mt-4 max-w-[10rem] text-xs font-medium text-text-secondary">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* Footer */

function Footer() {
  return (
    <footer className="border-t border-border-subtle py-10">
      <p className="mono text-center text-xs tracking-wide text-text-muted">
        Audio Illusion Laboratory — A Perception-to-Hallucination Observatory
      </p>
    </footer>
  );
}

/* Shared pieces */

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <Reveal>
      <div className="text-center">
        <p className="mono mb-3 text-xs uppercase tracking-[0.3em] text-accent-cyan">
          {kicker}
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          {title}
        </h2>
        <hr className="signal-line mx-auto mt-6 max-w-xs" />
      </div>
    </Reveal>
  );
}

/** Scroll-reveal wrapper using IntersectionObserver + a CSS transition. */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "reveal-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

/* Inline metric icons (stroke = currentColor) */

function IconWave() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 12h3l2-7 4 14 3-9 2 4h6" />
    </svg>
  );
}
function IconGauge() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 14l4-4" />
    </svg>
  );
}
function IconThreshold() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 16h7l2-9 2 5h7" />
      <path d="M3 20h18" strokeDasharray="2 3" />
    </svg>
  );
}
function IconDrift() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="7" cy="12" r="3" />
      <circle cx="17" cy="12" r="3" />
      <path d="M10 12h4" strokeDasharray="2 2" />
    </svg>
  );
}
function IconCollapse() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 5l16 14" />
      <path d="M20 5L4 19" opacity="0.5" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" />
    </svg>
  );
}

/* Page-scoped CSS (grid drift, traveling dot, scroll reveal) */

const PAGE_CSS = `
.hero-grid {
  background-image:
    linear-gradient(rgba(0, 229, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.05) 1px, transparent 1px);
  background-size: 80px 80px;
  animation: grid-pan 24s linear infinite;
}
@keyframes grid-pan {
  from { background-position: 0 0; }
  to { background-position: 80px 80px; }
}
@keyframes dot-travel {
  0% { left: 0%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { left: 100%; opacity: 0; }
}
.dot-travel { animation: dot-travel 6s ease-in-out infinite; }

.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}
.reveal-in {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  .hero-grid, .dot-travel { animation: none; }
  .reveal { opacity: 1; transform: none; transition: none; }
}
`;
