import "dotenv/config";

import {
  getCredential,
  revokeCredential,
  storeCredential,
} from "./credential-vault-service.js";

import { pool } from "../connection.js";

const provider = "test-provider";

try {
  const tenantResult =
    await pool.query<{
      id: string;
    }>(
      `SELECT id FROM platform.tenants LIMIT 1`
    );

  const tenantId =
    tenantResult.rows[0]?.id;

  if (!tenantId) {
    throw new Error(
      "No tenant found to test the credential vault against. Provision a tenant first."
    );
  }

  await storeCredential(
    tenantId,
    provider,
    "super-secret-value"
  );

  const retrieved =
    await getCredential(
      tenantId,
      provider
    );

  if (retrieved !== "super-secret-value") {
    throw new Error(
      `Expected decrypted value to round-trip, got: ${retrieved}`
    );
  }

  console.log(
    "Credential store/retrieve: OK"
  );

  await revokeCredential(
    tenantId,
    provider
  );

  const afterRevoke =
    await getCredential(
      tenantId,
      provider
    );

  if (afterRevoke !== null) {
    throw new Error(
      "Expected credential to be null after revoke."
    );
  }

  console.log(
    "Credential revoke: OK"
  );
} catch (error) {
  console.error(
    "Credential vault test: FAILED"
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
} finally {
  await pool.query(
    `DELETE FROM platform.credential_vault WHERE provider = $1`,
    [provider]
  );

  await pool.end();
}
