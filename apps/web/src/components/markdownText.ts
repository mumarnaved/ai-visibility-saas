/* ========================================
   STRIP MARKDOWN FOR PLAIN-TEXT PREVIEWS

   Removes heading markers, table pipes, list
   bullets, emphasis characters, and link
   syntax so a truncated preview reads as
   clean text instead of raw "#"/"|" symbols.
   The full (expanded) view still renders real
   markdown via <Markdown />.
======================================== */

export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^-{3,}\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function truncatePreview(
  content: string,
  maxChars: number
): { preview: string; truncated: boolean } {
  const plain = stripMarkdown(content);

  if (plain.length <= maxChars) {
    return { preview: plain, truncated: false };
  }

  const sliced = plain
    .slice(0, maxChars)
    .replace(/\s+\S*$/, "");

  return {
    preview: `${sliced || plain.slice(0, maxChars)}…`,
    truncated: true,
  };
}
