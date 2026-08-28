/* ========================================
   GOOGLE OAUTH CLIENT

   Raw fetch calls to Google's OAuth, GA4
   Admin, and Search Console REST APIs - no
   googleapis SDK, matching the rest of this
   codebase's style (see openrouter-provider.ts).
======================================== */

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export interface GoogleTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  ga4PropertyId: string | null;
  gscSiteUrl: string | null;
  connectedAt: string;
  /*
   * Populated at connect time when GA4/GSC
   * discovery couldn't find a property/site
   * (e.g. the relevant Google API is disabled
   * in the tenant's Cloud project). The OAuth
   * connection itself still succeeds - this
   * just explains why monitoring falls back
   * to mock data despite being "connected".
   */
  discoveryIssues: string[];
}

function getEnv(
  name: string
): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} environment variable is required.`
    );
  }

  return value;
}

/* ========================================
   BUILD CONSENT URL
======================================== */

export function buildGoogleAuthUrl(
  state: string
): string {
  const params = new URLSearchParams({
    client_id: getEnv(
      "GOOGLE_CLIENT_ID"
    ),
    redirect_uri: getEnv(
      "GOOGLE_REDIRECT_URI"
    ),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: SCOPES.join(" "),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/* ========================================
   EXCHANGE CODE FOR TOKENS
======================================== */

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: getEnv(
          "GOOGLE_CLIENT_ID"
        ),
        client_secret: getEnv(
          "GOOGLE_CLIENT_SECRET"
        ),
        redirect_uri: getEnv(
          "GOOGLE_REDIRECT_URI"
        ),
        grant_type:
          "authorization_code",
      }),
    }
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Google token exchange failed (${response.status}): ${text}`
    );
  }

  const data =
    (await response.json()) as GoogleTokenResponse;

  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke this app's access at https://myaccount.google.com/permissions and reconnect so Google issues a fresh one."
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:
      Date.now() +
      data.expires_in * 1000,
  };
}

/* ========================================
   REFRESH ACCESS TOKEN
======================================== */

export async function refreshAccessToken(
  refreshToken: string
): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: getEnv(
          "GOOGLE_CLIENT_ID"
        ),
        client_secret: getEnv(
          "GOOGLE_CLIENT_SECRET"
        ),
        grant_type: "refresh_token",
      }),
    }
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Google token refresh failed (${response.status}): ${text}`
    );
  }

  const data =
    (await response.json()) as GoogleTokenResponse;

  return {
    accessToken: data.access_token,
    expiresAt:
      Date.now() +
      data.expires_in * 1000,
  };
}

/* ========================================
   DISCOVERY RESULT

   Carries the discovered id/url AND a
   human-readable reason on failure, so a
   silent `null` never hides *why* nothing
   was found (e.g. the relevant Google API
   being disabled in the tenant's Cloud
   project - the exact failure mode that
   originally went completely unlogged).
======================================== */

export interface DiscoveryResult {
  value: string | null;
  issue: string | null;
}

function describeGoogleApiError(
  status: number,
  bodyText: string
): string {
  try {
    const parsed = JSON.parse(
      bodyText
    ) as {
      error?: {
        message?: string;
        status?: string;
      };
    };

    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // bodyText wasn't JSON - fall through to the raw text below.
  }

  return `HTTP ${status}: ${bodyText.slice(
    0,
    300
  )}`;
}

/* ========================================
   DISCOVER GA4 PROPERTY

   Picks the first available GA4 property
   from the Admin API's account summaries -
   simple default; a tenant with several
   properties can only ever get the first one
   this way, which is a deliberate
   simplification (no property-picker UI).
======================================== */

export async function discoverGa4Property(
  accessToken: string
): Promise<DiscoveryResult> {
  const response = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const bodyText =
      await response.text();

    const issue = `GA4 property discovery failed: ${describeGoogleApiError(
      response.status,
      bodyText
    )}`;

    console.warn(
      `[google-oauth] ${issue}`
    );

    return { value: null, issue };
  }

  const data = (await response.json()) as {
    accountSummaries?: Array<{
      propertySummaries?: Array<{
        property?: string;
      }>;
    }>;
  };

  for (const account of data.accountSummaries ??
    []) {
    for (const property of account.propertySummaries ??
      []) {
      if (property.property) {
        /*
         * property is shaped like
         * "properties/123456789" - the Data
         * API wants just the numeric id.
         */
        return {
          value:
            property.property.replace(
              "properties/",
              ""
            ),
          issue: null,
        };
      }
    }
  }

  const issue =
    "No GA4 property found - the connected Google account has no accessible Analytics properties.";

  console.warn(
    `[google-oauth] ${issue}`
  );

  return { value: null, issue };
}

/* ========================================
   DISCOVER SEARCH CONSOLE SITE

   Prefers a verified site whose hostname
   matches the tenant's website; falls back
   to the first verified site.
======================================== */

export async function discoverSearchConsoleSite(
  accessToken: string,
  websiteUrl: string
): Promise<DiscoveryResult> {
  const response = await fetch(
    "https://www.googleapis.com/webmasters/v3/sites",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const bodyText =
      await response.text();

    const issue = `Search Console site discovery failed: ${describeGoogleApiError(
      response.status,
      bodyText
    )}`;

    console.warn(
      `[google-oauth] ${issue}`
    );

    return { value: null, issue };
  }

  const data = (await response.json()) as {
    siteEntry?: Array<{
      siteUrl: string;
      permissionLevel: string;
    }>;
  };

  const verifiedSites = (
    data.siteEntry ?? []
  ).filter(
    (site) =>
      site.permissionLevel !==
      "siteUnverifiedUser"
  );

  if (verifiedSites.length === 0) {
    const issue =
      "No verified Search Console site found for the connected Google account.";

    console.warn(
      `[google-oauth] ${issue}`
    );

    return { value: null, issue };
  }

  let targetHostname: string | null =
    null;

  try {
    targetHostname = new URL(
      websiteUrl
    ).hostname.replace(/^www\./, "");
  } catch {
    targetHostname = null;
  }

  if (targetHostname) {
    const matching =
      verifiedSites.find((site) =>
        site.siteUrl.includes(
          targetHostname!
        )
      );

    if (matching) {
      return {
        value: matching.siteUrl,
        issue: null,
      };
    }
  }

  return {
    value: verifiedSites[0].siteUrl,
    issue: null,
  };
}
