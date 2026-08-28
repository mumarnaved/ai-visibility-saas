"use client";

import { useEffect, useState } from "react";

const CLOSE_ANIMATION_MS = 150;

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [isClosing, setIsClosing] =
    useState(false);

  function requestClose() {
    if (isClosing) {
      return;
    }

    setIsClosing(true);

    setTimeout(
      onClose,
      CLOSE_ANIMATION_MS
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm ${
        isClosing
          ? "modal-backdrop-out"
          : "modal-backdrop-in"
      }`}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`glass-panel flex max-h-[85vh] w-full ${
          wide ? "max-w-4xl" : "max-w-2xl"
        } flex-col overflow-hidden rounded-2xl ${
          isClosing
            ? "modal-panel-out"
            : "modal-panel-in"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-glass-border px-6 py-5">
          <div className="min-w-0">
            {title && (
              <h2
                className="line-clamp-2 text-base font-semibold text-ink"
                title={title}
              >
                {title}
              </h2>
            )}

            {subtitle && (
              <p className="mt-1 truncate text-sm text-ink-muted">
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            autoFocus
            className="shrink-0 rounded-lg p-1.5 text-ink-muted transition hover:bg-glass-surface-nested hover:text-ink"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
