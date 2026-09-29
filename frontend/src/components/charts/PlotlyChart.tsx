/**
 * PlotlyChart.tsx — react-plotly.js wrapper with the standard dark theme applied.
 *
 * Loads Plotly client-only (next/dynamic, ssr:false — Plotly needs `window`),
 * merges the design-system DARK_LAYOUT under any caller-supplied layout, and
 * defaults to a responsive, chrome-free config. Use this for any new chart so
 * the theme stays consistent across the app.
 */
"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="ail-skeleton h-full w-full" />,
});

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DARK_LAYOUT: any = {
  paper_bgcolor: "#0D1117",
  plot_bgcolor: "#080C10",
  font: { family: "Space Mono, monospace", color: "#8BA3BE", size: 11 },
  xaxis: { gridcolor: "#1E2D3D", zerolinecolor: "#1E2D3D", linecolor: "#1E2D3D" },
  yaxis: { gridcolor: "#1E2D3D", zerolinecolor: "#1E2D3D", linecolor: "#1E2D3D" },
  margin: { t: 40, r: 20, b: 40, l: 50 },
  hoverlabel: {
    bgcolor: "#161E28",
    bordercolor: "#1E2D3D",
    font: { family: "Space Mono, monospace", color: "#E8F4FD" },
  },
  legend: { font: { color: "#8BA3BE", size: 10 } },
};

const DEFAULT_CONFIG: any = {
  responsive: true,
  displaylogo: false,
  displayModeBar: false,
};

/** Shallow-merge caller layout over DARK_LAYOUT, deep-merging the axes. */
function mergeLayout(layout?: any): any {
  if (!layout) return DARK_LAYOUT;
  return {
    ...DARK_LAYOUT,
    ...layout,
    xaxis: { ...DARK_LAYOUT.xaxis, ...(layout.xaxis ?? {}) },
    yaxis: { ...DARK_LAYOUT.yaxis, ...(layout.yaxis ?? {}) },
    font: { ...DARK_LAYOUT.font, ...(layout.font ?? {}) },
    margin: { ...DARK_LAYOUT.margin, ...(layout.margin ?? {}) },
  };
}

export function PlotlyChart({
  data,
  layout,
  config,
  style = { width: "100%", height: "320px" },
  className,
}: {
  data: any[];
  layout?: any;
  config?: any;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Plot
      data={data}
      layout={mergeLayout(layout)}
      config={{ ...DEFAULT_CONFIG, ...(config ?? {}) }}
      useResizeHandler
      style={style}
      className={className}
    />
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export default PlotlyChart;
