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
 *
 * The fallback is deliberately hosted by a
 * different provider (Google AI Studio, not
 * Nvidia) - free-tier backends fail together
 * when the underlying inference provider has
 * an outage, so a same-vendor fallback would
 * often be down for the same reason as the
 * primary at the same time.
 */

const OPENROUTER_MODEL =
  "nvidia/nemotron-3-super-120b-a12b:free";

const OPENROUTER_FALLBACK_MODEL =
  "google/gemma-4-31b-it:free";

const MODELS_IN_ORDER = [
  OPENROUTER_MODEL,
  OPENROUTER_FALLBACK_MODEL,
];

/*
 * Free-tier backends are flaky under load
 * (observed: intermittent 502s and, more
 * confusingly, HTTP 200 responses with an
 * empty choices[0].message.content) rather
 * than reliably broken - a short retry with
 * backoff clears most of these without the
 * caller ever noticing. 3 attempts per model
 * x 2 models = up to 6 tries before this
 * genuinely gives up.
 */

const MAX_ATTEMPTS_PER_MODEL = 3;

const RETRY_BASE_DELAY_MS = 500;

/* ========================================
   RETRYABLE ERROR

   Distinguishes "this specific call failed
   in a way another attempt might fix" (rate
   limit, upstream overload, empty content)
   from "this will fail identically every
   time" (bad request, auth) - the latter
   skips straight to the next model instead
   of burning retry attempts on it.
======================================== */

class OpenRouterCallError extends Error {
  retryable: boolean;

  constructor(
    message: string,
    retryable: boolean
  ) {
    super(message);

    this.name =
      "OpenRouterCallError";

    this.retryable = retryable;
  }
}

function isRetryableStatus(
  status: number
): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function sleep(
  ms: number
): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

/* ========================================
   RUN OPENROUTER
======================================== */

const DEFAULT_SYSTEM_PROMPT =
  "You are a general-purpose AI assistant being evaluated by an AI visibility platform. Answer the user's question naturally, accurately, and directly. Do not intentionally mention or avoid any brand. Do not classify or moderate the user's request. Provide a normal helpful answer.";

async function callModelOnce(
  model: string,
  apiKey: string,
  systemPrompt: string,
  query: string,
  maxTokens: number,
  jsonMode: boolean
): Promise<string> {
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
        model,

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
         * Reasoning models otherwise spend
         * their whole max_tokens budget on
         * hidden chain-of-thought before ever
         * producing the requested answer.
         * Disabling reasoning makes them
         * answer directly - harmless to send
         * to non-reasoning models too.
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

    /*
     * 401/403 mean the key itself is bad -
     * every attempt (this model, the
     * fallback model, retried or not) would
     * fail identically, so there's no point
     * retrying or falling back.
     */
    const retryable =
      response.status !== 401 &&
      response.status !== 403 &&
      isRetryableStatus(
        response.status
      );

    throw new OpenRouterCallError(
      `OpenRouter request failed for ${model} (${response.status}): ${errorText}`,
      retryable
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
    throw new OpenRouterCallError(
      `OpenRouter returned an empty response for ${model}.`,
      true
    );
  }

  return content.trim();
}

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

  const attemptErrors: string[] = [];

  for (
    const model
    of MODELS_IN_ORDER
  ) {
    for (
      let attempt = 1;
      attempt <=
      MAX_ATTEMPTS_PER_MODEL;
      attempt++
    ) {
      try {
        const content =
          await callModelOnce(
            model,
            apiKey,
            systemPrompt,
            query,
            maxTokens,
            jsonMode
          );

        return {
          provider: "openrouter",
          model,
          response: content,
        };
      } catch (error) {
        const isRetryable =
          error instanceof
            OpenRouterCallError &&
          error.retryable;

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        attemptErrors.push(
          `[${model} attempt ${attempt}/${MAX_ATTEMPTS_PER_MODEL}] ${message}`
        );

        if (!isRetryable) {
          /*
           * A non-retryable failure (bad
           * key, malformed request) is
           * identical on every future
           * attempt for THIS model, but a
           * different model could still
           * behave differently (e.g. one
           * model rejects a param the other
           * accepts) - break out of the
           * retry loop and move on to the
           * next model rather than
           * aborting entirely.
           */
          break;
        }

        const isLastAttemptForModel =
          attempt ===
          MAX_ATTEMPTS_PER_MODEL;

        if (!isLastAttemptForModel) {
          await sleep(
            RETRY_BASE_DELAY_MS *
              attempt
          );
        }
      }
    }
  }

  throw new Error(
    `OpenRouter failed across all models and retries:\n${attemptErrors.join(
      "\n"
    )}`
  );
}
