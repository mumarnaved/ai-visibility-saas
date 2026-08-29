/* ========================================
   OPENROUTER PROVIDER
======================================== */

export interface OpenRouterAIResponse {
  provider: string;
  model: string;
  response: string;
}

/* ========================================
   CONFIGURATION
======================================== */

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/*
 * Do NOT use the previously rate-limited/
 * deprecated free slugs below - OpenRouter
 * has removed or paywalled them:
 *
 * openai/gpt-oss-20b:free
 * nvidia/nemotron-3-nano-30b-a3b:free
 *
 * Use a different free model instead. Check
 * https://openrouter.ai/api/v1/models for
 * currently free (":free" suffix) slugs
 * before swapping this again.
 */

const OPENROUTER_MODEL =
  "nvidia/nemotron-3-super-120b-a12b:free";

/* ========================================
   RUN OPENROUTER
======================================== */

const DEFAULT_SYSTEM_PROMPT =
  "You are a general-purpose AI assistant being evaluated by an AI visibility platform. Answer the user's question naturally, accurately, and directly. Do not intentionally mention or avoid any brand. Do not classify or moderate the user's request. Provide a normal helpful answer.";

export async function runOpenRouter(
  query: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  maxTokens: number = 1000,
  jsonMode: boolean = false
): Promise<OpenRouterAIResponse> {
  const apiKey =
    process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured."
    );
  }

  if (!query || !query.trim()) {
    throw new Error(
      "OpenRouter query is required."
    );
  }

  const response = await fetch(
    OPENROUTER_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,

        /*
         * OpenRouter recommends these headers
         * for application identification.
         */
        "HTTP-Referer":
          process.env.WEB_APP_URL ??
          "http://localhost:3000",

        "X-Title":
          "AI Visibility SaaS",
      },

      body: JSON.stringify({
        model: OPENROUTER_MODEL,

        messages: [
          {
            role: "system",

            content: systemPrompt,
          },

          {
            role: "user",

            content: query.trim(),
          },
        ],

        temperature: 0.2,

        max_tokens: maxTokens,

        /*
         * This model is a reasoning model
         * that otherwise spends its whole
         * max_tokens budget on hidden
         * chain-of-thought before ever
         * producing the requested answer.
         * Disabling reasoning makes it
         * answer directly.
         */
        reasoning: { enabled: false },

        ...(jsonMode
          ? {
              response_format: {
                type: "json_object",
              },
            }
          : {}),
      }),
    }
  );

  /* ========================================
     HANDLE HTTP ERRORS
  ======================================== */

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `OpenRouter request failed (${response.status}): ${errorText}`
    );
  }

  /* ========================================
     PARSE RESPONSE
  ======================================== */

  const data =
    (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

  const content =
    data.choices?.[0]?.message?.content;

  if (
    typeof content !== "string" ||
    !content.trim()
  ) {
    throw new Error(
      "OpenRouter returned an empty response."
    );
  }

  /* ========================================
     RETURN NORMALIZED RESPONSE
  ======================================== */

  return {
    provider: "openrouter",

    model: OPENROUTER_MODEL,

    response: content.trim(),
  };
}