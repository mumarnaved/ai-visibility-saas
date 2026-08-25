import { promises as dns } from "node:dns";

/* ========================================
   VERIFY DNS TXT RECORD
======================================== */

export async function verifyDnsTxtRecord(
  domain: string,
  expectedToken: string
): Promise<boolean> {
  try {
    const records =
      await dns.resolveTxt(
        `_ai-visibility-verify.${domain}`
      );

    return records.some(
      (recordChunks) =>
        recordChunks
          .join("")
          .trim() ===
        expectedToken
    );
  } catch {
    return false;
  }
}

/* ========================================
   VERIFY FILE UPLOAD
======================================== */

export async function verifyFileUpload(
  domain: string,
  expectedToken: string
): Promise<boolean> {
  try {
    const response =
      await fetch(
        `https://${domain}/.well-known/ai-visibility-verify.txt`
      );

    if (!response.ok) {
      return false;
    }

    const body =
      await response.text();

    return (
      body.trim() === expectedToken
    );
  } catch {
    return false;
  }
}
