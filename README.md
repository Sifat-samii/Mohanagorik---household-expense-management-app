# MohaNagorik

MohaNagorik is a multi-household expense management application for shared bills, flexible splits, recurring expenses, receipts, member balances, and settlements. It uses Google OpenID Connect for authentication and keeps household data isolated by server-side membership checks.

## Production architecture

- Next.js 16 / React 19 application compiled by Vinext to Cloudflare Workers
- Cloudflare edge for TLS, reverse proxying, CDN, DDoS protection, and horizontal execution
- Cloudflare D1 for relational household data
- Cloudflare R2 for private receipts and profile images
- Google OpenID Connect Authorization Code flow with PKCE

Cloudflare is the reverse proxy and edge gateway for the current deployment. Do not put Nginx, Kong, or HAProxy in front of the Worker unless the application is later moved to self-managed infrastructure. See [Production deployment](docs/PRODUCTION.md).

## Local development

Requirements: Node.js 22.13+ and pnpm 11.25+.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to an ignored local environment file and replace every placeholder. Never commit OAuth or session secrets.

Apply the D1 migrations in `drizzle/` in order. The hosting workflow applies production migrations separately from local preview migrations.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` runs all four checks. GitHub Actions runs the same gates for pushes and pull requests.

## Required production configuration

- `APP_ORIGIN`: canonical HTTPS origin, without a path
- `GOOGLE_OAUTH_CLIENT_ID`: Google web OAuth client ID
- `GOOGLE_OAUTH_CLIENT_SECRET`: encrypted Google OAuth client secret
- `GOOGLE_SESSION_SECRET`: at least 32 cryptographically random bytes
- `DB`: Cloudflare D1 binding
- `BUCKET`: private Cloudflare R2 binding
- `RATE_LIMITER`: recommended Cloudflare Workers Rate Limiting binding

Google must list `${APP_ORIGIN}/api/auth/google/callback` as an authorized redirect URI. Use separate OAuth clients and data bindings for development, staging, and production.

## Security baseline

- signed, HTTP-only, Secure, SameSite session cookies
- OAuth state validation and PKCE
- origin validation for all state-changing routes
- optional distributed edge rate limiting
- household authorization on every protected query
- file signature, MIME, and size validation before R2 upload
- restrictive browser security headers and private/no-store cache rules
- soft deletion for expenses and structured server error logging

See [SECURITY.md](SECURITY.md) for secret handling and reporting guidance.
