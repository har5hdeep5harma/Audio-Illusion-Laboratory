/**
 * LoadingSkeleton.tsx — shimmer skeletons for the major page layouts.
 *
 * Uses the shared `.ail-skeleton` utility (globals.css) for the shimmer effect.
 * `Skeleton` is the atomic shimmering box; `PageSkeleton` renders a layout-shaped
 * placeholder matching each route so the load feels structural, not blank.
 */
import type { CSSProperties } from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`ail-skeleton ${className}`} style={style} aria-hidden />;
}

export type SkeletonVariant = "dashboard" | "report" | "observatory" | "generic";

export function PageSkeleton({ variant = "generic" }: { variant?: SkeletonVariant }) {
  if (variant === "dashboard") return <DashboardSkeleton />;
  if (variant === "report") return <ReportSkeleton />;
  if (variant === "observatory") return <ObservatorySkeleton />;
  return <GenericSkeleton />;
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
        <div className="flex flex-col gap-8 xl:col-span-3">
          <Skeleton className="h-[340px]" />
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
        <div className="flex flex-col gap-8 xl:col-span-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" aria-busy="true">
      <Skeleton className="h-20" />
      <Skeleton className="h-40" />
      <Skeleton className="h-64" />
      <Skeleton className="h-72" />
    </div>
  );
}

function ObservatorySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-12" />
      <Skeleton className="h-64" />
      <Skeleton className="h-80" />
    </div>
  );
}

function GenericSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}

export default PageSkeleton;
