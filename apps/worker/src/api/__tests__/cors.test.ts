import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import {
  buildCorsOptions,
  parseAllowedOrigins,
} from "../cors-config.js";

/* Same env bootstrap as tenant-isolation.test.ts: no database is touched. */
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
process.env.VERCEL = "1";
process.env.NODE_ENV = "test";
process.env.CREDENTIAL_VAULT_MASTER_KEY ??= "test-master-key-for-cors";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost/api/oauth/google/callback";

const WEB = "https://ai-visibility-saas-web.vercel.app";

describe("CORS preflight on the real app", () => {
  let server: Server;
  let base: string;

  before(async () => {
    const { default: app } = await import("../server.js");
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  const preflight = (origin: string, path = "/api/auth/login") =>
    fetch(`${base}${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });

  it("allows the production web origin, before auth", async () => {
    const res = await preflight(WEB);

    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), WEB);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(
      res.headers.get("access-control-allow-headers") ?? "",
      /Authorization/i
    );
  });

  it("answers a preflight on a protected tenant route without auth", async () => {
    const res = await preflight(
      WEB,
      "/api/tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/stage1-audit"
    );

    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), WEB);
  });

  it("allows localhost:3000", async () => {
    const res = await preflight("http://localhost:3000");

    assert.equal(
      res.headers.get("access-control-allow-origin"),
      "http://localhost:3000"
    );
  });

  it("does not allow a random origin", async () => {
    const res = await preflight("https://evil.example.com");

    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});

describe("allowed origins config", () => {
  it("reads CORS_ALLOWED_ORIGINS, strips trailing slashes and spaces, keeps the defaults", () => {
    const origins = parseAllowedOrigins({
      CORS_ALLOWED_ORIGINS: " https://a.example.com/ , https://b.example.com ",
    });

    assert.deepEqual(origins, [
      WEB,
      "http://localhost:3000",
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("also trusts WEB_APP_URL, with or without a trailing slash", () => {
    assert.ok(
      parseAllowedOrigins({ WEB_APP_URL: "https://c.example.com/" }).includes(
        "https://c.example.com"
      )
    );
  });

  it("matches a configured origin that has a trailing slash", () => {
    const options = buildCorsOptions({
      CORS_ALLOWED_ORIGINS: "https://a.example.com/",
    });
    const origin = options.origin as (
      o: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void
    ) => void;

    let allowed: boolean | undefined;
    origin("https://a.example.com", (_e, allow) => {
      allowed = allow;
    });

    assert.equal(allowed, true);
  });
});
