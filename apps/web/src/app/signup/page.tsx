"use client";

import {
  FormEvent,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

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
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background:
          "#f8fafc",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          background: "#ffffff",
          border:
            "1px solid #e2e8f0",
          borderRadius: "16px",
          padding: "32px",
          boxShadow:
            "0 10px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div
          style={{
            marginBottom: "28px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            Create your workspace
          </h1>

          <p
            style={{
              marginTop: "8px",
              marginBottom: 0,
              color: "#64748b",
              fontSize: "14px",
            }}
          >
            Start monitoring your AI
            visibility.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection:
              "column",
            gap: "16px",
          }}
        >
          <div>
            <label
              htmlFor="fullName"
              style={{
                display: "block",
                marginBottom: "7px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#334155",
              }}
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
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding:
                  "12px 14px",
                border:
                  "1px solid #cbd5e1",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="workspaceName"
              style={{
                display: "block",
                marginBottom: "7px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#334155",
              }}
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
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding:
                  "12px 14px",
                border:
                  "1px solid #cbd5e1",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="websiteUrl"
              style={{
                display: "block",
                marginBottom: "7px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#334155",
              }}
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
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding:
                  "12px 14px",
                border:
                  "1px solid #cbd5e1",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="email"
              style={{
                display: "block",
                marginBottom: "7px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#334155",
              }}
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
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding:
                  "12px 14px",
                border:
                  "1px solid #cbd5e1",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: "7px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#334155",
              }}
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
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding:
                  "12px 14px",
                border:
                  "1px solid #cbd5e1",
                borderRadius: "9px",
                fontSize: "14px",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: "12px",
                borderRadius: "9px",
                background:
                  "#fef2f2",
                border:
                  "1px solid #fecaca",
                color: "#b91c1c",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              border: "none",
              borderRadius: "9px",
              padding:
                "13px 16px",
              background:
                loading
                  ? "#94a3b8"
                  : "#0f172a",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading
                ? "not-allowed"
                : "pointer",
            }}
          >
            {loading
              ? "Creating workspace..."
              : "Create workspace"}
          </button>
        </form>

        <div
          style={{
            marginTop: "24px",
            textAlign: "center",
            fontSize: "14px",
            color: "#64748b",
          }}
        >
          Already have an account?{" "}
          <a
            href="/login"
            style={{
              color: "#0f172a",
              fontWeight: 600,
              textDecoration:
                "none",
            }}
          >
            Sign in
          </a>
        </div>
      </div>
    </main>
  );
}