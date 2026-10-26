# Room implementation status

## Implemented

- Only `POST /room` is implemented and registered in `src/app.ts` on `rooms-module`.
- `room.dto.ts` owns the room response schema and has no dependency on the participants module.
- The controller uses `lib_middleware_context` and JWT authentication from `lib_jwt`. Send `Authorization: Bearer <access_token>` from `/auth/login`.
- Creation requires an active main-database user, an active vault, and an active vault `Access` row whose `actions` contains `room.create`. Vault ownership alone does not bypass this permission.
- The main database stores `Vault` and `RoomRoute`. The vault stores `Room` and `RoomMember`. The corresponding additive migrations are in each schema's `20261021220000_room_creation` directory.
- Each room starts as an open, private group room with capacity 12. The creator becomes its active host; initial invitees become invited members.
- The vault creates the room and memberships atomically. If that write fails, the allocated main route is soft-deleted. Cleanup failure is logged without hiding the original write error.
- OpenAPI uses the existing `dev_user` scheme and documents the request, example, and response. No participant or presence implementation was changed.
- `scripts/seed.ts` creates or reuses a test host, two guests, the host's vault mapping, and its `room.create` permission. It uses the configured main `TURSODB_URL` and a separate tenant URL passed on the command line.

## Request and response

```http
POST /room
Content-Type: application/json
x-user-id: 1
```

```json
{
  "vault_id": 1,
  "room_title": "Team meeting",
  "user_ids": [2, 3]
}
```

- `vault_id`: an existing active vault. Its database URL is resolved on the server.
- `room_title`: 1–200 characters, including a non-whitespace character; trimmed before saving.
- `user_ids`: optional, up to 11 unique positive user IDs. All must exist and be active. The creator is included automatically and is never duplicated.
- Success returns HTTP 200 with `{ "data": <room> }`, including its generated UUID, timestamps, and default settings.
- Missing development authentication, or using it outside `ENV=dev`, returns 401. Missing creator, vault, or creation permission returns 403. Invalid invitees return 400. DTO validation failures return 422 using the existing error middleware.

## How to test

1. Generate clients from `apps/backend` with `bun run db:generate` after schema changes.
2. Apply the complete main and tenant migration histories to the databases you will actually use, including both new `20261021220000_room_creation/migration.sql` files. `db:migrate:main` and `db:migrate:tenant` target local scratch files, not the remote URLs. `db:deploy:main` applies main migrations to the configured `TURSODB_URL`. The tenant database needs its tenant migrations separately before seeding. The configured remote main and `mawiid-dev-tenant-test` were migrated on 2026-10-22.
3. From `apps/backend`, run `bun run db:seed "<tenant_database_url>"`. This reads the existing main `TURSODB_URL` from the root `.env`; it does not change that URL or any credentials. The tenant connection uses `TURSODB_GROUP_TOKEN`. The script prints the host ID and a ready-to-use request body. Repeated runs reuse active seed users, the vault, and permission; other existing access actions are preserved.
4. Start with `bun run dev` and `ENV=dev`. Open `/openapi`, enter the printed host ID in the `x-user-id` authentication control, and select `POST /room` under Room. The backend and script must use the same main database.
5. Send the example with fixture IDs. Check the returned room, one main route, exactly one host membership, and the invited members in the selected vault.
6. Check a caller without permission, invalid or deleted invitees, duplicate IDs, excessive invitees, and blank titles. Rejected requests must not create a usable room.
7. Run `bun test src/module/tenant/room/room.test.ts` for the focused tests or `bun test src` for all backend tests.

## Verification

- All 16 Rooms tests and all 12 existing presence tests pass: 28 total. HTTP tests exercise the real controller, development authentication, and DTO validation with mocked database context.
- A separate smoke check applied all migrations to new disposable local databases and used real Prisma clients to verify persisted rooms, routes, host/invited memberships, and access denial.
- The same check forced a membership insert failure and verified that the vault room write rolled back and the allocated route was soft-deleted. HTTP creation and the generated OpenAPI `dev_user` security metadata also passed.
- TypeScript checking passes with `--ignoreDeprecations 5.0`. The normal command remains blocked by the pre-existing `ignoreDeprecations: "6.0"` setting with TypeScript 5.9.3; that configuration is unchanged.
- The seed CLI was verified against new disposable local databases: it creates three users, one vault mapping and the permission; reruns without duplication; preserves existing actions; and rejects using the main URL as its tenant or redirecting an existing seed vault. The script also passes TypeScript checking with the compatibility override. No remote records were seeded by this verification.
- Remote setup on 2026-10-22: the configured main database received its pending room creation migration, and the empty `mawiid-dev-tenant-test` received the tenant migration history. The seed command then completed successfully: host user 1, guest users 2 and 3, vault 1, and the host's `room.create` permission. Use `dev_user=1` and the printed body to test `POST /room`. No room was created by the seed.

## Missing and limitations

- Finding, updating, deleting, joining, leaving, declining, closing, and lifecycle webhook handling are not implemented on this branch. Routes present only on `skamroun` are not available here.
- Direct calls, webinars, scheduling, settings changes, LiveKit integration, invite notifications, attendance, audit entries, and automatic reconciliation remain pending.
- Production authentication, user creation, vault provisioning, and permission management remain separate work.
- The seed script requires already migrated databases. It does not create Turso databases, apply migrations, create a room, or expose a seed HTTP endpoint. It seeds only a vault mapping for the host; guests are invited into that vault's rooms.
- Main and vault cannot share a transaction. A process crash or cleanup failure can leave an unused route without a room; automatic reconciliation is pending.
- Review and test this creation endpoint before implementing the next method or endpoint.
