"use client";

import type { TenantSummary } from "../lib/tenant";

/* ========================================
   SCAN PROGRESS BANNER

   Shows the automatic Stage 1 + Stage 2 scan
   that fires right after domain verification
   (or Quick verify). Lives at the layout level
   (rendered by AppShell) rather than on the
   Overview page specifically, so it's visible
   no matter which page the user lands on after
   verifying - including the onboarding flow's
   redirect to /ai-visibility, which is what
   made it invisible when it only lived on
   Overview.
======================================== */

export default function ScanProgressBanner({
  tenant,
}: {
  tenant: TenantSummary | null;
}) {
  if (!tenant) {
    return null;
  }

  const inProgress =
    tenant.scan_status === "auditing" ||
    tenant.scan_status === "planning";

  if (inProgress) {
    return (
      <div className="mx-5 mt-5 flex items-center gap-4 rounded-xl border border-info bg-info-bg p-5 sm:mx-8">

        <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-info-text border-t-transparent" />

        <div>
          <div className="text-sm font-semibold text-info-text">
            {tenant.scan_status === "auditing"
              ? "Running your first scan..."
              : "Building your content plan..."}
          </div>

          <p className="mt-1 text-sm text-ink-muted">
            {tenant.scan_status === "auditing"
              ? "Auditing your site and checking a couple of default AI queries. This can take a minute."
              : "Turning the audit into a content plan for you to review."}
          </p>
        </div>

      </div>
    );
  }

  if (tenant.scan_status === "failed") {
    return (
      <div className="mx-5 mt-5 rounded-xl border border-danger-border bg-danger-bg p-5 sm:mx-8">
        <div className="text-sm font-semibold text-danger-text">
          Automatic scan failed
        </div>

        <p className="mt-1 text-sm text-danger-text">
          {tenant.scan_error ||
            "Something went wrong running your first scan."}{" "}
          You can still run audits manually from the Agents page.
        </p>
      </div>
    );
  }

  return null;
}
