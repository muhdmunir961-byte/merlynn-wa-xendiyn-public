# merlynn-wa-xendiyn Implementation Plan

> **For agentic workers:** Native execution in this session.

**Goal:** Create a minimal runnable TypeScript WhatsApp bot scaffold with Baileys, health checks, JSON persistence, safe owner claiming, and extension interfaces.

**Architecture:** A small `src/` application separates transport (`whatsapp`), message/domain logic (`bot`), persistence (`persistence`), and provider contracts (`plugins`). Baileys multi-file auth is stored under `auth_info`; bot state is stored as JSON under `data`; Fastify exposes `/health`.

**Tech Stack:** Node.js, TypeScript, `@whiskeysockets/baileys`, Fastify, dotenv, pino, qrcode-terminal, JSON persistence.

## Global Constraints

- Project name: `merlynn-wa-xendiyn`.
- No credentials or deployment.
- Incoming command prefix is `.`.
- Only a group admin who explicitly sends `.claimowner` may claim ownership; no automatic admin promotion.
- Keep LLM, Digiflazz, manual deposits, and Pterodactyl/Coolify integrations as placeholders/interfaces.

## Review Focus

- Reconnect and credential persistence must not erase `auth_info`.
- `.claimowner` must reject non-admins and already-owned groups.
- Group metadata failures must fail closed rather than granting ownership.
- Messages from status/broadcast and non-text messages must be ignored safely.
- Outgoing messages must be serialized and delayed with bounded jitter.

### Task 1: Project and runtime scaffold

**Files:** `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml`, `src/config.ts`, `src/server.ts`, `src/index.ts`.

- [ ] Define scripts, dependencies, strict TypeScript config, environment parsing, health endpoint, and graceful shutdown.
- [ ] Add container and compose examples with no secrets.

### Task 2: Persistence and plugin contracts

**Files:** `src/persistence/json-store.ts`, `src/plugins/interfaces.ts`.

- [ ] Implement atomic JSON state persistence for owners and provide typed provider interfaces.

### Task 3: WhatsApp transport and bot behavior

**Files:** `src/whatsapp/auth.ts`, `src/whatsapp/queue.ts`, `src/bot/parser.ts`, `src/bot/owner-claim.ts`, `src/whatsapp/client.ts`.

- [ ] Wire Baileys QR/auth/reconnect handling, parse dot-prefixed commands, type before replies, serialize outgoing sends with jitter, and implement explicit admin-only owner claims.

### Task 4: Documentation and verification

**Files:** `README.md`.

- [ ] Document setup, QR login, commands, persistence, extension points, operations, and safety boundaries.
- [ ] Run install and typecheck, fixing issues found.
