/* ========================================
   EMPTY STATE

   A consistent "nothing here yet" block -
   icon + title + description + optional
   action - so empty states read as
   intentionally designed rather than a
   placeholder string. Icons are inline SVG
   (no emoji, no icon-library dependency).
======================================== */

export type EmptyStateIcon =
  | "inbox"
  | "search"
  | "chart"
  | "document"
  | "check"
  | "link";

function EmptyStateGlyph({
  icon,
}: {
  icon: EmptyStateIcon;
}) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (icon) {
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );

    case "chart":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 15l4-5 3 3 5-7" />
        </svg>
      );

    case "document":
      return (
        <svg {...common}>
          <path d="M14 3v5a1 1 0 0 0 1 1h5" />
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="13" y2="17" />
        </svg>
      );

    case "check":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
      );

    case "link":
      return (
        <svg {...common}>
          <path d="M9 17H7a5 5 0 0 1 0-10h2" />
          <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );

    case "inbox":
    default:
      return (
        <svg {...common}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        </svg>
      );
  }
}

export default function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  className = "",
}: {
  icon?: EmptyStateIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`animate-fade-in flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center shadow-sm ${className}`}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary">
        <EmptyStateGlyph icon={icon} />
      </div>

      <div className="mt-4 text-sm font-semibold text-ink">
        {title}
      </div>

      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
          {description}
        </p>
      )}

      {action && (
        <div className="mt-5">{action}</div>
      )}
    </div>
  );
}
