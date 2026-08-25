import { randomUUID } from "node:crypto";

import { pool } from "../database/postgres/connection.js";
import { provisionTenant } from "../database/postgres/tenant-provisioning.js";

import {
  hashPassword,
  verifyPassword,
} from "./password.js";

import {
  createSession,
  deleteAllUserSessions,
  type AuthSession,
  type AuthenticatedUser,
} from "./session.js";

/* ========================================
   TYPES
======================================== */

export interface SignupRequest {
  email: string;
  password: string;
  fullName?: string;
  workspaceName: string;
  websiteUrl: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResult {
  user: AuthenticatedUser;
  tenant: {
    id: string;
    name: string;
    slug: string;
    websiteUrl: string | null;
    schemaName: string;
    status: string;
    plan: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  session: AuthSession;
}

/* ========================================
   NORMALIZE EMAIL
======================================== */

function normalizeEmail(
  email: string
): string {
  return email
    .trim()
    .toLowerCase();
}

/* ========================================
   CREATE SLUG
======================================== */

function createSlug(
  value: string
): string {
  const slug =
    value
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  return (
    slug || `workspace-${Date.now()}`
  );
}

/* ========================================
   UNIQUE TENANT SLUG
======================================== */

export async function createUniqueTenantSlug(
  baseName: string
): Promise<string> {
  const baseSlug =
    createSlug(baseName);

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const result =
      await pool.query(
        `
          SELECT id
          FROM platform.tenants
          WHERE slug = $1
          LIMIT 1
        `,
        [slug]
      );

    if (result.rows.length === 0) {
      return slug;
    }

    counter += 1;

    slug =
      `${baseSlug}-${counter}`;
  }
}

/* ========================================
   CREATE UNIQUE WORKSPACE SLUG
======================================== */

export async function createUniqueWorkspaceSlug(
  baseName: string
): Promise<string> {
  const baseSlug =
    createSlug(baseName);

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const result =
      await pool.query(
        `
          SELECT id
          FROM platform.workspaces
          WHERE slug = $1
          LIMIT 1
        `,
        [slug]
      );

    if (result.rows.length === 0) {
      return slug;
    }

    counter += 1;

    slug =
      `${baseSlug}-${counter}`;
  }
}

/* ========================================
   SIGNUP
======================================== */

export async function signup(
  request: SignupRequest
): Promise<AuthResult> {
  const email =
    normalizeEmail(
      request.email
    );

  const password =
    request.password;

  const fullName =
    request.fullName?.trim() || null;

  const workspaceName =
    request.workspaceName.trim();

  const websiteUrl =
    request.websiteUrl.trim();

  if (!email) {
    throw new Error(
      "Email is required."
    );
  }

  if (!email.includes("@")) {
    throw new Error(
      "Please provide a valid email address."
    );
  }

  if (
    !password ||
    password.length < 8
  ) {
    throw new Error(
      "Password must contain at least 8 characters."
    );
  }

  if (!workspaceName) {
    throw new Error(
      "Workspace name is required."
    );
  }

  if (!websiteUrl) {
    throw new Error(
      "Website URL is required."
    );
  }

  try {
    new URL(websiteUrl);
  } catch {
    throw new Error(
      "Website URL must be a valid URL."
    );
  }

  const existingUser =
    await pool.query(
      `
        SELECT id
        FROM platform.users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

  if (existingUser.rows.length > 0) {
    throw new Error(
      "An account with this email already exists."
    );
  }

  const passwordHash =
    await hashPassword(
      password
    );

  const userId =
    randomUUID();

  const tenantSlug =
    await createUniqueTenantSlug(
      workspaceName
    );

  let tenant:
    | Awaited<
        ReturnType<
          typeof provisionTenant
        >
      >
    | null = null;

  try {
    /* ========================================
       CREATE USER
    ======================================== */

    await pool.query(
      `
        INSERT INTO platform.users (
          id,
          email,
          password_hash,
          full_name,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'active'
        )
      `,
      [
        userId,
        email,
        passwordHash,
        fullName,
      ]
    );

    /* ========================================
       CREATE TENANT + PROVISION SCHEMA
    ======================================== */

    tenant =
      await provisionTenant({
        name: workspaceName,
        slug: tenantSlug,
        websiteUrl,
      });

    /* ========================================
       CREATE WORKSPACE
    ======================================== */

    const workspaceId =
      randomUUID();

    const workspaceSlug =
      await createUniqueWorkspaceSlug(
        workspaceName
      );

    const workspaceResult =
      await pool.query<{
        id: string;
        name: string;
        slug: string;
      }>(
        `
          INSERT INTO platform.workspaces (
            id,
            name,
            slug,
            tenant_id
          )
          VALUES (
            $1,
            $2,
            $3,
            $4
          )
          RETURNING
            id,
            name,
            slug
        `,
        [
          workspaceId,
          workspaceName,
          workspaceSlug,
          tenant.id,
        ]
      );

    const workspace =
      workspaceResult.rows[0];

    if (!workspace) {
      throw new Error(
        "Workspace could not be created."
      );
    }

    /* ========================================
       CREATE WORKSPACE MEMBERSHIP
    ======================================== */

    await pool.query(
      `
        INSERT INTO platform.workspace_members (
          id,
          workspace_id,
          user_id,
          role
        )
        VALUES (
          $1,
          $2,
          $3,
          'owner'
        )
      `,
      [
        randomUUID(),
        workspace.id,
        userId,
      ]
    );

    /* ========================================
       CREATE SESSION
    ======================================== */

    const session =
      await createSession(
        userId
      );

    /* ========================================
       UPDATE LAST LOGIN
    ======================================== */

    await pool.query(
      `
        UPDATE platform.users
        SET
          last_login_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [userId]
    );

    return {
      user: {
        id: userId,
        email,
        fullName,
        status: "active",
      },

      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        websiteUrl:
          tenant.websiteUrl,
        schemaName:
          tenant.schemaName,
        status: tenant.status,
        plan: tenant.plan,
      },

      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },

      session,
    };
  } catch (error) {
    /*
     * The tenant provisioning function already marks
     * a tenant as failed if schema provisioning fails.
     *
     * If the rest of signup fails after the tenant
     * has been created, remove the user so a failed
     * signup does not leave an orphaned platform user.
     */

    await pool.query(
      `
        DELETE FROM platform.users
        WHERE id = $1
      `,
      [userId]
    );

    throw error;
  }
}

