/**
 * usePolling.ts — Generic interval poller.
 *
 * Calls `fn` every `intervalMs` while `enabled` is true; clears the interval on
 * disable or unmount. The latest `fn` is captured via a ref so callers can pass
 * inline closures without resetting the timer each render.
 */
"use client";

import { useEffect, useRef } from "react";

export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const savedFn = useRef(fn);

  // Always invoke the freshest callback.
  useEffect(() => {
    savedFn.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const id = setInterval(() => {
      void savedFn.current();
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}

export default usePolling;
