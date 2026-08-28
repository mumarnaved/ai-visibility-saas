"use client";

import {
  FormEvent,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import { toast } from "sonner";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export default function SignupPage() {
  const router = useRouter();

  const [fullName, setFullName] =
    useState("");

  const [workspaceName, setWorkspaceName] =
    useState("");

  const [websiteUrl, setWebsiteUrl] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response =
        await fetch(
          `${API_URL}/api/auth/signup`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              fullName:
                fullName.trim(),
              workspaceName:
                workspaceName.trim(),
              websiteUrl:
                websiteUrl.trim(),
              email:
                email.trim(),
              password,
            }),
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Signup failed."
        );
      }

      const sessionToken =
        result.data?.session
          ?.sessionToken;

      if (
        typeof sessionToken !==
        "string" ||
        !sessionToken
      ) {
        throw new Error(
          "Signup succeeded but no session token was returned."
        );
      }

      localStorage.setItem(
        "ai_visibility_session_token",
        sessionToken
      );

      localStorage.setItem(
        "ai_visibility_user",
        JSON.stringify(
          result.data.user
        )
      );

      localStorage.setItem(
        "ai_visibility_tenant",
        JSON.stringify(
          result.data.tenant
        )
      );

      localStorage.setItem(
        "ai_visibility_workspace",
        JSON.stringify(
          result.data.workspace
        )
      );

      toast.success(
        "Workspace created!"
      );

      router.push("/");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Signup failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="animate-page-in flex min-h-screen items-center justify-center bg-page p-6 text-ink">

      <div className="glass-panel w-full max-w-[480px] rounded-2xl p-8">

        <div className="mb-7">
          <h1 className="text-[28px] font-bold tracking-tight text-ink">
            Create your workspace
          </h1>

          <p className="mt-2 text-sm text-ink-muted">
            Start monitoring your AI visibility.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          <div>
            <label
              htmlFor="fullName"
              className="mb-1.5 block text-sm font-semibold text-ink-secondary"
            >
              Full name
            </label>

            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(event) =>
                setFullName(
                  event.target.value
                )
              }
              placeholder="Test User"
              required
              autoComplete="name"
              className="w-full rounded-lg border border-border-strong bg-surface px-3.5 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="workspaceName"
              className="mb-1.5 block text-sm font-semibold text-ink-secondary"
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
              placeholder="My Company"
              required
              className="w-full rounded-lg border border-border-strong bg-surface px-3.5 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="websiteUrl"
              className="mb-1.5 block text-sm font-semibold text-ink-secondary"
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
              placeholder="https://example.com"
              required
              autoComplete="url"
              className="w-full rounded-lg border border-border-strong bg-surface px-3.5 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-semibold text-ink-secondary"
            >
              Email
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-border-strong bg-surface px-3.5 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-semibold text-ink-secondary"
            >
              Password
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
              placeholder="Create a password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border-strong bg-surface px-3.5 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="animate-fade-in rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Creating workspace..."
              : "Create workspace"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-semibold text-ink transition hover:text-primary"
          >
            Sign in
          </a>
        </div>
      </div>
    </main>
  );
}
