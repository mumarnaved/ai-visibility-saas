/* ========================================
   AUTH TYPES
======================================== */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
}

export interface AuthTenant {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  schemaName: string;
  status: string;
  plan: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface AuthSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
}

export interface AuthData {
  user: AuthUser;
  tenant: AuthTenant;
  workspace: AuthWorkspace;
  session: AuthSession;
}

/* ========================================
   STORAGE KEYS
======================================== */

const AUTH_STORAGE_KEY =
  "ai_visibility_auth";

/* ========================================
   SAVE AUTH
======================================== */

export function saveAuth(
  auth: AuthData
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify(auth)
  );
}

/* ========================================
   GET AUTH
======================================== */

export function getAuth(): AuthData | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw =
      window.localStorage.getItem(
        AUTH_STORAGE_KEY
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw) as AuthData;

    if (
      !parsed ||
      !parsed.user ||
      !parsed.tenant ||
      !parsed.workspace ||
      !parsed.session
    ) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(
      "Failed to read authentication:",
      error
    );

    return null;
  }
}

/* ========================================
   GET SESSION TOKEN
======================================== */

export function getSessionToken(): string | null {
  const auth = getAuth();

  if (!auth?.session?.sessionToken) {
    return null;
  }

  return auth.session.sessionToken;
}

/* ========================================
   GET CURRENT USER
======================================== */

export function getCurrentUser(): AuthUser | null {
  const auth = getAuth();

  return auth?.user ?? null;
}

/* ========================================
   GET CURRENT TENANT
======================================== */

export function getCurrentTenant(): AuthTenant | null {
  const auth = getAuth();

  return auth?.tenant ?? null;
}

/* ========================================
   AUTHENTICATED FETCH
======================================== */

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token =
    getSessionToken();

  const headers =
    new Headers(
      init.headers
    );

  if (token) {
    headers.set(
      "Authorization",
      `Bearer ${token}`
    );
  }

  if (
    init.body &&
    !headers.has("Content-Type")
  ) {
    headers.set(
      "Content-Type",
      "application/json"
    );
  }

  return fetch(
    input,
    {
      ...init,
      headers,
    }
  );
}

/* ========================================
   LOGOUT
======================================== */

export async function logout(): Promise<boolean> {
  const token =
    getSessionToken();

  try {
    if (token) {
      await fetch(
        "http://localhost:4000/api/auth/logout",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        }
      );
    }
  } catch (error) {
    console.error(
      "Logout request failed:",
      error
    );
  } finally {
    clearAuth();
  }

  return true;
}

/* ========================================
   CLEAR AUTH
======================================== */

export function clearAuth(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(
    AUTH_STORAGE_KEY
  );
}

/* ========================================
   IS AUTHENTICATED
======================================== */

export function isAuthenticated(): boolean {
  return getSessionToken() !== null;
}