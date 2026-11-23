# merlynn-wa-xendiyn

Minimal, runnable TypeScript WhatsApp bot using the Baileys WebSocket transport. It contains no credentials and does not deploy anything.

## Features

- Baileys WebSocket connection with multi-file persistent auth in `auth_info/`.
- QR code printed in the terminal on first login.
- Fastify `GET /health` and an optional signed `POST /webhooks/digiflazz` endpoint.
- JSON persistence for group owners and manual deposits.
- Serialized outgoing queue with composing/paused presence for every reply.
- Ollama chat with short in-memory per-chat history and rate limiting.
- Digiflazz balance, price, topup, and status commands.
- Explicit, safe group-owner claim: only a verified current group admin can claim an unowned group. Current admins are never automatically owners.

## Requirements and setup

Node.js 20+ and an account available to link as a WhatsApp companion device are required.

```sh
cp .env.example .env
npm install
npm run typecheck
npm run dev
```

Scan the QR code printed in the terminal from WhatsApp's **Linked devices** screen. Auth files are created under `auth_info/`; do not commit or share them. Health is available at `http://localhost:3000/health`.

For production-like local execution:

```sh
npm run build
npm start
```

## Commands

| Command | Access | Behavior |
| --- | --- | --- |
| `.menu`, `.help` | Everyone | Show available commands. |
| `.ping` | Everyone | Replies `pong`. |
| `.claimowner` | Current group admin, once per group | Stores that sender as the group owner. Metadata is checked live. |
| `.ai <text>` | Everyone, when enabled | Explicitly asks Ollama. |
| Plain text | Everyone, when `LLM_ENABLED=true` | Asks Ollama; otherwise ignored. |
| `.price [query]` | Everyone | Lists up to ten matching Digiflazz products. |
| `.deposit <amount>` | Stored owner | Creates a pending manual deposit. Amount must be a positive safe integer. |
| `.deposits` | Stored owner | Lists pending manual deposits. |
| `.approve <id>` / `.reject <id> [reason]` | Stored owner | Reviews a pending deposit. |
| `.saldo` | Stored owner | Checks Digiflazz balance. |
| `.topup <sku> <customer>` | Stored owner | Starts a Digiflazz prepaid transaction. |
| `.status <ref_id>` | Stored owner | Checks a ref created by this running process. |

Owner-only commands require a group chat and an exact match with the owner persisted by `.claimowner`. Being a group admin alone is not enough. Private chats cannot run owner-only commands. Manual deposit approval does not move money automatically; it only records a human review state.

## Configuration and safety

Copy `.env.example` to `.env`. Digiflazz credentials are read only from `DIGIFLAZZ_USERNAME` and `DIGIFLAZZ_API_KEY`; they are never printed or sent in WhatsApp replies. Leave them blank to disable Digiflazz commands. `LLM_ENABLED=false` disables implicit messages and `.ai` reports that AI is disabled. Ollama has no credentials in this project. `LLM_RATE_LIMIT_MS` and `LLM_HISTORY_LIMIT` bound local chat behavior.

`POST /webhooks/digiflazz` accepts raw JSON only when `DIGIFLAZZ_WEBHOOK_SECRET` is configured and the Digiflazz `X-Hub-Signature: sha1=...` HMAC header matches the raw body (`sha256=...` is also accepted). Without a secret it returns `503`; invalid signatures return `401`. The endpoint acknowledges verified payloads but does not mutate deposits or execute WhatsApp actions. Do not expose the health/webhook server publicly without your own network controls.

`OUTGOING_MIN_DELAY_MS` and `OUTGOING_JITTER_MS` control the outgoing queue. `AUTH_DIR` and `DATA_FILE` should point to persistent volumes in Docker.

## Docker

The included `Dockerfile` and optional `docker-compose.yml` mount `auth_info/` and `data/` as local volumes. Create a local `.env` first; it is ignored by git.

```sh
docker compose up --build
```

## Layout

```text
src/
  bot/          command parsing and owner claim policy
  deposit/      manual deposit service
  digiflazz/    Digiflazz HTTP client
  llm/          local Ollama provider
  persistence/  JSON state store
  plugins/      provider interfaces
  whatsapp/     auth, socket lifecycle, commands, and outgoing queue
  config.ts
  server.ts
  index.ts
```
