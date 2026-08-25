import {
  createHash,
  randomUUID,
} from "node:crypto";

import { pool } from "../database/postgres/connection.js";

/* ========================================
   AUTHENTICATED USER
======================================== */

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
}

/* ========================================
   AUTH SESSION
======================================== */

export interface AuthSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
}

/* ========================================
   SESSION RECORD
======================================== */

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

/* ========================================
   SESSION CONFIG
======================================== */

const SESSION_DURATION_DAYS = 30;

/* ========================================
   HASH SESSION TOKEN
======================================== */

function hashSessionToken(
  sessionToken: string
): string {
  return createHash("sha256")
    .update(sessionToken)
    .digest("hex");
}

/* ========================================
   CREATE SESSION EXPIRATION
======================================== */

function createExpirationDate(): Date {
  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() +
      SESSION_DURATION_DAYS
  );

  return expiresAt;
}

/* ========================================
   CREATE SESSION
======================================== */

export async function createSession(
  userId: string
): Promise<AuthSession> {
  const sessionId =
    randomUUID();

  const sessionToken =
    `${randomUUID()}${randomUUID()}`;

  const sessionTokenHash =
    hashSessionToken(
      sessionToken
    );

  const expiresAt =
    createExpirationDate();

  await pool.query(
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
        $4
      )
    `,
    [
      sessionId,
      userId,
      sessionTokenHash,
      expiresAt,
    ]
  );

  return {
    sessionId,
    sessionToken,
    expiresAt,
  };
}

/* ========================================
   GET SESSION
======================================== */

export async function getSession(
  sessionToken: string
): Promise<SessionRecord | null> {
  const token =
    sessionToken.trim();

  if (!token) {
    return null;
  }

  const sessionTokenHash =
    hashSessionToken(token);

  const result =
    await pool.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      created_at: Date;
    }>(
      `
        SELECT
          id,
          user_id,
          expires_at,
          created_at
        FROM platform.sessions
        WHERE session_token_hash = $1
        LIMIT 1
      `,
      [sessionTokenHash]
    );

  const row =
    result.rows[0];

  if (!row) {
    return null;
  }

  const expiresAt =
    new Date(row.expires_at);

  if (
    expiresAt.getTime() <=
    Date.now()
  ) {
    await deleteSession(token);

    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    expiresAt,
    createdAt:
      new Date(row.created_at),
  };
}

/* ========================================
   GET AUTHENTICATED USER
======================================== */

export async function getAuthenticatedUser(
  sessionToken: string
): Promise<AuthenticatedUser | null> {
  const session =
    await getSession(
      sessionToken
    );

  if (!session) {
    return null;
  }

  const result =
    await pool.query<{
      id: string;
      email: string;
      full_name: string | null;
      status: string;
    }>(
      `
        SELECT
          id,
          email,
          full_name,
          status
        FROM platform.users
        WHERE id = $1
        LIMIT 1
      `,
      [session.userId]
    );

  const user =
    result.rows[0];

  if (!user) {
    return null;
  }

  if (
    user.status !== "active"
  ) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    fullName:
      user.full_name,
    status: user.status,
  };
}

/* ========================================
   DELETE SESSION
======================================== */

export async function deleteSession(
  sessionToken: string
): Promise<void> {
  const token =
    sessionToken.trim();

  if (!token) {
    return;
  }

  const sessionTokenHash =
    hashSessionToken(token);

  await pool.query(
    `
      DELETE FROM platform.sessions
      WHERE session_token_hash = $1
    `,
    [sessionTokenHash]
  );
}

/* ========================================
   DELETE ALL USER SESSIONS
======================================== */

export async function deleteAllUserSessions(
  userId: string
): Promise<void> {
  await pool.query(
    `
      DELETE FROM platform.sessions
      WHERE user_id = $1
    `,
    [userId]
  );
}

/* ========================================
   CLEAN EXPIRED SESSIONS
======================================== */

export async function cleanExpiredSessions(): Promise<void> {
  await pool.query(
    `
      DELETE FROM platform.sessions
      WHERE expires_at <= NOW()
    `
  );
}