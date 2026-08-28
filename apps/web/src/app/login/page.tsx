"use client";

import {
  FormEvent,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import { toast } from "sonner";

import {
  saveAuth,
} from "../../lib/auth";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export default function LoginPage() {
  const router = useRouter();

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
          `${API_URL}/api/auth/login`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              email: email.trim(),
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
            "Login failed."
        );
      }

      const authData =
        result.data;

      if (
        !authData ||
        !authData.user ||
        !authData.tenant ||
        !authData.workspace ||
        !authData.session ||
        typeof authData.session
          .sessionToken !== "string" ||
        !authData.session
          .sessionToken
      ) {
        throw new Error(
          "Login succeeded but authentication data is incomplete."
        );
      }

      saveAuth(authData);

      toast.success("Welcome back!");

      router.push("/");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Login failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="animate-page-in flex min-h-screen items-center justify-center bg-page p-6 text-ink">

      <div className="glass-panel w-full max-w-[420px] rounded-2xl p-8">

        <div className="mb-7">
          <h1 className="text-[28px] font-bold tracking-tight text-ink">
            Welcome back
          </h1>

          <p className="mt-2 text-sm text-ink-muted">
            Sign in to your AI Visibility workspace.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
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
              placeholder="Enter your password"
              required
              autoComplete="current-password"
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
              ? "Signing in..."
              : "Sign in"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-ink-muted">
          Don&apos;t have an account?{" "}
          <a
            href="/signup"
            className="font-semibold text-ink transition hover:text-primary"
          >
            Create one
          </a>
        </div>
      </div>
    </main>
  );
}
