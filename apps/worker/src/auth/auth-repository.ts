import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { pool } from "../database/postgres/connection.js";

/* ========================================
   TYPES
======================================== */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  slug: string;
  tenantId: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface AuthUserWithWorkspace {
  user: AuthUser;
  workspace: AuthWorkspace | null;
}

/* ========================================
   PASSWORD CONFIGURATION
======================================== */

const PASSWORD_SALT_BYTES = 16;

const PASSWORD_ITERATIONS = 100_000;

const PASSWORD_KEY_LENGTH = 64;

const PASSWORD_DIGEST = "sha512";

/* ========================================
   PASSWORD HASHING
======================================== */

function hashPassword(
  password: string
): string {
  const salt = randomBytes(
    PASSWORD_SALT_BYTES
  );

  const derivedKey = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    PASSWORD_DIGEST
  );

  return [
    "pbkdf2",
    PASSWORD_DIGEST,
    PASSWORD_ITERATIONS,
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join("$");
}

/* ========================================
   PASSWORD VERIFICATION
======================================== */

function verifyPassword(
  password: string,
  storedHash: string
): boolean {
  const parts =
    storedHash.split("$");

  if (parts.length !== 5) {
    return false;
  }

  const [
    algorithm,
    digest,
    iterationsString,
    saltHex,
    hashHex,
  ] = parts;

  if (algorithm !== "pbkdf2") {
    return false;
  }

  const iterations =
    Number(iterationsString);

  if (
    !Number.isInteger(iterations) ||
    iterations <= 0
  ) {
    return false;
  }

  if (
    digest !== "sha512"
  ) {
    return false;
  }

  const salt =
    Buffer.from(
      saltHex,
      "hex"
    );

  const expectedHash =
    Buffer.from(
      hashHex,
      "hex"
    );

  if (
    salt.length === 0 ||
    expectedHash.length === 0
  ) {
    return false;
  }

  const actualHash =
    pbkdf2Sync(
      password,
      salt,
      iterations,
      expectedHash.length,
      digest
    );

  if (
    actualHash.length !==
    expectedHash.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualHash,
    expectedHash
  );
}

/* ========================================
   SESSION TOKEN
======================================== */

function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function hashSessionToken(
  token: string
): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

/* ========================================
   CREATE USER
======================================== */

export async function createUser(
  email: string,
  password: string,
  fullName?: string
): Promise<AuthUser> {
  const id = randomUUID();

  const passwordHash =
    hashPassword(password);

  const result =
    await pool.query<AuthUser>(
      `
        INSERT INTO platform.users (
          id,
          email,
          password_hash,
          full_name
        )
        VALUES (
          $1,
          $2,
          $3,
          $4
        )
        RETURNING
          id,
          email,
          full_name AS "fullName",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_login_at AS "lastLoginAt"
      `,
      [
        id,
        email,
        passwordHash,
        fullName ?? null,
      ]
    );

  const user =
    result.rows[0];

  if (!user) {
    throw new Error(
      "User was not created."
    );
  }

  return user;
}

/* ========================================
   FIND USER BY EMAIL
======================================== */

