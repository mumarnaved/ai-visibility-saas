import { rm } from "node:fs/promises";

import {
  LocalFilesystemStorageAdapter,
} from "./storage-service.js";

const testRoot =
  "./storage-test-tmp";

async function main(): Promise<void> {
  try {
    console.log("");
    console.log("========================================");
    console.log(" STORAGE SERVICE TEST");
    console.log("========================================");
    console.log("");

    const adapter =
      new LocalFilesystemStorageAdapter(
        testRoot
      );

    const key =
      "tenant-test/crawls/latest.json";

    await adapter.write(
      key,
      JSON.stringify({
        ok: true,
      })
    );

    const content =
      await adapter.read(key);

    console.log(
      `Read back: ${content.toString()}`
    );

    const keys =
      await adapter.list(
        "tenant-test"
      );

    console.log(
      `Listed keys: ${JSON.stringify(keys)}`
    );

    await adapter.delete(key);

    let escaped = false;

    try {
      await adapter.write(
        "../../etc/passwd",
        "malicious"
      );
    } catch {
      escaped = true;
    }

    if (!escaped) {
      throw new Error(
        "Path-escape attempt was not rejected."
      );
    }

    console.log(
      "Path-escape attempt correctly rejected."
    );

    console.log("");
    console.log("========================================");
    console.log(" STORAGE SERVICE TEST PASSED");
    console.log("========================================");
  } catch (error) {
    console.error("");
    console.error(
      "Storage service test FAILED."
    );

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  } finally {
    await rm(testRoot, {
      recursive: true,
      force: true,
    });
  }
}

await main();
