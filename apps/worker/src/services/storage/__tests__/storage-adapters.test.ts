import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildTenantManifest,
  manifestStorageKey,
  tenantNamespaces,
} from "../../../context/tenant-manifest.js";
import { FakePg } from "../../../database/postgres/__tests__/fake-pg.js";
import { ensureTenantManifest } from "../../../database/postgres/tenant-manifest-store.js";
import {
  createStorageAdapter,
  LocalFilesystemStorageAdapter,
} from "../storage-service.js";
import {
  StorageNotFoundError,
  SupabaseStorageAdapter,
  type FetchLike,
} from "../supabase-storage-adapter.js";

/* ========================================
   FAKE SUPABASE STORAGE REST API

   One in-memory bucket behind a fetch
   function: upload (with upsert), download,
   delete, and the folder-aware list endpoint
   with limit/offset paging.
======================================== */

const BUCKET = "tenant-storage";
const SECRET = "service-role-secret-do-not-leak";

function fakeSupabase() {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; url: string }[] = [];

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  const fetchFake: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = init.headers as Record<string, string>;

    requests.push({ method, url: url.pathname });

    if (headers.Authorization !== `Bearer ${SECRET}`) {
      return json({ message: "unauthorized" }, 401);
    }

    const listMatch = url.pathname.match(
      /^\/storage\/v1\/object\/list\/([^/]+)$/
    );

    if (listMatch && method === "POST") {
      assert.equal(listMatch[1], BUCKET);

      const { prefix, limit, offset } = JSON.parse(
        String(init.body)
      ) as { prefix: string; limit: number; offset: number };

      const folder = prefix ? `${prefix}/` : "";
      const names = new Map<string, boolean>();

      for (const key of [...objects.keys()].sort()) {
        if (!key.startsWith(folder)) continue;

        const rest = key.slice(folder.length);
        const [head, ...tail] = rest.split("/");

        names.set(head, tail.length === 0);
      }

      const page = [...names]
        .slice(offset, offset + limit)
        .map(([name, isFile]) => ({
          name,
          id: isFile ? `id-${name}` : null,
        }));

      return json(page);
    }

    const objectMatch = url.pathname.match(
      /^\/storage\/v1\/object\/([^/]+)\/(.+)$/
    );

    if (!objectMatch) {
      return json({ message: "no route" }, 404);
    }

    assert.equal(objectMatch[1], BUCKET);
    const key = objectMatch[2]
      .split("/")
      .map(decodeURIComponent)
      .join("/");

    if (method === "POST") {
      objects.set(key, Buffer.from(init.body as Uint8Array));
      return json({ Key: `${BUCKET}/${key}` });
    }

    if (method === "GET") {
      const found = objects.get(key);
      return found
        ? new Response(new Uint8Array(found))
        : json({ statusCode: "404", error: "not_found" }, 400);
    }

    if (method === "DELETE") {
      return objects.delete(key)
        ? json({ message: "Successfully deleted" })
        : json({ statusCode: "404", error: "not_found" }, 404);
    }

    return json({ message: "bad method" }, 405);
  };

  return { fetchFake, objects, requests };
}

function adapter() {
  const fake = fakeSupabase();

  return {
    ...fake,
    storage: new SupabaseStorageAdapter({
      url: "https://project.supabase.co/",
      serviceRoleKey: SECRET,
      fetch: fake.fetchFake,
    }),
  };
}

/* ========================================
   SUPABASE ADAPTER
======================================== */

