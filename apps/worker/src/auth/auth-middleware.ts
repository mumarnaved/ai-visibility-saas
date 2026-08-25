import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  getAuthenticatedUser,
  getSession,
  type AuthenticatedUser,
  type SessionRecord,
} from "./session.js";

/* ========================================
   AUTHENTICATED REQUEST
======================================== */

export interface AuthenticatedRequest
  extends Request {
  auth?: {
    user: AuthenticatedUser;
    session: SessionRecord;
  };
}

/* ========================================
   GET SESSION TOKEN
======================================== */

function getSessionToken(
  req: Request
): string | null {
  const authorization =
    req.headers.authorization;

  if (
    typeof authorization === "string" &&
    authorization.trim()
  ) {
    const parts =
      authorization.trim().split(/\s+/);

    if (
      parts.length === 2 &&
      parts[0]?.toLowerCase() ===
        "bearer"
    ) {
      const token =
        parts[1]?.trim();

      if (token) {
        return token;
      }
    }
  }

  const headerToken =
    req.headers["x-session-token"];

  if (
    typeof headerToken === "string" &&
    headerToken.trim()
  ) {
    return headerToken.trim();
  }

  return null;
}

/* ========================================
   REQUIRE AUTHENTICATION
======================================== */

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionToken =
      getSessionToken(req);

    if (!sessionToken) {
      res.status(401).json({
        success: false,
        error:
          "Authentication required.",
      });

      return;
    }

    const session =
      await getSession(
        sessionToken
      );

    if (!session) {
      res.status(401).json({
        success: false,
        error:
          "Invalid or expired session.",
      });

      return;
    }

    const user =
      await getAuthenticatedUser(
        sessionToken
      );

    if (!user) {
      res.status(401).json({
        success: false,
        error:
          "Authenticated user could not be found.",
      });

      return;
    }

    req.auth = {
      user,
      session,
    };

    next();
  } catch (error) {
    console.error(
      "Authentication middleware failed:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Authentication failed.",
    });
  }
}