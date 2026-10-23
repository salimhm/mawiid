# OpenAPI implementation status

## Implemented

- Main's existing `@elysiajs/openapi` integration remains registered before the controllers in `apps/backend/src/app.ts`.
- `GET /openapi` serves the interactive Scalar page; `GET /openapi/json` serves the generated specification.
- The current registered HTTP API routes are `GET /health`, `POST /presence/ticket`, `GET /presence`, `PATCH /presence`, `POST /room`, `GET /room`, `PATCH /room`, `DELETE /room`, and `POST /room/join`.
- Room creation includes a summary, permission requirements, an example, its own response schema, and the existing `dev_user` authentication scheme.
- Room > Find my rooms documents the required `vault_id`, optional `room_uid`, and `page`/`take` query parameters. Its response includes the caller's accessible rooms and pagination totals. It uses the same `dev_user` authentication scheme and does not require creation permission.
- Room > Rename a room accepts `vault_id`, `room_uid`, and `room_title`. Only an eligible host or moderator may rename the room. It returns the updated room using the existing `dev_user` authentication scheme.
- Room > Delete a room accepts `vault_id` and `room_uid`. Only an eligible host may soft-delete scheduled or closed rooms; moderators are refused. Scheduled rooms are canceled; membership history is retained. Open/live rooms return `409 room-not-deletable`. Main route cleanup is best effort after tenant deletion.
- Room > Join a room accepts `vault_id` and `room_uid`. An existing eligible member can join an open/live room as active, or waiting with a lobby; hosts and moderators bypass the lobby. Locked rooms allow only the host. The response is the caller's membership, without LiveKit connection tokens.
- Development authentication uses the numeric `x-user-id` header with `ENV=dev`. There is no user JWT authentication on this branch.
- `/presence/ws` is implemented but deliberately excluded from the HTTP specification. It uses a ticket from `POST /presence/ticket`.

## How to use

1. Start the backend with `bun run dev` from `apps/backend`.
2. Open `http://localhost:3000/openapi`, or use the WSL IP if Windows localhost forwarding is unavailable.
3. For room creation, select `POST /room` under Room and enter an active user's numeric ID in the `x-user-id` authentication control. That user needs `room.create` access in the selected vault.
4. Use real test fixture IDs in the example body. The room migrations must be applied to the main and selected vault databases first; see the Room module's `implementation.md`.
5. Open `/openapi/json` to inspect or import the specification.
6. To find rooms, select GET /room under Room, enter `vault_id`, and send the request with the existing user's `x-user-id`. Use `page=1` and `take=20`, or supply a room UUID to filter the list. Invited users can see their rooms; nonmembers receive an empty list.
7. To rename, select PATCH /room under Room and use a host or moderator's `x-user-id`. Copy a room UUID from GET /room and send it with the vault ID and new title. An ordinary invited member receives 403.
8. To delete, select DELETE /room under Room and send the vault ID and room UUID as its host. Expect 200 with `deleted_at` for a scheduled/closed fixture, then no match in GET and 404 on repeated deletion. Newly created rooms are open and return 409; scheduling/closing endpoints are still pending. Guests receive 403. See the module notes for local verification.
9. To join, create a room with guest 2 invited, then select POST /room/join and authenticate as that guest. Send the vault ID and returned UUID. Expect 200 with the existing member role and active status. Repeat to confirm the same membership ID; nonmembers receive 403. Closed rooms return 410, scheduled rooms 409, locked rooms 423 for non-hosts, and full rooms 409 for new activations. Retry a 503 transaction conflict. Lobby waiting returns 200 with waiting status; it does not mean media admission.

## Verification and limitations

- A fresh test app returned the documentation page and JSON specification, including the registered room creation request schema and `dev_user` requirement.
- A fresh test app also verified the generated GET /room query parameters and `dev_user` requirement against real local database fixtures.
- A fresh test app verified the generated PATCH /room required body fields and `dev_user` requirement, plus real local database renaming and permission checks.
- A fresh test app verified the generated DELETE /room required body fields and `dev_user` requirement, plus persisted deletion, host-only permissions, lifecycle conflicts, and route cleanup against disposable local databases.
- A fresh test app verified POST /room/join documentation, required body fields, `dev_user` security, and persisted waiting status using the authenticated caller. Real local checks also verified role restrictions, active membership capacity, repeated joins, and competing joins from independent clients.
- Joining is limited to database membership in this increment. LiveKit tokens, media connection, lobby admission, attendance, and presence integration remain pending.
- The OpenAPI library's existing enablement setting is unchanged by the Rooms review.
- Participants, moderation, event, and webhook routes from `skamroun` are not registered on `rooms-module`.
- OpenAPI does not document the complete WebSocket message protocol. See the existing presence documentation for that contract.
- Scalar loads its frontend bundle from a CDN. Restart `bun run dev` if WSL watch has not detected the new controller registration.
