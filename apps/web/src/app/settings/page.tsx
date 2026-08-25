"use client";

import { useState } from "react";

const TENANT_ID =
  "c32e1840-fb74-4b3d-bf56-f7a97af32a8e";

const WORKER_API =
  "http://localhost:4000";

export default function SettingsPage() {
  const [workspaceName, setWorkspaceName] =
    useState("SoftwareDome");

  const [websiteUrl, setWebsiteUrl] =
    useState("https://softwaredome.com");

  const [plan] =
    useState("Starter");

  const [saved, setSaved] =
    useState(false);

  function handleSave(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setSaved(true);

    setTimeout(() => {
      setSaved(false);
    }, 3000);
  }

  return (
    <main className="min-h-screen bg-page text-ink">

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* HEADER */}

        <div>
          <h1 className="text-2xl font-bold">
            Settings
          </h1>

          <p className="mt-2 text-sm text-ink-muted">
            Manage your workspace configuration
            and AI visibility settings.
          </p>
        </div>

        {/* SUCCESS */}

        {saved && (
          <div className="mt-6 rounded-xl border border-success-border bg-success-bg p-4">
            <div className="text-sm font-semibold text-success-text">
              Settings saved
            </div>

            <p className="mt-1 text-sm text-success-text">
              Your workspace settings have been
              updated successfully.
            </p>
          </div>
        )}

        {/* WORKSPACE */}

        <section className="mt-8 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Workspace
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Basic information about your AI
              visibility workspace.
            </p>
          </div>

          <form
            onSubmit={handleSave}
            className="p-6"
          >

            {/* WORKSPACE NAME */}

            <div>
              <label
                htmlFor="workspaceName"
                className="block text-sm font-medium text-ink-secondary"
              >
                Workspace name
              </label>

              <input
                id="workspaceName"
                type="text"
                value={workspaceName}
                onChange={(event) =>
                  setWorkspaceName(
                    event.target.value
                  )
                }
                className="mt-2 w-full max-w-xl rounded-lg border border-border-strong px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* WEBSITE */}

            <div className="mt-5">
              <label
                htmlFor="websiteUrl"
                className="block text-sm font-medium text-ink-secondary"
              >
                Website URL
              </label>

              <input
                id="websiteUrl"
                type="url"
                value={websiteUrl}
                onChange={(event) =>
                  setWebsiteUrl(
                    event.target.value
                  )
                }
                className="mt-2 w-full max-w-xl rounded-lg border border-border-strong px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
              />

              <p className="mt-2 text-xs text-ink-faint">
                This website is used as the primary
                property for your visibility monitoring.
              </p>
            </div>

            {/* PLAN */}

            <div className="mt-5">
              <label
                htmlFor="plan"
                className="block text-sm font-medium text-ink-secondary"
              >
                Current plan
              </label>

              <div
                id="plan"
                className="mt-2 flex w-full max-w-xl items-center justify-between rounded-lg border border-border bg-muted px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold">
                    {plan}
                  </div>

                  <div className="mt-1 text-xs text-ink-faint">
                    Current workspace subscription
                  </div>
                </div>

                <span className="rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success-text">
                  Active
                </span>
              </div>
            </div>

            {/* SAVE */}

            <div className="mt-7 flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover"
              >
                Save changes
              </button>
            </div>

          </form>

        </section>

        {/* SYSTEM STATUS */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              System status
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Current status of the services powering
              your workspace.
            </p>

          </div>

          <div className="divide-y divide-border">

            <StatusRow
              name="Worker API"
              status="Connected"
            />

            <StatusRow
              name="PostgreSQL Database"
              status="Connected"
            />

            <StatusRow
              name="Tenant Workspace"
              status="Active"
            />

            <StatusRow
              name="AI Visibility Agent"
              status="Ready"
            />

          </div>

        </section>

        {/* WORKSPACE ID */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              Workspace information
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Internal workspace information for
              troubleshooting and support.
            </p>

          </div>

          <div className="p-6">

            <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Tenant ID
            </div>

            <div className="mt-2 break-all rounded-lg bg-muted px-4 py-3 font-mono text-xs text-ink-secondary">
              {TENANT_ID}
            </div>

            <div className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Worker API
            </div>

            <div className="mt-2 rounded-lg bg-muted px-4 py-3 font-mono text-xs text-ink-secondary">
              {WORKER_API}
            </div>

          </div>

        </section>

      </div>

    </main>
  );
}

function StatusRow({
  name,
  status,
}: {
  name: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">

      <div className="text-sm font-medium text-ink-secondary">
        {name}
      </div>

      <div className="flex items-center gap-2">

        <span className="h-2 w-2 rounded-full bg-success" />

        <span className="text-xs font-semibold text-success-text">
          {status}
        </span>

      </div>

    </div>
  );
}