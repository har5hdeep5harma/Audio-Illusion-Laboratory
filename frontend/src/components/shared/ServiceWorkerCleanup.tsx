/**
 * ServiceWorkerCleanup.tsx — unregister any rogue service worker.
 *
 * This app does NOT use a service worker. But a service worker left registered
 * by a *previous* project on the same origin (localhost:3000) will keep
 * intercepting fetches — including our API calls to the backend — and can serve
 * stale/wrong responses (e.g. routing an upload to an unrelated endpoint).
 *
 * On mount we unregister every service worker and clear the Cache Storage so the
 * page talks directly to the network again. (An already-controlling worker stops
 * intercepting after the next reload.)
 */
"use client";

import { useEffect } from "react";

export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations?.()
        .then((regs) => {
          if (regs.length > 0) {
            // eslint-disable-next-line no-console
            console.warn(
              `[AIL] Unregistering ${regs.length} stale service worker(s). Reload once if requests still misbehave.`,
            );
          }
          regs.forEach((r) => r.unregister());
        })
        .catch(() => {});
    }

    if (typeof caches !== "undefined") {
      caches
        .keys?.()
        .then((keys) => keys.forEach((k) => caches.delete(k)))
        .catch(() => {});
    }
  }, []);

  return null;
}

export default ServiceWorkerCleanup;
