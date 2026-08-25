import { randomUUID } from "node:crypto";

/* ========================================
   CMS ADAPTER

   Stage 3 (technical-fix and publishing
   agents) talk to a CMS only through this
   interface. No WordPress site is wired up
   yet, so MockCmsAdapter below is the
   default implementation - it logs what it
   would have done and returns a success
   result with the same shape a real adapter
   would return. Swapping in a real
   WordPress adapter later means writing a
   class that implements CmsAdapter and
   passing it into the agent constructor -
   no agent code changes required.
======================================== */

export interface CmsFixRequest {
  type: string;
  title: string;
  description: string;
}

export interface CmsFixResult {
  success: boolean;
  message: string;
  appliedAt: string;
}

export interface CmsPublishRequest {
  title: string;
  body: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  slug?: string | null;
}

export interface CmsPublishResult {
  success: boolean;
  externalId?: string | null;
  url?: string | null;
  message: string;
  publishedAt: string;
}

export interface CmsAdapter {
  applyFix(
    fix: CmsFixRequest
  ): Promise<CmsFixResult>;

  publish(
    request: CmsPublishRequest
  ): Promise<CmsPublishResult>;
}

/* ========================================
   MOCK CMS ADAPTER
======================================== */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class MockCmsAdapter
  implements CmsAdapter
{
  async applyFix(
    fix: CmsFixRequest
  ): Promise<CmsFixResult> {
    console.log(
      `[MockCmsAdapter] Applying ${fix.type} fix: "${fix.title}" — ${fix.description}`
    );

    return {
      success: true,

      message: `Mock CMS applied the "${fix.type}" fix: ${fix.title}`,

      appliedAt:
        new Date().toISOString(),
    };
  }

  async publish(
    request: CmsPublishRequest
  ): Promise<CmsPublishResult> {
    const slug =
      request.slug ??
      slugify(request.title);

    console.log(
      `[MockCmsAdapter] Publishing "${request.title}" (slug: ${slug})`
    );

    return {
      success: true,

      externalId: randomUUID(),

      url: `https://mock-cms.local/${slug}`,

      message: `Mock CMS published "${request.title}".`,

      publishedAt:
        new Date().toISOString(),
    };
  }
}
