import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  join,
  resolve,
  sep,
} from "node:path";

/* ========================================
   STORAGE ADAPTER
======================================== */

export interface StorageAdapter {
  write(
    key: string,
    content: Buffer | string
  ): Promise<void>;

  read(
    key: string
  ): Promise<Buffer>;

  delete(
    key: string
  ): Promise<void>;

  list(
    prefix: string
  ): Promise<string[]>;
}

/* ========================================
   LOCAL FILESYSTEM STORAGE ADAPTER
======================================== */

export class LocalFilesystemStorageAdapter
  implements StorageAdapter
{
  private readonly root: string;

  constructor(
    root: string =
      process.env.STORAGE_ROOT ??
      "./storage"
  ) {
    this.root = resolve(root);
  }

  /* ======================================
     RESOLVE KEY

     Rejects any key that would escape the
     storage root once resolved, so a
     caller can never read, write, or
     delete outside its own prefix.
  ====================================== */

  private resolveKey(
    key: string
  ): string {
    if (key.includes("..")) {
      throw new Error(
        "Storage key must not contain \"..\"."
      );
    }

    const resolvedPath =
      resolve(
        this.root,
        key
      );

    if (
      resolvedPath !== this.root &&
      !resolvedPath.startsWith(
        this.root + sep
      )
    ) {
      throw new Error(
        "Storage key resolves outside the storage root."
      );
    }

    return resolvedPath;
  }

  /* ======================================
     WRITE
  ====================================== */

  async write(
    key: string,
    content: Buffer | string
  ): Promise<void> {
    const filePath =
      this.resolveKey(key);

    await mkdir(
      dirname(filePath),
      { recursive: true }
    );

    await writeFile(
      filePath,
      content
    );
  }

  /* ======================================
     READ
  ====================================== */

  async read(
    key: string
  ): Promise<Buffer> {
    const filePath =
      this.resolveKey(key);

    return readFile(filePath);
  }

  /* ======================================
     DELETE
  ====================================== */

  async delete(
    key: string
  ): Promise<void> {
    const filePath =
      this.resolveKey(key);

    await rm(filePath, {
      force: true,
    });
  }

  /* ======================================
     LIST

     Returns every file key nested under
     the given prefix, relative to the
     storage root.
  ====================================== */

  async list(
    prefix: string
  ): Promise<string[]> {
    const dirPath =
      this.resolveKey(prefix);

    const keys: string[] = [];

    async function walk(
      currentPath: string,
      relativePath: string
    ): Promise<void> {
      let entries;

      try {
        entries =
          await readdir(
            currentPath,
            {
              withFileTypes: true,
            }
          );
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException)
            .code === "ENOENT"
        ) {
          return;
        }

        throw error;
      }

      for (const entry of entries) {
        const entryRelativePath =
          relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;

        if (entry.isDirectory()) {
          await walk(
            join(
              currentPath,
              entry.name
            ),
            entryRelativePath
          );
        } else {
          keys.push(
            entryRelativePath
          );
        }
      }
    }

    await walk(dirPath, prefix);

    return keys;
  }
}

/* ========================================
   SINGLETON
======================================== */

export const storageService: StorageAdapter =
  new LocalFilesystemStorageAdapter();