export async function findUserByEmail(
  email: string
): Promise<{
  id: string;
  email: string;
  passwordHash: string;
  fullName: string | null;
  status: "active" | "suspended";
} | null> {
  const result =
    await pool.query<{
      id: string;
      email: string;
      passwordHash: string;
      fullName: string | null;
      status: "active" | "suspended";
    }>(
      `
        SELECT
          id,
          email,
          password_hash AS "passwordHash",
          full_name AS "fullName",
          status
        FROM platform.users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

  return result.rows[0] ?? null;
}

/* ========================================
   AUTHENTICATE USER
======================================== */

export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthUser | null> {
  const user =
    await findUserByEmail(email);

  if (!user) {
    return null;
  }

  if (
    user.status !== "active"
  ) {
    return null;
  }

  const passwordValid =
    verifyPassword(
      password,
      user.passwordHash
    );

  if (!passwordValid) {
    return null;
  }

  const result =
    await pool.query<AuthUser>(
      `
        UPDATE platform.users
        SET
          last_login_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          email,
          full_name AS "fullName",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_login_at AS "lastLoginAt"
      `,
      [user.id]
    );

  return result.rows[0] ?? null;
}

/* ========================================
   CREATE SESSION
======================================== */

export async function createSession(
  userId: string,
  expiresInDays = 7
): Promise<{
  session: AuthSession;
  token: string;
}> {
  const id = randomUUID();

  const token =
    createSessionToken();

  const tokenHash =
    hashSessionToken(token);

  const result =
    await pool.query<AuthSession>(
      `
        INSERT INTO platform.sessions (
          id,
          user_id,
          session_token_hash,
          expires_at
        )
        VALUES (
          $1,
          $2,
          $3,
          NOW() + ($4 * INTERVAL '1 day')
        )
        RETURNING
          id,
          user_id AS "userId",
          expires_at AS "expiresAt"
      `,
      [
        id,
        userId,
        tokenHash,
        expiresInDays,
      ]
    );

  const session =
    result.rows[0];

  if (!session) {
    throw new Error(
      "Session was not created."
    );
  }

  return {
    session,
    token,
  };
}

/* ========================================
   GET USER BY SESSION TOKEN
======================================== */

export async function getUserBySessionToken(
  token: string
): Promise<AuthUserWithWorkspace | null> {
  const tokenHash =
    hashSessionToken(token);

  const result =
    await pool.query<{
      userId: string;
      email: string;
      fullName: string | null;
      status: "active" | "suspended";
      createdAt: string;
      updatedAt: string;
      lastLoginAt: string | null;
      workspaceId: string | null;
      workspaceName: string | null;
      workspaceSlug: string | null;
      tenantId: string | null;
    }>(
      `
        SELECT
          u.id AS "userId",
          u.email,
          u.full_name AS "fullName",
          u.status,
          u.created_at AS "createdAt",
          u.updated_at AS "updatedAt",
          u.last_login_at AS "lastLoginAt",

          w.id AS "workspaceId",
          w.name AS "workspaceName",
          w.slug AS "workspaceSlug",
          w.tenant_id AS "tenantId"

        FROM platform.sessions s

        INNER JOIN platform.users u
          ON u.id = s.user_id

        LEFT JOIN platform.workspace_members wm
          ON wm.user_id = u.id

        LEFT JOIN platform.workspaces w
          ON w.id = wm.workspace_id

        WHERE
          s.session_token_hash = $1
          AND s.expires_at > NOW()

        ORDER BY
          wm.created_at ASC

        LIMIT 1
      `,
      [tokenHash]
    );

  const row =
    result.rows[0];

  if (!row) {
    return null;
  }

  if (
    row.status !== "active"
  ) {
    return null;
  }

  return {
    user: {
      id: row.userId,
      email: row.email,
      fullName: row.fullName,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastLoginAt: row.lastLoginAt,
    },

    workspace:
      row.workspaceId &&
      row.workspaceName &&
      row.workspaceSlug &&
      row.tenantId
        ? {
            id: row.workspaceId,
            name: row.workspaceName,
            slug: row.workspaceSlug,
            tenantId: row.tenantId,
          }
        : null,
  };
}

/* ========================================
   DELETE SESSION
======================================== */

export async function deleteSession(
  token: string
): Promise<void> {
  const tokenHash =
    hashSessionToken(token);

  await pool.query(
    `
      DELETE FROM platform.sessions
      WHERE session_token_hash = $1
    `,
    [tokenHash]
  );
}

/* ========================================
   DELETE EXPIRED SESSIONS
======================================== */

export async function deleteExpiredSessions(): Promise<void> {
  await pool.query(
    `
      DELETE FROM platform.sessions
      WHERE expires_at <= NOW()
    `
  );
}