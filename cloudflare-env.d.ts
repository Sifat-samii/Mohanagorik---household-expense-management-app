declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
    APP_ORIGIN?: string;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_SESSION_SECRET?: string;
  }
}
