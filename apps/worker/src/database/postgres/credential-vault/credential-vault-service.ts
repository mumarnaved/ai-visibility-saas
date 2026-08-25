import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { pool } from "../connection.js";

/* ========================================
   MASTER KEY
======================================== */

const ALGORITHM = "aes-256-gcm";

function getMasterKey(): Buffer {
  const hexKey =
    process.env
      .CREDENTIAL_VAULT_MASTER_KEY;

  if (!hexKey) {
    throw new Error(
      "CREDENTIAL_VAULT_MASTER_KEY environment variable is required."
    );
  }

  const key =
    Buffer.from(hexKey, "hex");

  if (key.length !== 32) {
    throw new Error(
      "CREDENTIAL_VAULT_MASTER_KEY must be a 32-byte key, hex-encoded."
    );
  }

  return key;
}

/* ========================================
   ENCRYPT
======================================== */

function encrypt(
  plaintextValue: string
): {
  encryptedValue: string;
  iv: string;
  authTag: string;
} {
  const key =
    getMasterKey();

  const iv =
    randomBytes(12);

  const cipher =
    createCipheriv(
      ALGORITHM,
      key,
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        plaintextValue,
        "utf8"
      ),
      cipher.final(),
    ]);

  return {
    encryptedValue:
      encrypted.toString("hex"),

    iv: iv.toString("hex"),

    authTag:
      cipher
        .getAuthTag()
        .toString("hex"),
  };
}

/* ========================================
   DECRYPT
======================================== */

function decrypt(
  encryptedValue: string,
  iv: string,
  authTag: string
): string {
  const key =
    getMasterKey();

  const decipher =
    createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, "hex")
    );

  decipher.setAuthTag(
    Buffer.from(authTag, "hex")
  );

  const decrypted =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          encryptedValue,
          "hex"
        )
      ),
      decipher.final(),
    ]);

  return decrypted.toString("utf8");
}

/* ========================================
   STORE CREDENTIAL
======================================== */

export async function storeCredential(
  tenantId: string,
  provider: string,
  plaintextValue: string
): Promise<void> {
  const {
    encryptedValue,
    iv,
    authTag,
  } = encrypt(plaintextValue);

  await pool.query(
    `
      INSERT INTO platform.credential_vault (
        id,
        tenant_id,
        provider,
        encrypted_value,
        iv,
        auth_tag,
        revoked_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        NULL
      )
      ON CONFLICT (tenant_id, provider)
      DO UPDATE SET
        encrypted_value = EXCLUDED.encrypted_value,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        revoked_at = NULL,
        updated_at = NOW()
    `,
    [
      randomUUID(),
      tenantId,
      provider,
      encryptedValue,
      iv,
      authTag,
    ]
  );
}

/* ========================================
   GET CREDENTIAL
======================================== */

export async function getCredential(
  tenantId: string,
  provider: string
): Promise<string | null> {
  const result =
    await pool.query<{
      encrypted_value: string;
      iv: string;
      auth_tag: string;
    }>(
      `
        SELECT
          encrypted_value,
          iv,
          auth_tag
        FROM platform.credential_vault
        WHERE
          tenant_id = $1 AND
          provider = $2 AND
          revoked_at IS NULL
        LIMIT 1
      `,
      [tenantId, provider]
    );

  const row =
    result.rows[0];

  if (!row) {
    return null;
  }

  try {
    return decrypt(
      row.encrypted_value,
      row.iv,
      row.auth_tag
    );
  } catch {
    /*
     * Never surface decryption details -
     * treat a decrypt failure the same as
     * a missing credential.
     */
    return null;
  }
}

/* ========================================
   REVOKE CREDENTIAL
======================================== */

export async function revokeCredential(
  tenantId: string,
  provider: string
): Promise<void> {
  await pool.query(
    `
      UPDATE platform.credential_vault
      SET
        revoked_at = NOW(),
        updated_at = NOW()
      WHERE
        tenant_id = $1 AND
        provider = $2
    `,
    [tenantId, provider]
  );
}