describe("SupabaseStorageAdapter", () => {
  it("writes then reads back a string and a Buffer", async () => {
    const { storage } = adapter();

    await storage.write("tenant-a/a.json", '{"ok":true}');
    await storage.write("tenant-a/b.bin", Buffer.from([1, 2, 3]));

    assert.equal(
      (await storage.read("tenant-a/a.json")).toString("utf8"),
      '{"ok":true}'
    );
    assert.deepEqual(
      [...(await storage.read("tenant-a/b.bin"))],
      [1, 2, 3]
    );
  });

  it("overwrites an existing object (upsert)", async () => {
    const { storage } = adapter();

    await storage.write("tenant-a/x.txt", "one");
    await storage.write("tenant-a/x.txt", "two");

    assert.equal(
      (await storage.read("tenant-a/x.txt")).toString(),
      "two"
    );
  });

  it("reading a missing object throws a not-found error", async () => {
    const { storage } = adapter();

    await assert.rejects(
      () => storage.read("tenant-a/missing.txt"),
      (error: unknown) =>
        error instanceof StorageNotFoundError &&
        error.code === "ENOENT"
    );
  });

  it("lists recursively under a prefix, only that prefix, and pages past 100", async () => {
    const { storage } = adapter();

    await storage.write("tenant-a/tenant_manifest.json", "{}");
    await storage.write("tenant-a/reports/r1.json", "{}");
    await storage.write("tenant-a/reports/deep/r2.json", "{}");
    await storage.write("tenant-ab/other.json", "{}");
    await storage.write("tenant-b/b.json", "{}");

    for (let i = 0; i < 230; i++) {
      await storage.write(
        `tenant-big/f${String(i).padStart(3, "0")}.txt`,
        "x"
      );
    }

    assert.deepEqual((await storage.list("tenant-a")).sort(), [
      "tenant-a/reports/deep/r2.json",
      "tenant-a/reports/r1.json",
      "tenant-a/tenant_manifest.json",
    ]);
    assert.deepEqual(
      await storage.list("tenant-a/"),
      await storage.list("tenant-a")
    );
    assert.equal((await storage.list("tenant-big")).length, 230);
    assert.deepEqual(await storage.list("tenant-nobody"), []);
  });

  it("deletes one object; deleting a missing one is not an error", async () => {
    const { storage } = adapter();

    await storage.write("tenant-a/a.txt", "a");
    await storage.write("tenant-a/b.txt", "b");

    await storage.delete("tenant-a/a.txt");
    await storage.delete("tenant-a/never-existed.txt");

    assert.deepEqual(await storage.list("tenant-a"), [
      "tenant-a/b.txt",
    ]);
  });

  it("deletes everything under a prefix via list + delete, leaving other tenants", async () => {
    const { storage } = adapter();

    await storage.write("tenant-a/m.json", "{}");
    await storage.write("tenant-a/reports/r.json", "{}");
    await storage.write("tenant-ab/keep.json", "{}");

    for (const key of await storage.list("tenant-a")) {
      await storage.delete(key);
    }

    assert.deepEqual(await storage.list("tenant-a"), []);
    assert.deepEqual(await storage.list("tenant-ab"), [
      "tenant-ab/keep.json",
    ]);
  });

  it("rejects keys that escape the prefix, before any request is made", async () => {
    const { storage, requests } = adapter();

    for (const key of [
      "tenant-a/../tenant-b/x.json",
      "../x",
      "tenant-a/..",
      "/abs/x",
      "tenant-a//x",
      "tenant-a\\x",
      "",
    ]) {
      await assert.rejects(() => storage.write(key, "x"), Error, key);
      await assert.rejects(() => storage.read(key), Error, key);
      await assert.rejects(() => storage.delete(key), Error, key);
      await assert.rejects(() => storage.list(key), Error, key);
    }

    assert.deepEqual(requests, []);
  });

  it("surfaces API errors without leaking the key", async () => {
    const bad = new SupabaseStorageAdapter({
      url: "https://project.supabase.co",
      serviceRoleKey: "wrong-key",
      fetch: adapter().fetchFake,
    });

    await assert.rejects(
      () => bad.write("tenant-a/x.json", "x"),
      (error: unknown) =>
        error instanceof Error &&
        /write failed \(401\)/.test(error.message) &&
        !error.message.includes("wrong-key")
    );
  });

  it("the manifest copy goes through the adapter, under the tenant prefix, and teardown removes it", async () => {
    const { storage, objects } = adapter();
    const id = randomUUID();
    const schemaName = `tenant_${id.replaceAll("-", "")}`;

    const fakePg = new FakePg({
      tenants: [
        {
          id,
          name: "Acme",
          schema_name: schemaName,
          status: "active",
        },
      ],
    });

    await ensureTenantManifest(
      fakePg,
      storage,
      buildTenantManifest({ id, schemaName })
    );

    const { storagePrefix } = tenantNamespaces(id);
    const key = manifestStorageKey({ storagePrefix });

    assert.deepEqual([...objects.keys()], [key]);
    assert.ok(key.startsWith(`${storagePrefix}/`));

    /* what runDueDeprovisioning does with the same prefix */
    for (const stored of await storage.list(storagePrefix)) {
      await storage.delete(stored);
    }

    assert.equal(objects.size, 0);
  });
});

/* ========================================
   BACKEND SELECTION
======================================== */

describe("createStorageAdapter", () => {
  it("defaults to the local filesystem", () => {
    assert.ok(
      createStorageAdapter({}) instanceof
        LocalFilesystemStorageAdapter
    );
    assert.ok(
      createStorageAdapter({ STORAGE_BACKEND: "local" }) instanceof
        LocalFilesystemStorageAdapter
    );
  });

  it("uses Supabase for STORAGE_BACKEND=supabase", () => {
    assert.ok(
      createStorageAdapter({
        STORAGE_BACKEND: "supabase",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: SECRET,
      }) instanceof SupabaseStorageAdapter
    );
  });

  it("names the missing variables, never a value", () => {
    assert.throws(
      () =>
        createStorageAdapter({
          STORAGE_BACKEND: "supabase",
          SUPABASE_URL: "https://project.supabase.co",
        }),
      (error: unknown) =>
        error instanceof Error &&
        /SUPABASE_SERVICE_ROLE_KEY/.test(error.message) &&
        !/project\.supabase\.co/.test(error.message)
    );
  });
});

/* ========================================
   LOCAL ADAPTER STILL REJECTS ESCAPES
======================================== */

describe("LocalFilesystemStorageAdapter", () => {
  it("keeps the path-escape guard and the same list/delete semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-test-"));

    try {
      const local = new LocalFilesystemStorageAdapter(root);

      await local.write("tenant-a/reports/r.json", "{}");
      assert.deepEqual(await local.list("tenant-a"), [
        "tenant-a/reports/r.json",
      ]);
      await assert.rejects(() => local.write("tenant-a/../x", "x"));
      await local.delete("tenant-a/reports/r.json");
      assert.deepEqual(await local.list("tenant-a"), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
