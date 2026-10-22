# Room implementation status

## Implemented

- `POST /room`, `GET /room`, `PATCH /room`, `DELETE /room`, and `POST /room/join` are implemented and registered on `rooms-module`.
- `room.dto.ts` owns the room response schema and has no dependency on the participants module.
- The controller uses the existing `lib_context` and development authentication from `lib_jwt`. Send `x-user-id` with `ENV=dev`; real JWT authentication is not implemented on this branch.
- Creation requires an active main-database user, an active vault, and an active vault `Access` row whose `actions` contains `room.create`. Vault ownership alone does not bypass this permission.
- The main database stores `Vault` and `RoomRoute`. The vault stores `Room` and `RoomMember`. The corresponding additive migrations are in each schema's `20261021220000_room_creation` directory.
- Each room starts as an open, private group room with capacity 12. The creator becomes its active host; initial invitees become invited members.
- The vault creates the room and memberships atomically. If that write fails, the allocated main route is soft-deleted. Cleanup failure is logged without hiding the original write error.
- OpenAPI uses the existing `dev_user` scheme and documents the request, example, and response. No participant or presence implementation was changed.
- Finding rooms is scoped to one requested vault and the caller's invited, waiting, or active memberships. Deleted rooms and deleted, banned, or declined memberships are excluded. Finding does not require `room.create` permission.
- Updating changes only the title and requires a host or moderator membership. The role, membership status, ban, and deletion checks are included in the write itself. Other room settings and the creator ID are never updated by this endpoint.
- Deleting soft-deletes scheduled or closed rooms for an eligible host only. Scheduled rooms become closed with reason `canceled`; closed rooms retain their existing close details. Membership records are retained. Main route cleanup is best effort after the tenant write.
- Joining updates only the caller's existing membership in the requested vault. Open/live rooms allow eligible invited or waiting members to become active, or waiting with a lobby. Capacity and the membership update share one tenant transaction. LiveKit connection and tokens remain pending.
- `scripts/seed.ts` creates or reuses a test host, two guests, the host's vault mapping, and its `room.create` permission. It uses the configured main `TURSODB_URL` and a separate tenant URL passed on the command line.

## Request and response

### Create a room

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

### Find rooms

```http
GET /room?vault_id=1&page=1&take=20
x-user-id: 1
```

| Query | Meaning |
| --- | --- |
| `vault_id` | Required positive integer identifying an active vault. The server resolves its URL. |
| `room_uid` | Optional UUID that limits the results to that room, with the same membership checks. |
| `page` | Optional integer from 1 to 1,000,000; defaults to 1. |
| `take` | Optional integer from 1 to 100; defaults to 20. |

- Success returns HTTP 200 with `data`, `rows`, `pages`, `page`, and `take`. `data` contains complete room records; `rows` is the total matching the caller and UUID filters, and `pages` is the total page count.
- Results are newest first by `created_at`, then `room_id` to resolve ties. Pages beyond the end return an empty `data` array with the same totals.
- An active user with no matching membership receives an empty list, including when the UUID exists but is inaccessible. With no matching rooms, `rows` and `pages` are zero.
- Missing authentication returns 401. Missing or deleted users or vaults return 403. Invalid query values return 422.
- Invited users can find their rooms before joining. Deleted, banned, and declined memberships never grant visibility. Only the selected vault is searched.

### Rename a room

```http
PATCH /room
Content-Type: application/json
x-user-id: 1
```

```json
{
  "vault_id": 1,
  "room_uid": "00000000-0000-4000-8000-000000000001",
  "room_title": "Updated meeting title"
}
```

- Replace the example UUID with one returned by `GET /room`. The server searches only the selected active vault.
- The caller must be an active user with an invited, waiting, or active host/moderator membership. Ordinary members, viewers, outsiders, and deleted, banned, or declined memberships are refused. Vault ownership and `room.create` permission do not bypass this check.
- The title follows creation's 1–200 character, non-whitespace validation and is trimmed before saving. Success returns HTTP 200 with `{ "data": <updated room> }`.
- Missing authentication returns 401. Missing or deleted users/vaults, or insufficient membership, return 403. A missing or deleted room in the selected vault returns `404 room-not-found`. Invalid bodies return 422.
- Only `room_title` is written. The endpoint does not change settings or membership and does not contact LiveKit.

