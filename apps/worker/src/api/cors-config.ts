import type { CorsOptions } from "cors";

/* ========================================
   CORS

   Allowed browser origins come from
   CORS_ALLOWED_ORIGINS (comma-separated).
   The production web app and local dev are
   always allowed, and WEB_APP_URL (already
   used for redirects) is added too. Origins
   are compared without trailing slashes, so
   "https://x.app/" in an env var still matches
   the browser's "https://x.app".
======================================== */

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://ai-visibility-saas-web.vercel.app",
  "http://localhost:3000",
];

export function normalizeOrigin(
  origin: string
): string {
  return origin.trim().replace(/\/+$/, "");
}

export function parseAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const configured = [
    ...(env.CORS_ALLOWED_ORIGINS ?? "").split(","),
    env.WEB_APP_URL ?? "",
  ];

  return [
    ...new Set(
      [...DEFAULT_ALLOWED_ORIGINS, ...configured]
        .map(normalizeOrigin)
        .filter(Boolean)
    ),
  ];
}

export function buildCorsOptions(
  env: NodeJS.ProcessEnv = process.env
): CorsOptions {
  const allowed = new Set(parseAllowedOrigins(env));

  return {
    /*
     * Requests with no Origin (curl, Stripe
     * webhooks, Vercel cron) are not browser
     * cross-origin calls, so they pass. A
     * disallowed origin simply gets no
     * Access-Control-Allow-Origin header.
     */
    origin(origin, callback) {
      callback(
        null,
        !origin || allowed.has(normalizeOrigin(origin))
      );
    },
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: ["Authorization", "Content-Type"],
    optionsSuccessStatus: 204,
  };
}
