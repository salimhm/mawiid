# Mawiid Backend

The backend is a stateless Bun and Elysia service. Shared identity and routing features live under src/module/main; per-user features live under src/module/tenant.

Run `bun install` from the repository root, then `bun run db:generate` from this directory. Configure the root `.env` using `.env.example` and start with `bun run dev`.

Startup checks required environment variables before listening. The app exposes the database clients and Redis client to future handlers and closes them on shutdown. No HTTP routes are registered yet. See [database and configuration setup](../../docs/backend-database-setup.md).

