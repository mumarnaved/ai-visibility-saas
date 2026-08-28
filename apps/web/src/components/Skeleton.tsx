/* ========================================
   SKELETON PRIMITIVES

   Shimmer-based loading placeholders that
   mirror the shape of the content they
   stand in for, replacing bare
   animate-pulse blocks so loading states
   read as "this is where the content will
   be" rather than an undifferentiated
   gray box.
======================================== */

export function SkeletonLine({
  width = "100%",
  className = "",
}: {
  width?: string;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-shimmer h-3.5 rounded-md ${className}`}
      style={{ width }}
    />
  );
}

export function SkeletonCard({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}
    >
      <SkeletonLine width="40%" className="mb-4 h-4" />

      {Array.from({ length: lines }).map(
        (_, index) => (
          <SkeletonLine
            key={index}
            width={
              index === lines - 1
                ? "60%"
                : "90%"
            }
            className="mb-2.5"
          />
        )
      )}
    </div>
  );
}

export function SkeletonStat({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}
    >
      <SkeletonLine width="55%" className="h-3" />
      <SkeletonLine
        width="35%"
        className="mt-3 h-8"
      />
    </div>
  );
}

export function SkeletonRow({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm ${className}`}
    >
      <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />

      <div className="min-w-0 flex-1">
        <SkeletonLine width="45%" className="h-3.5" />
        <SkeletonLine
          width="70%"
          className="mt-2 h-3"
        />
      </div>
    </div>
  );
}

export function SkeletonGrid({
  count = 4,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}
    >
      {Array.from({ length: count }).map(
        (_, index) => (
          <SkeletonStat key={index} />
        )
      )}
    </div>
  );
}
