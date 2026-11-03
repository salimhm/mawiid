# Transcript implementation status

## Implemented

- `POST /transcript/internal`: the AI translation worker (`services/ai`, `mawiid_ai.agent`) saves the final caption segments of a live and their translations in the vault of the room.
- Tables `transcript` and `translation` in the vault database (migration `20261029120000_add_transcript`). One row per segment (`room_id`, `transcript_segment_id` is unique) and one per translation language (`transcript_id`, `translation_language` is unique).
- Saving is idempotent: a segment or translation that already exists is left unchanged, so the worker can resend a batch after a timeout.
- Vaults created before this migration are migrated on their first transcript batch (`apply_migration` on the room's vault, then the batch is saved).
- The worker batches segments every 5 seconds (at most 100 per request) and keeps a batch when the backend is unreachable or answers 5xx or 429. Batches refused with another 4xx are dropped.

## Authentication

Not a user endpoint: there is no JWT. The caller sends `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. The token is compared in constant time (SHA-256 digests). When `INTERNAL_SERVICE_TOKEN` is not set, every request is refused, and the worker still sends live captions but nothing is saved. Expose this route only on the private network in production (`docs/live-chat-plan.md` section 8.4).

## Request and response

```http
POST /transcript/internal
Authorization: Bearer <INTERNAL_SERVICE_TOKEN>
Content-Type: application/json

{
  "room_uid": "00000000-0000-4000-8000-000000000001",
  "segments": [
    {
      "transcript_segment_id": "SG_3f2a9c1d7b4e",
      "user_id": 1,
      "transcript_language": "fr-FR",
      "transcript_text": "Bonjour à tous.",
      "transcript_started_ms": 1200,
      "transcript_ended_ms": 2400,
      "translations": [{ "translation_language": "en-US", "translation_text": "Hello everyone." }]
    }
  ]
}
```

| Status | Body                                     | When                                                        |
| ------ | ---------------------------------------- | ----------------------------------------------------------- |
| 200    | `{ "data": { "saved": 1 } }`             | Saved, or already saved                                     |
| 401    | `{ "code": "unauthorized" }`             | Missing or wrong token, or `INTERNAL_SERVICE_TOKEN` not set |
| 404    | `{ "code": "room-not-found" }`           | Unknown or deleted room                                     |
| 422    | `{ "code": "validation-error", ... }`    | Body does not match the schema (1 to 100 segments)          |

`transcript_started_ms` and `transcript_ended_ms` count from the moment the translator joined the live, not from the start of the room. `user_id` is the speaker, taken from their LiveKit identity (`user_<id>`).

## How to test

1. `make infra`, `make seed`, then `cd apps/backend && bun run postman:dev` (`postman/.env.postman` sets `INTERNAL_SERVICE_TOKEN`).
2. Send the request above with `Bearer postman-local-internal-token-0123456789` and the seeded `room_uid` (`make tokens` prints it).
3. Check the rows: `sqlite3 apps/backend/postman/data/vault.db 'select * from transcript; select * from translation;'`.
4. Full flow: run `make ai`, join the room as the host, turn on live translation (`PATCH /room` with `room_translation_enabled: true`) and speak. Final phrases appear in `transcript` within about 5 seconds.

Unit tests: `bun test src/module/main/transcript`.

## Missing and limitations

- No endpoint reads transcripts yet (for example `GET /transcript` for room members, or a recap after the live).
- The time base is the translator session: if translation is turned off and on again, the next session starts again at 0. `created_at` keeps the real order.
- The speaker's membership is not re-checked: the worker is trusted through the internal token.
