/**
 * layout.tsx — Root App Router layout.
 *
 * Establishes the editorial research-studio shell shared by every route.
 */
import type { Metadata } from "next";
import Link from "next/link";

import ErrorBoundary from "@/components/shared/ErrorBoundary";
import ServiceWorkerCleanup from "@/components/shared/ServiceWorkerCleanup";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio Illusion Laboratory | Auditory Robustness Observatory",
  description:
    "An auditory failure observatory — studying how speech-recognition models degrade under controlled audio distortions, revealing hallucination thresholds and perceptual collapse points.",
  icons: {
    icon: "/favicon.svg",
  },
};

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/observatory", label: "Observatory" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Flash-free fonts: preconnect + the same families imported in CSS. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-bg-primary font-sans text-text-primary antialiased">
        <ServiceWorkerCleanup />
        <Header />
        <main className="mx-auto w-full max-w-[1440px] px-5 sm:px-8">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-bg-primary/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[1440px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <span className="relative font-display text-2xl font-semibold italic tracking-[-0.08em] text-text-primary transition-colors group-hover:text-accent-cyan">
            AIL<span className="absolute -right-2 top-0 h-1.5 w-1.5 rounded-full bg-accent-cyan" />
          </span>
          <span>
            <span className="block font-display text-base font-semibold leading-none text-text-primary">
              Audio Illusion
            </span>
            <span className="mono mt-1 block text-[0.55rem] uppercase tracking-[0.18em] text-text-muted">
              Laboratory
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-4 sm:gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="mono text-[0.65rem] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:text-accent-cyan"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/experiment"
            className="hidden border border-text-primary px-3 py-2 font-display text-sm font-semibold text-text-primary transition-colors hover:border-accent-cyan hover:bg-accent-cyan hover:text-bg-elevated sm:block"
          >
            New study <span aria-hidden>↗</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
