import { createHmac, randomBytes } from "node:crypto";

/* ========================================
   GOOGLE OAUTH STATE

   Google's callback redirect is a plain
   top-level browser navigation - it carries
   none of our session headers, so the
   callback route can't use requireAuth. This
   signs {tenantId, nonce, issuedAt} with the
   existing vault master key so the callback
   can verify which tenant started the flow
   and reject anything forged or stale,
   without needing a new "pending OAuth"
   table or session state.
======================================== */

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  tenantId: string;
  nonce: string;
  issuedAt: number;
}

function getStateSecret(): string {
  const secret =
    process.env
      .CREDENTIAL_VAULT_MASTER_KEY;

  if (!secret) {
    throw new Error(
      "CREDENTIAL_VAULT_MASTER_KEY environment variable is required."
    );
  }

  return secret;
}

function sign(payload: string): string {
  return createHmac(
    "sha256",
    getStateSecret()
  )
    .update(payload)
    .digest("base64url");
}

/* ========================================
   BUILD STATE
======================================== */

export function buildOAuthState(
  tenantId: string
): string {
  const payload: StatePayload = {
    tenantId,
    nonce:
      randomBytes(16).toString(
        "hex"
      ),
    issuedAt: Date.now(),
  };

  const encodedPayload =
    Buffer.from(
      JSON.stringify(payload)
    ).toString("base64url");

  const signature = sign(
    encodedPayload
  );

  return `${encodedPayload}.${signature}`;
}

/* ========================================
   VERIFY STATE
======================================== */

export function verifyOAuthState(
  state: string
): { tenantId: string } | null {
  const [
    encodedPayload,
    signature,
  ] = state.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(
    encodedPayload
  );

  if (
    signature !== expectedSignature
  ) {
    return null;
  }

  let payload: StatePayload;

  try {
    payload = JSON.parse(
      Buffer.from(
        encodedPayload,
        "base64url"
      ).toString("utf8")
    );
  } catch {
    return null;
  }

  if (
    typeof payload.tenantId !==
      "string" ||
    typeof payload.issuedAt !==
      "number"
  ) {
    return null;
  }

  if (
    Date.now() - payload.issuedAt >
    STATE_TTL_MS
  ) {
    return null;
  }

  return { tenantId: payload.tenantId };
}
