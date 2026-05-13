# Customer Deployment Model

## Expected Model

Use **one deployment per customer**.

- one repo
- one shared Google OAuth app
- one Cloudflare Worker deployment per customer
- one custom subdomain per customer
- one secret set per customer
- one state/log boundary per customer
- one Telegram bot per customer when possible

This is the recommended launch model for the current product stage:

- single-tenant beta
- operator-managed onboarding
- strong separation without multi-tenant backend complexity

## Naming

For each customer, define:

- `tenant_id`: short internal id, for example `alice`
- `worker_name`: Cloudflare Worker name, for example `agent-alice`
- `host`: customer subdomain, for example `alice-agent.yourdomain.com`

## Cloudflare Mapping

Each customer host should point to its own Worker deployment.

Example:

- `alice-agent.yourdomain.com/*` -> Worker `agent-alice`
- `bob-agent.yourdomain.com/*` -> Worker `agent-bob`

Each deployment serves:

- `/oauth/google/start`
- `/oauth/google/callback`
- `/webhooks/telegram`
- the Flue admin agent endpoint used by the chat bridge

## Google Model

Use one Google Cloud OAuth app owned by us.

- shared across customers:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
- customer-specific:
  - `GOOGLE_REFRESH_TOKEN`

Each customer authorizes our OAuth app against their own Google account or Workspace.

Each deployed customer host must be registered as an allowed OAuth callback URL in the Google Cloud app:

- `https://<customer-host>/oauth/google/callback`

## Telegram Model

Telegram is the only required chat integration for the current launch expectation.

Recommended:

- one Telegram bot per customer
- one webhook per customer deployment
- one webhook secret per customer deployment

Webhook target:

- `https://<customer-host>/webhooks/telegram`

## Per-Customer Required Configuration

Required per deployment:

- `WORKSPACE_TENANT_ID=<tenant-id>`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`
- `GOOGLE_REFRESH_TOKEN=...`
- `GOOGLE_OAUTH_BASE_URL=https://<customer-host>`
- `GOOGLE_OAUTH_STATE_SECRET=<random-secret>`
- `CHAT_ENABLED_PROVIDERS=telegram`
- `CHAT_ALLOWED_USER_IDS=<approved-telegram-user-id[,another-id]>`
- `FLUE_AGENT_WEBHOOK_URL=https://<customer-host>/agents/admin/chat-default` or the deployed Flue route
- `TELEGRAM_BOT_TOKEN=...`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN=...`

For Telegram deployments, `CHAT_ALLOWED_USER_IDS` is required. The bridge rejects all other Telegram users before invoking the agent.

## Customer Onboarding Flow

1. Create a new Worker deployment for the customer.
2. Bind a customer subdomain to that Worker.
3. Set all non-refresh-token env values.
4. Generate the friend-facing Google onboarding link:
   - `npm run onboard:google -- start-url --tenant <tenant-id> --label <customer-label>`
5. Send that link to the customer.
6. Customer approves Google access.
7. Customer sends the full callback URL back to the operator privately.
8. Operator exchanges the callback URL:
   - `npm run onboard:google -- exchange-url --url '<FULL_CALLBACK_URL>'`
9. Copy the returned `GOOGLE_REFRESH_TOKEN` into that customer deployment.
10. Deploy with `npm run deploy:cloudflare` so the Worker and Telegram bot commands are updated together.
11. Configure the Telegram bot webhook for that customer host if it is not already managed for that bot.
12. Run smoke checks and the first real task.

## Operating Expectation

This model is intentionally simple:

- customer separation comes from separate deployments, not shared runtime tenancy
- onboarding is operator-assisted, not self-serve
- rollback, debugging, and blast radius stay per customer
- Google refresh token setup is manual by design for launch: customer sends callback URL, operator performs exchange, operator stores the secret

Do not introduce a shared multi-tenant control plane until this model becomes operationally painful.
