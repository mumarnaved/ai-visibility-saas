"use client";

import { useState } from "react";

import Modal from "./Modal";

export default function ExpandableJson({
  value,
  title,
  subtitle,
  lines = 3,
  className = "",
}: {
  value: unknown;
  title?: string;
  subtitle?: string;
  lines?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const formatted = JSON.stringify(value, null, 2);

  const maxChars = lines * 65;

  const truncated = formatted.length > maxChars;

  const preview = truncated
    ? `${formatted.slice(0, maxChars)}…`
    : formatted;

  return (
    <div className={className}>
      <pre className="overflow-hidden whitespace-pre-wrap break-words text-xs text-ink-muted">
        {preview}
      </pre>

      {truncated && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-semibold text-primary transition hover:text-primary-hover"
        >
          View full details
        </button>
      )}

      {open && (
        <Modal
          title={title ?? "Full details"}
          subtitle={subtitle}
          onClose={() => setOpen(false)}
          wide
        >
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted p-4 text-xs text-ink-secondary">
            {formatted}
          </pre>
        </Modal>
      )}
    </div>
  );
}
