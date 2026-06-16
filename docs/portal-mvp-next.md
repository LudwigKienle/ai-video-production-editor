# Portal MVP — Next Implementation Steps

## Auth (Phase 1)
- Replace localStorage auth with Supabase/Firebase
- Persist sessions + passwordless magic links

## Teams
- CRUD teams + invites
- Role enforcement per route

## Billing
- Stripe checkout session + webhook
- Seat count enforcement

## Analytics
- Usage events API
- Per-team usage dashboard

## Embed Integration
- Add signed embed token (JWT)
- Allowlist origins + per-team feature flags
