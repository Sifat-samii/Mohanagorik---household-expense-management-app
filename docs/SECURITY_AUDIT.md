# Security and scalability audit

Date: 2026-09-15

## Resolved in this hardening pass

- OAuth Authorization Code flow now uses PKCE in addition to state validation.
- Session HMAC verification uses Web Crypto verification instead of a normal string comparison.
- Session and OAuth cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, and `SameSite=Lax`.
- Browser write requests require an exact trusted origin and reject cross-site mutations.
- A Cloudflare rate-limit binding is supported for OAuth, mutations, and uploads.
- Receipt and avatar uploads verify size, declared MIME type, and file signatures.
- Receipt delivery blocks unknown legacy content types and adds `nosniff` and sandbox headers.
- Internal member identity IDs are no longer returned to household clients.
- Internal exception details are logged with request IDs but not returned to users.
- API responses containing user data use `Cache-Control: no-store`; private media uses private caching.
- Security headers now cover CSP, HSTS, framing, MIME sniffing, referrers, browser permissions, and cross-origin isolation.
- Monetary calculations were extracted into tested deterministic functions.
- D1 query indexes were added for membership, expense, split, settlement, recurring, and profile lookups.
- CI now enforces linting, type checking, calculation tests, a high-severity dependency audit, and a production build.
- The high-severity dependency advisories reported during the audit were removed from the resolved graph.

## Required control-plane work

- Rotate the disclosed Google OAuth client secret before any public launch.
- Configure production secrets, `APP_ORIGIN`, D1, private R2, and `RATE_LIMITER` bindings.
- Apply `drizzle/0002_bizarre_jackpot.sql` to production.
- Enable Cloudflare WAF and route-specific rate rules.
- Configure uptime, error-rate, and latency alerts plus backup/recovery procedures.
- Protect the GitHub `main` branch and require CI before merge.

## Next stage before native mobile release

- Replace the first-party action endpoint with a documented `/api/v1` contract.
- Add mobile Authorization Code + PKCE, short-lived access tokens, refresh rotation, revocation, and device/session management.
- Add idempotency keys for financial writes and cursor pagination for long expense histories.
- Add immutable audit events for expense, settlement, membership, and invite changes.
- Add expiring/rotatable household invitations and account/household deletion workflows.
- Add automated cross-household authorization tests and staged load tests.

## Accepted current limitations

The remaining dependency audit findings are low/moderate issues in legacy development-only `esbuild` paths pulled by Drizzle tooling. They are not included in the production Worker path. Development servers must remain bound to loopback or an authenticated internal preview.
