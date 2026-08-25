"use client";

import { useState } from "react";

import Markdown from "./Markdown";
import Modal from "./Modal";
import { truncatePreview } from "./markdownText";

export default function ExpandableMarkdown({
  content,
  title,
  subtitle,
  lines = 3,
  className = "",
}: {
  content: string;
  title?: string;
  subtitle?: string;
  lines?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!content) {
    return null;
  }

  const { preview, truncated } = truncatePreview(
    content,
    lines * 65
  );

  return (
    <div className={className}>
      <p className="whitespace-pre-wrap text-sm leading-7 text-ink-secondary">
        {preview}
      </p>

      {truncated && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-semibold text-primary transition hover:text-primary-hover"
        >
          Show more
        </button>
      )}

      {open && (
        <Modal
          title={title ?? "Full response"}
          subtitle={subtitle}
          onClose={() => setOpen(false)}
          wide
        >
          <Markdown content={content} />
        </Modal>
      )}
    </div>
  );
}
