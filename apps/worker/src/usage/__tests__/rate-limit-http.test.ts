import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import express from "express";

import { RateLimitError } from "../rate-limiter.js";
import {
  rateLimitErrorHandler,
  respondIfRateLimited,
} from "../rate-limit-http.js";

let server: Server;
let baseUrl: string;

before(() => {
  const app = express();

  /* A route that lets the error escape (Express 5 forwards async rejections). */
  app.get("/escapes", async () => {
    throw new RateLimitError("openrouter", "tenant-a", 17);
  });

  /* A route with its own catch block, like most of server.ts. */
  app.get("/caught", async (_req, res) => {
    try {
      throw new RateLimitError("firecrawl", "tenant-a", 3);
    } catch (error) {
      if (respondIfRateLimited(res, error)) {
        return;
      }

      res.status(500).json({ success: false });
    }
  });

  app.get("/caught-other", async (_req, res) => {
    try {
      throw new Error("something else");
    } catch (error) {
      if (respondIfRateLimited(res, error)) {
        return;
      }

      res.status(500).json({ success: false, error: "other" });
    }
  });

  app.get("/escapes-other", async () => {
    throw new Error("unrelated failure");
  });

  app.use(rateLimitErrorHandler);

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe("rate limit -> 429", () => {
  it("answers 429 with Retry-After and a clear body when the error escapes a route", async () => {
    const res = await fetch(`${baseUrl}/escapes`);
    const body = await res.json();

    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "17");
    assert.equal(body.success, false);
    assert.equal(body.code, "rate_limited");
    assert.equal(body.provider, "openrouter");
    assert.equal(body.retryAfterSeconds, 17);
    assert.match(body.error, /Rate limit exceeded for openrouter\. Retry in 17s\./);
  });

  it("respondIfRateLimited gives the same 429 from inside a route's own catch", async () => {
    const res = await fetch(`${baseUrl}/caught`);

    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "3");
    assert.equal((await res.json()).provider, "firecrawl");
  });

  it("leaves every other error alone", async () => {
    const caught = await fetch(`${baseUrl}/caught-other`);

    assert.equal(caught.status, 500);
    assert.equal((await caught.json()).error, "other");

    const escaped = await fetch(`${baseUrl}/escapes-other`);

    assert.equal(escaped.status, 500);
    assert.equal(escaped.headers.get("retry-after"), null);
  });
});
