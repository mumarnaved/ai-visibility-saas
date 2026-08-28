CREATE TABLE IF NOT EXISTS platform.billing_accounts (
    id UUID PRIMARY KEY,

    user_id UUID NOT NULL UNIQUE,

    plan_tier TEXT NOT NULL DEFAULT 'free'
        CHECK (plan_tier IN (
            'free',
            'growth',
            'scale',
            'enterprise',
            'white_label'
        )),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN (
            'active',
            'trialing',
            'past_due',
            'canceled',
            'incomplete'
        )),

    website_limit INTEGER NOT NULL DEFAULT 1,

    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,

    current_period_end TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_billing_account_user
        FOREIGN KEY (user_id)
        REFERENCES platform.users(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_user_id
    ON platform.billing_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_stripe_customer_id
    ON platform.billing_accounts(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_stripe_subscription_id
    ON platform.billing_accounts(stripe_subscription_id);

/*
 * Grandfather every user who already existed before
 * billing was introduced onto an unrestricted tier, so
 * none of the accumulated test tenants/workspaces lose
 * Execution/Monitoring access or hit a website-count
 * wall the moment this migration runs. New signups are
 * unaffected - they simply get no row here, which the
 * application layer treats as the free tier.
 */
INSERT INTO platform.billing_accounts (
    id,
    user_id,
    plan_tier,
    status,
    website_limit
)
SELECT
    gen_random_uuid(),
    u.id,
    'scale',
    'active',
    999999
FROM platform.users u
ON CONFLICT (user_id) DO NOTHING;
