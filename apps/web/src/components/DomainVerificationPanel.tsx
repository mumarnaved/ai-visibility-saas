"use client";

import { useState } from "react";

import { authFetch } from "@/lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

const IS_DEV =
  process.env.NODE_ENV === "development";

type VerifyMethod = "dns" | "file";

export default function DomainVerificationPanel({
  tenantId,
  websiteUrl,
  verificationToken,
  onVerified,
}: {
  tenantId: string;
  websiteUrl: string;
  verificationToken: string;
  onVerified: () => void;
}) {
  const [method, setMethod] =
    useState<VerifyMethod>("dns");

  const [verifying, setVerifying] =
    useState(false);

  const [quickVerifying, setQuickVerifying] =
    useState(false);

  const [error, setError] = useState("");

  const [copied, setCopied] = useState(false);

  let domain = websiteUrl;

  try {
    domain = new URL(websiteUrl).hostname;
  } catch {
    // Fall back to the raw string if parsing fails.
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(
        verificationToken
      );

      setCopied(true);

      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail silently (permissions);
      // the token is still visible to copy manually.
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setError("");

    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/tenants/${tenantId}/verify-domain`,
        {
          method: "POST",
          body: JSON.stringify({ method }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Domain verification failed."
        );
      }

      onVerified();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Domain verification failed."
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleQuickVerify() {
    setQuickVerifying(true);
    setError("");

    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/tenants/${tenantId}/quick-verify-domain`,
        { method: "POST" }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Quick verify failed."
        );
      }

      onVerified();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Quick verify failed."
      );
    } finally {
      setQuickVerifying(false);
    }
  }

  return (
    <div className="rounded-xl border border-warning/30 bg-warning-bg p-5 sm:p-6">
      <div className="text-sm font-semibold text-warning-text">
        Verify domain ownership
      </div>

      <p className="mt-1 text-sm text-ink-muted">
        Prove you own <strong>{domain}</strong> so
        we can start auditing it. Choose one method
        below.
      </p>

      {/* METHOD SWITCH */}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMethod("dns")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            method === "dns"
              ? "bg-ink text-white"
              : "border border-border-strong bg-surface text-ink-secondary hover:bg-muted"
          }`}
        >
          DNS TXT record
        </button>

        <button
          type="button"
          onClick={() => setMethod("file")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            method === "file"
              ? "bg-ink text-white"
              : "border border-border-strong bg-surface text-ink-secondary hover:bg-muted"
          }`}
        >
          File upload
        </button>
      </div>

      {/* INSTRUCTIONS */}

      <div className="mt-4 rounded-lg bg-surface p-4">
        {method === "dns" ? (
          <>
            <div className="text-xs font-semibold text-ink-secondary">
              Add this DNS TXT record
            </div>

            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-ink-faint">
                  Name
                </dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {`_ai-visibility-verify.${domain}`}
                </dd>
              </div>

              <div>
                <dt className="text-ink-faint">
                  Value
                </dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {verificationToken}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold text-ink-secondary">
              Publish this file
            </div>

            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-ink-faint">
                  URL
                </dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {`https://${domain}/.well-known/ai-visibility-verify.txt`}
                </dd>
              </div>

              <div>
                <dt className="text-ink-faint">
                  File contents (exact)
                </dt>
                <dd className="mt-0.5 break-all font-mono text-ink">
                  {verificationToken}
                </dd>
              </div>
            </dl>
          </>
        )}

        <button
          type="button"
          onClick={copyToken}
          className="mt-3 rounded-md border border-border-strong bg-surface px-3 py-1 text-xs font-medium text-ink-secondary transition hover:bg-muted"
        >
          {copied ? "Copied!" : "Copy token"}
        </button>
      </div>

      {/* ERROR */}

      {error && (
        <div className="mt-4 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-text">
          {error}
        </div>
      )}

      {/* ACTIONS */}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifying ? "Verifying..." : "Verify now"}
        </button>

        {IS_DEV && (
          <button
            type="button"
            onClick={handleQuickVerify}
            disabled={quickVerifying}
            title="Skips real DNS/file checks. Only available in development."
            className="rounded-lg border border-dashed border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {quickVerifying
              ? "Verifying..."
              : "Quick verify (dev only)"}
          </button>
        )}
      </div>
    </div>
  );
}
