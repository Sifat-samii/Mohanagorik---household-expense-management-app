# Security policy

## Secrets

Never commit Google OAuth secrets, session signing keys, Cloudflare tokens, database exports, receipts, or real household data. Store production values as encrypted deployment secrets and rotate them after suspected disclosure.

The Google OAuth client secret previously used during development must be rotated before public deployment. Rotation requires updating the deployment secret and revoking the old credential in Google Cloud.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Include the affected route, reproduction steps, impact, and any relevant request ID. Do not include real user financial data or access tokens in an issue.

## Supported version

Only the latest commit on `main` is supported. Security fixes should be deployed promptly after CI and staging verification.
