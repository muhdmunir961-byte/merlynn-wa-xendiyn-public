# WhatsApp Digiflazz and Ollama Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the existing Baileys client, local Ollama provider, manual deposits, Digiflazz commands, and a signed webhook without exposing credentials or weakening owner authorization.

**Architecture:** Keep `WhatsAppClient` as the transport and command router, using the existing serialized presence-aware queue for every reply. Instantiate providers from environment-backed configuration in `index.ts`, pass them into the client and health server, and add a raw-body Fastify webhook route that verifies an optional configured HMAC secret before acknowledging events.

**Tech Stack:** TypeScript, Node.js 20+, Baileys WebSocket, Fastify, Ollama HTTP API, Digiflazz HTTP API, JSON file persistence.

**Spec:** User request in the task prompt.

## Global Constraints

- Keep Baileys WebSocket.
- Non-command messages invoke Ollama only when `LLM_ENABLED=true`; otherwise ignore them.
- Owner commands require the stored owner; group admins are not auto-promoted.
- Use environment credentials only and never log them.
- Replies use the existing outgoing queue/presence.
- Do not deploy or use credentials.
- Avoid unsafe WhatsApp interactive features.

## Review Focus

- A non-owner admin must be rejected even if current group metadata says admin; test stored-owner equality.
- Invalid, fractional, unsafe, or overflowing deposit amounts must not create records; test parser boundaries.
- A missing or mismatched webhook signature must not be processed; test raw-body verification.
- Missing Digiflazz credentials must degrade commands safely without logging secrets; test provider construction/command errors.
- LLM-disabled plain text must produce no reply while `.ai` reports the disabled state safely; test both paths.

### Task 1: Wire providers and configuration

**Files:**
- Modify: `src/config.ts`, `src/index.ts`, `src/server.ts`
- Modify: `.env.example`

**Interfaces:**
- `startHealthServer` accepts an optional webhook handler/config without removing `/health`.
- `WhatsAppClient` receives the store plus optional provider instances.

- [x] Add environment fields for webhook secret and LLM/rate-limit settings without logging values.
- [x] Instantiate `ManualDepositService`, `OllamaLlmProvider`, and `DigiflazzClient` only from environment values in `index.ts`; keep missing Digiflazz credentials non-fatal.
- [x] Add raw-body `POST /webhooks/digiflazz` handling with HMAC-SHA1/SHA256 timing-safe verification when a secret is configured; return safe 2xx/4xx responses and preserve health startup.
- [x] Document environment variables and webhook safety.

### Task 2: Implement WhatsApp routing and authorization

**Files:**
- Modify: `src/whatsapp/client.ts`
- Modify: `src/plugins/interfaces.ts` only if provider contracts need the existing concrete methods exposed.

**Interfaces:**
- Commands: `.menu`, `.help`, `.ping`, `.claimowner`, `.ai <text>`, `.deposit <amount>`, `.deposits`, `.approve <id>`, `.reject <id>`, `.saldo`, `.price [query]`, `.topup <sku> <customer>`, `.status <ref_id>`.
- Stored owner lookup is `store.getOwner(groupJid)?.jid === senderJid`; private chats have no stored owner and cannot run owner commands.

- [x] Preserve Baileys connection lifecycle, message extraction, queue, and presence behavior.
- [x] Add short per-chat in-memory history and bounded rate limiting for implicit and explicit LLM requests.
- [x] Route noncommands to Ollama only when enabled; make `.ai` explicit and return concise safe errors when disabled, rate-limited, or provider-failing.
- [x] Fetch group metadata only for group authorization and `.claimowner`; never treat all admins as owners.
- [x] Add manual deposit commands with safe integer amount parsing and owner checks.
- [x] Add Digiflazz commands, query matching/formatting, ref-id handling, and safe provider-unavailable errors; never include credentials in replies/logs.
- [x] Ensure every user-visible reply goes through `reply()` and the existing queue/presence.

### Task 3: Static verification and documentation review

**Files:**
- Modify: `README.md`

- [x] Run `npm run typecheck` and/or `npm run build`; npm's wrapper is broken in this environment, so record the exact failure and use TypeScript/static inspection available locally.
- [x] Inspect the changed source for credential leakage, unsafe interactive-message usage, and command/authorization coverage; delimiter balance is clean.
- [x] Update README command tables, LLM behavior, owner safety, Digiflazz webhook/signature, and manual deposit notes.
