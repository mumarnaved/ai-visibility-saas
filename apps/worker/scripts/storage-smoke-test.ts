import "dotenv/config";

import {
  createStorageAdapter,
} from "../src/services/storage/storage-service.js";

import {
  SupabaseStorageAdapter,
} from "../src/services/storage/supabase-storage-adapter.js";

/*
 * Smoke test of the Supabase storage adapter against
 * the real bucket. Creates no tenant; it only touches
 * the smoke-test/ prefix and removes what it wrote.
 *
 *   pnpm --filter worker exec tsx scripts/storage-smoke-test.ts
 *
 * Prints PASS/FAIL per step and error messages only.
 * Never prints a key or a URL.
 */

const KEY = "smoke-test/hello.txt";
const PREFIX = "smoke-test/";
const CONTENT = `hello from the storage smoke test ${Date.now()}`;

let failed = false;

async function step(
  name: string,
  run: () => Promise<void>
): Promise<boolean> {
  try {
    await run();
    console.log(`PASS  ${name}`);
    return true;
  } catch (error) {
    failed = true;
    console.log(
      `FAIL  ${name}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
    return false;
  }
}

function check(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const missing = [
  "STORAGE_BACKEND",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
].filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.log(
    `FAIL  config: missing ${missing.join(", ")} (SUPABASE_STORAGE_BUCKET is optional, default tenant-storage)`
  );
  process.exit(1);
}

let storage: SupabaseStorageAdapter | undefined;

await step("config: STORAGE_BACKEND selects Supabase", async () => {
  const adapter = createStorageAdapter();

  check(
    adapter instanceof SupabaseStorageAdapter,
    "STORAGE_BACKEND must be \"supabase\""
  );

  storage = adapter as SupabaseStorageAdapter;
});

if (storage) {
  const s = storage;

  await step(`write ${KEY}`, () => s.write(KEY, CONTENT));

  await step(`read ${KEY} back`, async () => {
    const got = (await s.read(KEY)).toString("utf8");

    check(got === CONTENT, "content read back does not match what was written");
  });

  await step(`list ${PREFIX}`, async () => {
    const keys = await s.list(PREFIX);

    check(
      keys.includes(KEY),
      `${KEY} not found in listing (got ${keys.length} key(s))`
    );
  });

  await step(`delete ${KEY}`, () => s.delete(KEY));

  await step("confirm it is gone (read fails, list is empty)", async () => {
    let readFailed = false;

    try {
      await s.read(KEY);
    } catch {
      readFailed = true;
    }

    check(readFailed, "object is still readable after delete");

    const keys = await s.list(PREFIX);

    check(
      !keys.includes(KEY),
      "object is still listed after delete"
    );
  });
}

console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");

process.exit(failed ? 1 : 0);
