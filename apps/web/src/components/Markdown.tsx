"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="text-sm leading-7 text-ink-secondary [&>*:first-child]:mt-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => (
            <h1
              className="mt-5 text-xl font-bold text-ink"
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="mt-5 text-lg font-bold text-ink"
              {...props}
            />
          ),
          h3: (props) => (
            <h3
              className="mt-4 text-base font-semibold text-ink"
              {...props}
            />
          ),
          h4: (props) => (
            <h4
              className="mt-4 text-sm font-semibold text-ink"
              {...props}
            />
          ),
          p: (props) => (
            <p className="mt-3 leading-7" {...props} />
          ),
          ul: (props) => (
            <ul
              className="mt-3 list-disc space-y-1 pl-5"
              {...props}
            />
          ),
          ol: (props) => (
            <ol
              className="mt-3 list-decimal space-y-1 pl-5"
              {...props}
            />
          ),
          li: (props) => (
            <li className="leading-6" {...props} />
          ),
          strong: (props) => (
            <strong
              className="font-semibold text-ink"
              {...props}
            />
          ),
          em: (props) => (
            <em className="italic" {...props} />
          ),
          a: (props) => (
            <a
              className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-ink"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 [&_code]:bg-transparent [&_code]:p-0"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="mt-3 border-l-2 border-primary/40 pl-3 italic text-ink-muted"
              {...props}
            />
          ),
          table: (props) => (
            <div className="mt-3 overflow-x-auto">
              <table
                className="w-full border-collapse text-left text-xs"
                {...props}
              />
            </div>
          ),
          thead: (props) => (
            <thead className="bg-muted" {...props} />
          ),
          th: (props) => (
            <th
              className="border border-border px-3 py-2 font-semibold text-ink"
              {...props}
            />
          ),
          td: (props) => (
            <td
              className="border border-border px-3 py-2 align-top"
              {...props}
            />
          ),
          hr: (props) => (
            <hr className="my-4 border-border" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
