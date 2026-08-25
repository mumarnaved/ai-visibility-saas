"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { authFetch } from "@/lib/auth";
import DomainVerificationPanel from "@/components/DomainVerificationPanel";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  schemaName: string;
  status: string;
  plan: string;
  verificationToken: string | null;
  domainVerifiedAt: string | null;
};

type TenantResponse = {
  success: boolean;
  data?: Tenant;
  error?: string;
};

export default function OnboardingPage() {
  const router = useRouter();

  const [website, setWebsite] = useState("");
  const [companyName, setCompanyName] = useState("");

  const [loading, setLoading] = useState(false);

  const [step, setStep] = useState<
    "form" | "verify" | "complete"
  >("form");

  const [message, setMessage] = useState("");

  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");

    const trimmedCompanyName =
      companyName.trim();

    const trimmedWebsite =
      website.trim();

    if (!trimmedCompanyName) {
      setMessage(
        "Please enter your company or brand name."
      );
      return;
    }

    if (!trimmedWebsite) {
      setMessage(
        "Please enter your website URL."
      );
      return;
    }

    let parsedWebsite: URL;

    try {
      parsedWebsite =
        new URL(trimmedWebsite);
    } catch {
      setMessage(
        "Please enter a valid website URL."
      );
      return;
    }

    if (
      !["http:", "https:"].includes(
        parsedWebsite.protocol
      )
    ) {
      setMessage(
        "Website URL must use HTTP or HTTPS."
      );
      return;
    }

    setLoading(true);
    setStep("form");

    try {
      /* ========================================
         STEP 1
         CREATE TENANT
      ======================================== */

      setMessage(
        "Creating your workspace..."
      );

      const tenantResponse =
        await authFetch(
          "http://localhost:4000/api/tenants",
          {
            method: "POST",
            body: JSON.stringify({
              tenantName:
                trimmedCompanyName,
              websiteUrl:
                trimmedWebsite,
            }),
          }
        );

      const tenantResult: TenantResponse =
        await tenantResponse.json();

      if (
        !tenantResponse.ok ||
        !tenantResult.success ||
        !tenantResult.data
      ) {
        throw new Error(
          tenantResult.error ||
            "Failed to create your workspace."
        );
      }

      /* ========================================
         STEP 2
         VERIFY DOMAIN

         Stage 1 audits (technical, content/
         entity, citation visibility, competitor
         benchmark) run on demand from the Agents
         or AI Visibility pages, not as part of
         onboarding, so there is no audit pre-check
         here - just domain ownership verification.
      ======================================== */

      setTenant(tenantResult.data);
      setStep("verify");
      setMessage("");
      setLoading(false);
    } catch (error) {
      console.error(
        "Onboarding failed:",
        error
      );

      setStep("form");

      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong during setup."
      );

      setLoading(false);
    }
  }

  function goToDashboard() {
    setStep("complete");

    setMessage(
      "All set. Redirecting..."
    );

    setTimeout(() => {
      router.push("/ai-visibility");
      router.refresh();
    }, 700);
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#111827]">

      {/* ========================================
          HEADER
      ======================================== */}

      <header className="flex h-16 items-center justify-between border-b border-[#e5e7eb] bg-white px-5 sm:px-8">

        <Link
          href="/"
          className="text-lg font-bold tracking-tight"
        >
          AI Visibility
        </Link>

        <Link
          href="/"
          className="text-sm font-medium text-[#6b7280] transition hover:text-[#111827]"
        >
          Back to dashboard
        </Link>

      </header>

      {/* ========================================
          CONTENT
      ======================================== */}

      <div className="px-5 py-10 sm:px-8 sm:py-16">

        <div className="mx-auto max-w-2xl">

          {/* ========================================
              PROGRESS
          ======================================== */}

          <div className="mb-10">

            <div className="flex items-center justify-between text-xs font-medium text-[#6b7280]">

              <span>
                {step === "form"
                  ? "Step 1 of 3"
                  : step === "verify"
                  ? "Step 2 of 3"
                  : "Step 3 of 3"}
              </span>

              <span>
                {step === "form"
                  ? "Workspace setup"
                  : step === "verify"
                  ? "Verify domain"
                  : "Done"}
              </span>

            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">

              <div
                className={`h-full rounded-full bg-[#111827] transition-all duration-500 ${
                  step === "complete"
                    ? "w-full"
                    : step === "verify"
                    ? "w-2/3"
                    : "w-1/3"
                }`}
              />

            </div>

          </div>

          {step === "form" && (
          <>

          {/* ========================================
              HEADING
          ======================================== */}

          <div className="mb-8">

            <p className="text-sm font-medium text-[#6b7280]">
              Get started
            </p>

            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Connect your website
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-6 text-[#6b7280]">
              Tell us about the website and brand you
              want to monitor. We will create your
              workspace so you can start running audits.
            </p>

          </div>

          {/* ========================================
              FORM
          ======================================== */}

          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-[#e5e7eb] bg-white p-6 sm:p-8"
          >

              {/* COMPANY */}

              <div>

                <label
                  htmlFor="companyName"
                  className="text-sm font-semibold"
                >
                  Company or brand name
                </label>

                <p className="mt-1 text-xs text-[#6b7280]">
                  The name of the brand you want to track.
                </p>

                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(event) =>
                    setCompanyName(
                      event.target.value
                    )
                  }
                  placeholder="e.g. Acme"
                  disabled={loading}
                  className="mt-3 w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-[#9ca3af] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] disabled:bg-[#f9fafb]"
                />

              </div>

              {/* WEBSITE */}

              <div className="mt-6">

                <label
                  htmlFor="website"
                  className="text-sm font-semibold"
                >
                  Website URL
                </label>

                <p className="mt-1 text-xs text-[#6b7280]">
                  Enter the website you want to analyze.
                </p>

                <input
                  id="website"
                  type="url"
                  value={website}
                  onChange={(event) =>
                    setWebsite(
                      event.target.value
                    )
                  }
                  placeholder="https://example.com"
                  disabled={loading}
                  className="mt-3 w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-[#9ca3af] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] disabled:bg-[#f9fafb]"
                />

              </div>

              {/* INFO */}

              <div className="mt-6 rounded-lg bg-[#f9fafb] p-4">

                <div className="text-sm font-semibold">
                  What happens next?
                </div>

                <div className="mt-3 space-y-2 text-xs leading-5 text-[#6b7280]">

                  <div className="flex gap-2">
                    <span className="font-semibold text-[#111827]">
                      1.
                    </span>

                    <span>
                      Your workspace will be created.
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <span className="font-semibold text-[#111827]">
                      2.
                    </span>

                    <span>
                      You&apos;ll verify you own the
                      website, via a DNS record or file
                      upload.
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <span className="font-semibold text-[#111827]">
                      3.
                    </span>

                    <span>
                      You&apos;ll land on your dashboard,
                      where you can run your first Stage 1
                      audit.
                    </span>
                  </div>

                </div>

              </div>

              {/* MESSAGE */}

              {message && (
                <div className="mt-5 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-sm text-[#4b5563]">
                  {message}
                </div>
              )}

              {/* ACTIONS */}

              <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">

                <Link
                  href="/"
                  className={`rounded-lg px-4 py-2.5 text-center text-sm font-medium text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#111827] ${
                    loading
                      ? "pointer-events-none opacity-50"
                      : ""
                  }`}
                >
                  Cancel
                </Link>

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-[#111827] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? "Setting up..."
                    : "Create workspace"}
                </button>

              </div>

            </form>

          </>
          )}

          {/* ========================================
              VERIFY STEP
          ======================================== */}

          {step === "verify" && tenant && (
          <>

            <div className="mb-8">

              <p className="text-sm font-medium text-[#6b7280]">
                Almost there
              </p>

              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                Verify your domain
              </h1>

              <p className="mt-3 max-w-xl text-sm leading-6 text-[#6b7280]">
                {tenant.name} has been created. Verify
                you own {tenant.websiteUrl} to unlock
                audits, or skip for now and verify later.
              </p>

            </div>

            <DomainVerificationPanel
              tenantId={tenant.id}
              websiteUrl={tenant.websiteUrl}
              verificationToken={
                tenant.verificationToken ?? ""
              }
              onVerified={goToDashboard}
            />

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={goToDashboard}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#111827]"
              >
                Skip for now
              </button>
            </div>

          </>
          )}

          {/* ========================================
              COMPLETE STEP
          ======================================== */}

          {step === "complete" && (
            <div className="rounded-xl border border-[#e5e7eb] bg-white p-8 text-center">
              <p className="text-sm text-[#6b7280]">
                {message || "Redirecting..."}
              </p>
            </div>
          )}

        </div>

      </div>

    </main>
  );
}