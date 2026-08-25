import { truncatePreview } from "./markdownText";

export default function MarkdownPreview({
  content,
  maxChars = 150,
  className = "",
}: {
  content: string;
  maxChars?: number;
  className?: string;
}) {
  if (!content) {
    return null;
  }

  const { preview } = truncatePreview(content, maxChars);

  return (
    <p
      className={`whitespace-pre-wrap text-sm leading-6 text-ink-secondary ${className}`}
    >
      {preview}
    </p>
  );
}