/* ========================================
   LOGIN
======================================== */

export async function login(
  request: LoginRequest
): Promise<AuthResult> {
  const email =
    normalizeEmail(
      request.email
    );

  const password =
    request.password;

  if (!email) {
    throw new Error(
      "Email is required."
    );
  }

  if (!password) {
    throw new Error(
      "Password is required."
    );
  }

  const userResult =
    await pool.query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string | null;
      status: string;
    }>(
      `
        SELECT
          id,
          email,
          password_hash,
          full_name,
          status
        FROM platform.users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

  const user =
    userResult.rows[0];

  if (!user) {
    throw new Error(
      "Invalid email or password."
    );
  }

  if (user.status !== "active") {
    throw new Error(
      "This account is not active."
    );
  }

  const passwordValid =
    await verifyPassword(
      password,
      user.password_hash
    );

  if (!passwordValid) {
    throw new Error(
      "Invalid email or password."
    );
  }

  const workspaceResult =
    await pool.query<{
      id: string;
      name: string;
      slug: string;
      tenant_id: string;
    }>(
      `
        SELECT
          w.id,
          w.name,
          w.slug,
          w.tenant_id
        FROM platform.workspaces w
        INNER JOIN platform.workspace_members wm
          ON wm.workspace_id = w.id
        WHERE wm.user_id = $1
        ORDER BY w.created_at ASC
        LIMIT 1
      `,
      [user.id]
    );

  const workspace =
    workspaceResult.rows[0];

  if (!workspace) {
    throw new Error(
      "No workspace is associated with this account."
    );
  }

  const tenantResult =
    await pool.query<{
      id: string;
      name: string;
      slug: string;
      website_url: string | null;
      schema_name: string;
      status: string;
      plan: string;
    }>(
      `
        SELECT
          id,
          name,
          slug,
          website_url,
          schema_name,
          status,
          plan
        FROM platform.tenants
        WHERE id = $1
        LIMIT 1
      `,
      [workspace.tenant_id]
    );

  const tenant =
    tenantResult.rows[0];

  if (!tenant) {
    throw new Error(
      "Workspace tenant could not be found."
    );
  }

  if (
    tenant.status !== "active"
  ) {
    throw new Error(
      "This workspace is not active."
    );
  }

  /*
   * Remove previous sessions before creating
   * a fresh login session.
   */

  await deleteAllUserSessions(
    user.id
  );

  const session =
    await createSession(
      user.id
    );

  await pool.query(
    `
      UPDATE platform.users
      SET
        last_login_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [user.id]
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName:
        user.full_name,
      status: user.status,
    },

    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      websiteUrl:
        tenant.website_url,
      schemaName:
        tenant.schema_name,
      status: tenant.status,
      plan: tenant.plan,
    },

    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },

    session,
  };
}