### Delete a room

```http
DELETE /room
Content-Type: application/json
x-user-id: 1
```

```json
{
  "vault_id": 1,
  "room_uid": "00000000-0000-4000-8000-000000000001"
}
```

- The caller must be an active user with an invited, waiting, or active host membership in the selected active vault. Moderators, members, outsiders, and deleted, banned, or declined memberships cannot delete. Creation permission is not required.
- Only scheduled or closed rooms are eligible. Scheduled rooms receive `room_status=closed`, `room_close_reason=canceled`, and the same timestamp for `room_closed_at` and `deleted_at`. Closed rooms change only `deleted_at`.
- Success returns HTTP 200 with `{ "data": <soft-deleted room> }`. Membership history remains unchanged; GET hides the room, PATCH refuses it, and a repeated DELETE returns 404.
- Missing authentication returns 401. Missing or deleted users/vaults or insufficient membership return 403. Missing or deleted rooms in the selected vault return `404 room-not-found`. Open/live rooms, or a concurrent change that prevents the guarded write, return `409 room-not-deletable`. Invalid bodies return 422.
- The tenant write checks the room status and eligible host membership again. Only afterward does the server soft-delete the active main route matching both UUID and vault. A missing route is allowed. Cleanup failure is logged and still returns 200 because the tenant deletion succeeded; automatic route reconciliation is pending.
- POST currently creates only open rooms. Scheduling and closing endpoints do not exist yet, so newly created rooms return 409 here. Successful deletion was verified using scheduled/closed fixtures in disposable local databases.

### Join a room

```http
POST /room/join
Content-Type: application/json
x-user-id: 2
```

```json
{
  "vault_id": 1,
  "room_uid": "00000000-0000-4000-8000-000000000001"
}
```

- Replace the UUID with a room returned by creation or finding. The main user and selected vault must be active. The server resolves the tenant URL; room lookup is limited to that vault.
- The caller needs an existing invited, waiting, or active membership that is neither banned nor deleted. Nonmembers and declined memberships are refused. No membership is created, no role is changed, and `room.create` access is not needed. Body fields cannot select another user or grant a role.
- Only open/live rooms can be joined. Closed rooms return `410 room-closed`; scheduled or other unavailable states return `409 room-not-open`. A locked room allows only its host; everyone else receives `423 room-locked`.
- With the lobby enabled, guests become waiting while hosts and moderators bypass it. Waiting guests receive HTTP 200 with a waiting membership; this does not admit them to media. They remain waiting on repeat calls. If the lobby is disabled, waiting members may become active subject to capacity. An already active member remains active, including with a lobby or at full capacity, after lifecycle and lock checks.
- Capacity counts active, nondeleted, nonbanned membership rows, including the creator. Waiting/invited members do not consume capacity. New activation at the limit returns `409 room-full` without changing membership. It currently measures database participation, not connected LiveKit clients.
- The tenant transaction first writes the existing room UUID back unchanged to acquire SQLite's write lock before authorization, capacity reads, and membership changes. This serializes competing writers without changing room fields. A transaction lock conflict or timeout returns `503 service-unavailable`; retry the request. A retry rechecks capacity and permissions. Rejected transactions roll back.
- Success returns HTTP 200 with `{ "data": <room membership> }`, including membership ID, room ID, user ID, role, status, ban, creation, and deletion fields. Repeated joins reuse the same row. The endpoint returns no LiveKit token and does not update room lifecycle, attendance, or presence.
- Missing authentication returns 401. Missing/deleted users or vaults and ineligible memberships return 403. A missing or deleted room in the requested vault returns `404 room-not-found`. Invalid bodies return 422.

