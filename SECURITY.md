# Security Policy

AI Video Production Editor handles local media and provider credentials. Please
report security issues responsibly.

## Supported versions

Security fixes target the default branch and the latest public release. During
the open-source transition, older local builds are not maintained separately.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving credentials, account
access, local file exposure, billing abuse, or hosted API bypasses.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for the repo.
2. If private reporting is not enabled, contact the repository owner through
   their GitHub profile and request a private disclosure channel.

Include:

- Affected version or commit.
- Reproduction steps.
- Expected impact.
- Whether credentials, local files, billing, or provider calls are involved.

## Secret handling expectations

- Never commit `.env`, `.env.local`, certificates, private keys, release builds,
  or real provider credentials.
- Treat provider API keys as user-owned secrets.
- Hosted deployments must use server-side environment variables for Stripe,
  Supabase service role keys, and BYOK vault secrets.
- Renderer/client variables must never contain server-only secrets.

## Scope

In scope:

- Credential leakage.
- Local file access outside expected project/media flows.
- Hosted API route authorization issues.
- Billing or BYOK proxy bypasses.
- Unsafe deserialization or command execution paths.

Out of scope:

- Provider model output quality.
- Abuse that requires a compromised local machine.
- Rate limits or quota exhaustion caused only by a user's own provider key.
