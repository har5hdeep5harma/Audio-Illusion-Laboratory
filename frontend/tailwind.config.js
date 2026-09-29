/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Every palette token mirrors a CSS custom property in globals.css so the
      // design system has a single source of truth.
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          card: "var(--bg-card)",
          elevated: "var(--bg-elevated)",
        },
        border: {
          subtle: "var(--border-subtle)",
          active: "var(--border-active)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        accent: {
          cyan: "var(--accent-cyan)",
          amber: "var(--accent-amber)",
        },
        danger: "var(--danger-red)",
        success: "var(--success-green)",
        "semantic-drift": "var(--semantic-drift)",
        hallucination: "var(--hallucination)",
        collapse: "var(--collapse)",
        stable: "var(--stable)",
        // Failure-stage colors (context.md §2).
        stage: {
          stable: "var(--stage-stable)",
          drift: "var(--stage-drift)",
          semantic: "var(--stage-semantic)",
          hallucination: "var(--stage-hallucination)",
          collapse: "var(--stage-collapse)",
        },
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        mono: ["Space Mono", "ui-monospace", "monospace"],
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "glow-cyan": "0 0 12px var(--border-active), 0 0 4px var(--accent-cyan)",
        "glow-red": "0 0 12px rgba(255,23,68,0.35), 0 0 4px rgba(255,23,68,0.6)",
        "glow-green": "0 0 12px rgba(0,230,118,0.35), 0 0 4px rgba(0,230,118,0.6)",
        "glow-amber": "0 0 12px rgba(255,179,0,0.35), 0 0 4px rgba(255,179,0,0.6)",
      },
      backgroundImage: {
        "grid-lines":
          "linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "1", filter: "drop-shadow(0 0 4px currentColor)" },
          "50%": { opacity: "0.55", filter: "drop-shadow(0 0 10px currentColor)" },
        },
        "scan-line": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 1.8s ease-in-out infinite",
        "scan-line": "scan-line 2.2s linear infinite",
      },
    },
  },
  plugins: [],
};
