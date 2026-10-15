import type express from "express";

import { RateLimitError } from "./rate-limiter.js";

/* ========================================
   RATE LIMIT -> HTTP 429

   Anything that runs a metered provider call
   inside a request can throw RateLimitError.
   The caller gets a clear 429 with a Retry-After
   header (seconds) and the same value in the
   body. Only the limited tenant is affected;
   buckets are per tenant.

   - respondIfRateLimited(): for routes that have
     their own catch block (most do and would
     otherwise answer 500).
   - rateLimitErrorHandler: Express error
     middleware, the safety net for routes that
     let the error escape (Express 5 forwards
     rejected async handlers to it).
======================================== */

export function rateLimitBody(error: RateLimitError) {
  return {
    success: false,
    error: error.message,
    code: "rate_limited",
    provider: error.provider,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

export function respondIfRateLimited(
  res: express.Response,
  error: unknown
): boolean {
  if (!(error instanceof RateLimitError)) {
    return false;
  }

  res
    .status(429)
    .set("Retry-After", String(error.retryAfterSeconds))
    .json(rateLimitBody(error));

  return true;
}

export const rateLimitErrorHandler: express.ErrorRequestHandler =
  (error, _req, res, next) => {
    if (res.headersSent || !respondIfRateLimited(res, error)) {
      next(error);
    }
  };
