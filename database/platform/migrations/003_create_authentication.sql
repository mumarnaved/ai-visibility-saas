CREATE SCHEMA IF NOT EXISTS platform;

-- ========================================
-- PLATFORM USERS
-- ========================================

CREATE TABLE IF NOT EXISTS platform.users (
    id UUID PRIMARY KEY,

    email TEXT NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    full_name TEXT,

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (
            status IN (
                'active',
                'suspended'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_users_email
    ON platform.users(email);

CREATE INDEX IF NOT EXISTS idx_platform_users_status
    ON platform.users(status);


-- ========================================
-- PLATFORM WORKSPACES
-- ========================================

CREATE TABLE IF NOT EXISTS platform.workspaces (
    id UUID PRIMARY KEY,

    name TEXT NOT NULL,

    slug TEXT NOT NULL UNIQUE,

    tenant_id UUID NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_workspace_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES platform.tenants(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_workspaces_tenant_id
    ON platform.workspaces(tenant_id);


-- ========================================
-- WORKSPACE MEMBERS
-- ========================================

CREATE TABLE IF NOT EXISTS platform.workspace_members (
    id UUID PRIMARY KEY,

    workspace_id UUID NOT NULL,

    user_id UUID NOT NULL,

    role TEXT NOT NULL DEFAULT 'owner'
        CHECK (
            role IN (
                'owner',
                'admin',
                'member'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_workspace_member_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_workspace_member_user
        FOREIGN KEY (user_id)
        REFERENCES platform.users(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_workspace_user
        UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id
    ON platform.workspace_members(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
    ON platform.workspace_members(user_id);


-- ========================================
-- AUTH SESSION TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS platform.sessions (
    id UUID PRIMARY KEY,

    user_id UUID NOT NULL,

    session_token_hash TEXT NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_session_user
        FOREIGN KEY (user_id)
        REFERENCES platform.users(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_user_id
    ON platform.sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_expires_at
    ON platform.sessions(expires_at);