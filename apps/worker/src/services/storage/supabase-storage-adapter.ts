import type { StorageAdapter } from "./storage-service.js";

/* ========================================
   SUPABASE STORAGE ADAPTER

   Talks to the Supabase Storage REST API with
   the service-role key, against one private
   bucket. Keys are the same "tenant-<id>/..."
   strings the local adapter uses, so the two
   are interchangeable. fetch is injectable for
   tests. Nothing here logs request headers or
   the key.
======================================== */

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface SupabaseStorageOptions {
  url: string;
  serviceRoleKey: string;
  bucket?: string;
  fetch?: FetchLike;
}

export const DEFAULT_SUPABASE_BUCKET = "tenant-storage";

const LIST_PAGE_SIZE = 100;

/* ========================================
   KEY GUARD

   Same rule as the local adapter's resolveKey:
   a key can never contain "..", so it cannot
   climb out of its own prefix. Absolute,
   backslash and empty-segment keys are also
   refused, since they have no meaning in a
   bucket.
======================================== */

export function assertSafeStorageKey(
  key: string
): string {
  if (key.includes("..")) {
    throw new Error(
      "Storage key must not contain \"..\"."
    );
  }

  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key
      .split("/")
      .some(
        (segment) =>
          segment === "" || segment === "."
      )
  ) {
    throw new Error(
      "Storage key is not a valid relative path."
    );
  }

  return key;
}

/* A prefix is a key that may end with "/". */
function normalizePrefix(prefix: string): string {
  return assertSafeStorageKey(
    prefix.replace(/\/+$/, "")
  );
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

export class StorageNotFoundError extends Error {
  code = "ENOENT";

  constructor(key: string) {
    super(`Storage object not found: ${key}`);
  }
}

export class SupabaseStorageAdapter
  implements StorageAdapter
{
  private readonly base: string;
  private readonly bucket: string;
  private readonly serviceRoleKey: string;
  private readonly doFetch: FetchLike;

  constructor(options: SupabaseStorageOptions) {
    if (!options.url || !options.serviceRoleKey) {
      throw new Error(
        "SupabaseStorageAdapter needs a url and a service role key."
      );
    }

    this.base = `${options.url.replace(/\/+$/, "")}/storage/v1`;
    this.bucket =
      options.bucket || DEFAULT_SUPABASE_BUCKET;
    this.serviceRoleKey = options.serviceRoleKey;
    this.doFetch =
      options.fetch ??
      ((input, init) => fetch(input, init));
  }

  private request(
    path: string,
    init: RequestInit & {
      headers?: Record<string, string>;
    } = {}
  ): Promise<Response> {
    return this.doFetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        ...init.headers,
      },
    });
  }

  private async failure(
    action: string,
    response: Response
  ): Promise<Error> {
    let detail = "";

    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      /* no body */
    }

    return new Error(
      `Supabase storage ${action} failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
  }

  /* Supabase reports a missing object as 404, or as 400 with statusCode "404". */
  private async isNotFound(
    response: Response
  ): Promise<boolean> {
    if (response.status === 404) {
      return true;
    }

    if (response.status !== 400) {
      return false;
    }

    try {
      const body = (await response
        .clone()
        .json()) as { statusCode?: string | number };

      return String(body.statusCode) === "404";
    } catch {
      return false;
    }
  }

  async write(
    key: string,
    content: Buffer | string
  ): Promise<void> {
    assertSafeStorageKey(key);

    const response = await this.request(
      `/object/${this.bucket}/${encodePath(key)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-upsert": "true",
        },
        body: new Uint8Array(
          typeof content === "string"
            ? Buffer.from(content, "utf8")
            : content
        ),
      }
    );

    if (!response.ok) {
      throw await this.failure("write", response);
    }
  }

  async read(key: string): Promise<Buffer> {
    assertSafeStorageKey(key);

    const response = await this.request(
      `/object/${this.bucket}/${encodePath(key)}`
    );

    if (!response.ok) {
      if (await this.isNotFound(response)) {
        throw new StorageNotFoundError(key);
      }

      throw await this.failure("read", response);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /* Like rm({ force: true }): deleting a missing object is not an error. */
  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);

    const response = await this.request(
      `/object/${this.bucket}/${encodePath(key)}`,
      { method: "DELETE" }
    );

    if (
      !response.ok &&
      !(await this.isNotFound(response))
    ) {
      throw await this.failure("delete", response);
    }
  }

  /* Every file key under the prefix, as bucket-relative keys. */
  async list(prefix: string): Promise<string[]> {
    const root = normalizePrefix(prefix);
    const keys: string[] = [];

    const walk = async (
      folder: string
    ): Promise<void> => {
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const response = await this.request(
          `/object/list/${this.bucket}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prefix: folder,
              limit: LIST_PAGE_SIZE,
              offset,
              sortBy: { column: "name", order: "asc" },
            }),
          }
        );

        if (!response.ok) {
          throw await this.failure("list", response);
        }

        const entries = (await response.json()) as {
          name: string;
          id: string | null;
        }[];

        for (const entry of entries) {
          const path = `${folder}/${entry.name}`;

          /* Folders come back without an id. */
          if (entry.id === null) {
            await walk(path);
          } else {
            keys.push(path);
          }
        }

        if (entries.length < LIST_PAGE_SIZE) {
          return;
        }
      }
    };

    await walk(root);

    return keys;
  }
}
