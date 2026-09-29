/**
 * ErrorBoundary.tsx — app-wide React error boundary with a dark-theme fallback.
 *
 * Catches render-time errors anywhere in the tree and shows a recoverable
 * instrument-styled panel instead of a blank screen. Wraps the app in layout.tsx.
 */
"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in dev tools without throwing an unhandled rejection.
    console.warn("[ErrorBoundary] caught:", error.message, info.componentStack);
  }

  private reset = () => this.setState({ hasError: false, message: "" });

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="mx-auto my-16 max-w-lg rounded-lg border border-danger/40 bg-danger/10 p-8 text-center">
        <p className="mono text-sm font-bold tracking-widest text-danger glow-red">
          ⚠ INSTRUMENT FAULT
        </p>
        <p className="mt-3 text-sm text-text-secondary">
          Something went wrong while rendering this view.
        </p>
        {this.state.message && (
          <p className="mono mt-2 break-words text-xs text-text-muted">
            {this.state.message}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={this.reset}
            className="mono rounded-md border border-accent-cyan/60 px-5 py-2 text-xs font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/10"
          >
            Try Again
          </button>
          <a
            href="/"
            className="mono rounded-md border border-border-subtle px-5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary"
          >
            Return Home
          </a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