## How to test

1. Generate clients from `apps/backend` with `bun run db:generate` after schema changes.
2. Apply the complete main and tenant migration histories to the databases you will actually use, including both new `20261021220000_room_creation/migration.sql` files. `db:migrate:main` and `db:migrate:tenant` target local scratch files, not the remote URLs. `db:deploy:main` applies main migrations to the configured `TURSODB_URL`. The tenant database needs its tenant migrations separately before seeding. The configured remote main and `mawiid-dev-tenant-test` were migrated on 2026-10-22.
3. From `apps/backend`, run `bun run db:seed "<tenant_database_url>"`. This reads the existing main `TURSODB_URL` from the root `.env`; it does not change that URL or any credentials. The tenant connection uses `TURSODB_GROUP_TOKEN`. The script prints the host ID and a ready-to-use request body. Repeated runs reuse active seed users, the vault, and permission; other existing access actions are preserved.
4. Start with `bun run dev` and `ENV=dev`. Open `/openapi`, enter the printed host ID in the `x-user-id` authentication control, and select `POST /room` under Room. The backend and script must use the same main database.
5. Send the example with fixture IDs. Check the returned room, one main route, exactly one host membership, and the invited members in the selected vault.
6. Check a caller without permission, invalid or deleted invitees, duplicate IDs, excessive invitees, and blank titles. Rejected requests must not create a usable room.
7. Run `bun test src/module/tenant/room/room.test.ts` for the focused tests or `bun test src` for all backend tests.
8. In OpenAPI select Room > Find my rooms, set `vault_id=1`, `page=1`, and `take=20`, and use host `dev_user=1`. Then use guest `dev_user=2` to verify that invited rooms are visible without creation permission. Use actual fixture IDs if different.
9. Copy a returned `room_uid` into the optional filter. Test pagination with `take=1`, and verify that an existing user who was not invited sees no rooms. A user ID that does not exist returns 403 instead.
10. In OpenAPI select Room > Rename a room. Use host `dev_user=1`, the actual `vault_id`, and a UUID from `GET /room`. Change the title, then call GET again to confirm it persisted. Repeat as invited guest `dev_user=2`: without a moderator role, it must return 403 and preserve the title.
11. In OpenAPI select Room > Delete a room and send the vault ID and room UUID as its host. An open room must return 409; an invited guest must receive 403. With an existing scheduled/closed test fixture, expect 200 and a non-null `deleted_at`; confirm GET hides it and a repeated DELETE returns 404. The seed does not create eligible rooms or alter room lifecycle states.
12. Create an open room as host 1 with `user_ids: [2, 3]`, using actual seed IDs if different. In OpenAPI select Room > Join a room, authenticate as guest 2, and send the returned UUID and vault ID. Expect 200 with `room_member_status=active` and `room_member_role=member`. Repeat: the membership ID and status must stay the same. The host can also call join and keeps the existing active host membership. An existing user not invited to the room receives 403.
13. Lobby, lock, full-room, scheduled, and closed cases are covered by mocked tests and disposable local database fixtures. No settings, admission, or lifecycle endpoint is added by this change; the seed does not enable these settings. A successful join does not yet establish a media connection.

## Verification

