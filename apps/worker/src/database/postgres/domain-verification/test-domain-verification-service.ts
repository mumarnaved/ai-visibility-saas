import {
  verifyDnsTxtRecord,
  verifyFileUpload,
} from "./domain-verification-service.js";

try {
  const dnsResult =
    await verifyDnsTxtRecord(
      "example.com",
      "some-token-that-does-not-exist"
    );

  if (dnsResult !== false) {
    throw new Error(
      "Expected DNS verification against a domain with no matching TXT record to return false."
    );
  }

  console.log(
    "DNS verification (expected rejection): OK"
  );

  const fileResult =
    await verifyFileUpload(
      "example.com",
      "some-token-that-does-not-exist"
    );

  if (fileResult !== false) {
    throw new Error(
      "Expected file verification against a domain with no matching file to return false."
    );
  }

  console.log(
    "File verification (expected rejection): OK"
  );

  const unreachableResult =
    await verifyDnsTxtRecord(
      "this-domain-definitely-does-not-exist-12345.invalid",
      "any-token"
    );

  if (unreachableResult !== false) {
    throw new Error(
      "Expected DNS verification against an unresolvable domain to return false, not throw."
    );
  }

  console.log(
    "DNS verification against unresolvable domain: OK"
  );

  console.log(
    "Domain verification service test: OK"
  );
} catch (error) {
  console.error(
    "Domain verification service test: FAILED"
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}
