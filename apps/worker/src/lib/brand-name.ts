/* ========================================
   GET BRAND NAME FROM WEBSITE

   Shared by the manual tenant-creation route
   and the automatic post-verification scan -
   both need a brand name when the caller
   doesn't supply one.
======================================== */

export function getBrandNameFromWebsite(
  websiteUrl: string
): string {
  try {
    const parsedUrl = new URL(
      websiteUrl
    );

    const hostname =
      parsedUrl.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    const parts =
      hostname.split(".");

    if (
      parts.length === 0
    ) {
      return "";
    }

    return parts[0]
      .replace(
        /[-_]+/g,
        " "
      )
      .trim();
  } catch {
    return "";
  }
}