- All 100 Rooms tests and all 12 existing presence tests pass: 112 total. HTTP tests cover all five endpoints, development authentication, query/body validation, pagination and totals, UUID filtering, vault resolution, rename authorization, title-only writes, deletion, and joining with mocked database context. The 30 join tests cover caller identity, existing membership checks, lifecycle, locks, lobby, capacity, repeated joins, and retryable transaction conflicts.
- A separate smoke check applied all migrations to new disposable local databases and used real Prisma clients to verify persisted rooms, routes, host/invited memberships, and access denial.
- The same check forced a membership insert failure and verified that the vault room write rolled back and the allocated route was soft-deleted. HTTP creation and the generated OpenAPI `dev_user` security metadata also passed.
- TypeScript checking passes with `--ignoreDeprecations 5.0`. The normal command remains blocked by the pre-existing `ignoreDeprecations: "6.0"` setting with TypeScript 5.9.3; that configuration is unchanged.
- The seed CLI was verified against new disposable local databases: it creates three users, one vault mapping and the permission; reruns without duplication; preserves existing actions; and rejects using the main URL as its tenant or redirecting an existing seed vault. The script also passes TypeScript checking with the compatibility override. No remote records were seeded by this verification.
- Remote setup on 2026-10-22: the configured main database received its pending room creation migration, and the empty `mawiid-dev-tenant-test` received the tenant migration history. The seed command then completed successfully: host user 1, guest users 2 and 3, vault 1, and the host's `room.create` permission. Use `dev_user=1` and the printed body to test `POST /room`. No room was created by the seed.
- Finding was verified with real Prisma clients against two disposable local vault databases. Checks passed for invited/waiting/active membership visibility, nonmember exclusion, vault and UUID isolation, pagination and totals, deleted rooms/users/vaults/memberships, bans, declines, HTTP responses, and generated OpenAPI query/security metadata. No remote data or schema was changed for `GET /room`.
- Renaming was verified with real Prisma clients against disposable local databases: hosts and moderators succeed; ordinary members, viewers, outsiders, and deleted/banned/declined memberships fail without changing the title. Cross-vault UUID isolation, deleted users/vaults/rooms, title-only HTTP updates, GET persistence, and generated PATCH documentation also passed. No remote data or schema was changed for `PATCH /room`.
- Deletion was verified with real Prisma clients against two disposable local vault databases: scheduled cancellation and closed-room preservation persist; route cleanup uses the same deletion timestamp; memberships remain unchanged. Moderator/member/outsider and deleted/banned/declined host memberships are denied. Cross-vault isolation, deleted users/vaults, open/live rejection, a concurrent transition to live, GET/PATCH/repeat-delete hiding, HTTP deletion, and generated OpenAPI metadata passed. No remote data or schema was changed for `DELETE /room`.
- Joining was verified with real Prisma clients against disposable local databases: active/waiting changes persist, repeated joins reuse membership IDs, lobby and lock rules hold, full-room rejection preserves status, and outsiders plus deleted/banned/declined memberships are denied. Cross-vault UUID isolation, deleted users/vaults/rooms, closed/scheduled rejection, authenticated HTTP identity, and OpenAPI metadata passed. Two independent clients competing for one remaining place produced one successful activation and one retryable conflict; the retry returned room-full and active membership stayed within capacity. No remote data or schema was changed for `POST /room/join`.

## Missing and limitations

- Leaving, declining, closing, lobby admission, and lifecycle webhook handling are not implemented on this branch. Routes present only on `skamroun` are not available here.
- The suggested next endpoint is `POST /room/leave`, after reviewing and testing joining.
- Joining currently handles database membership only. LiveKit room creation, tokens, Redis initialization locking, connection-based capacity, presence notifications, and attendance are still pending. The final media join contract in the planning documents is not implemented by this increment. Active memberships continue to occupy capacity until changed; automatic disconnect cleanup is pending.
- Finding requires a vault ID. Listing rooms across all vaults, extra status/type filters, custom sorting, and column selection remain pending. Page results and totals are separate reads, not a guaranteed snapshot during concurrent changes.
- Direct calls, webinars, scheduling, settings changes, LiveKit integration, invite notifications, attendance, audit entries, and automatic reconciliation remain pending.
- Production authentication, user creation, vault provisioning, and permission management remain separate work.
- The seed script requires already migrated databases. It does not create Turso databases, apply migrations, create a room, or expose a seed HTTP endpoint. It seeds only a vault mapping for the host; guests are invited into that vault's rooms.
- Main and vault cannot share a transaction. A process crash or cleanup failure can leave an unused route without a room, or an active route pointing at a soft-deleted room; automatic reconciliation is pending.
- Review and test joining before implementing the next method or endpoint.
