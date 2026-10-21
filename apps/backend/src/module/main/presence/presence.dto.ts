import { t } from 'elysia';
import { lib_dto_error_response } from '@lib/dto.lib';
import { enum_presence_status } from '@lib/enum.lib';
import { lib_openapi_security } from '@lib/openapi.lib';

export const dto_schema_presence = t.Object(
  {
    user_id: t.Number({ description: 'User id' }),
    presence_status: t.UnionEnum(enum_presence_status, {
      description: 'Status shown to others; `offline` also covers users who chose to appear offline',
    }),
    presence_updated_at: t.Nullable(
      t.String({ description: 'Last status change (ISO date); null when the user shows as offline' }),
    ),
  },
  { title: 'Presence' },
);

export const dto_presence = {
  ticket: {
    response: {
      200: t.Object({
        data: t.Object({
          ticket: t.String({ description: 'Single-use ticket for `WS /presence/ws?ticket=`' }),
          expires_in: t.Number({ description: 'Seconds before the ticket expires' }),
        }),
      }),
      401: lib_dto_error_response,
      429: lib_dto_error_response,
    },
    detail: {
      tags: ['presence'],
      summary: 'Create a WebSocket ticket',
      description:
        'Returns a random ticket valid once for 30 seconds. Open `WS /presence/ws?ticket=<ticket>` right after. Limit: 10 per minute per user.',
      security: lib_openapi_security,
    },
  },
  socket: {
    query: t.Object({
      ticket: t.String({ minLength: 1 }),
    }),
    body: t.Union([
      t.Object({
        type: t.Literal('presence.ping'),
      }),
      t.Object({
        type: t.Literal('presence.status'),
        data: t.Object({
          presence_status: t.UnionEnum(enum_presence_status),
        }),
      }),
    ]),
    detail: {
      tags: ['presence'],
      summary: 'Presence WebSocket',
      description: 'WebSocket upgrade. Authenticate with a ticket from `POST /presence/ticket`.',
    },
  },
  find: {
    query: t.Object({
      user_id: t.Array(t.Numeric(), {
        minItems: 1,
        maxItems: 200,
        description: 'Repeat the parameter: `?user_id=1&user_id=2`',
      }),
    }),
    response: {
      200: t.Object({
        data: t.Array(dto_schema_presence),
      }),
      401: lib_dto_error_response,
    },
    detail: {
      tags: ['presence'],
      summary: 'Find the status of users',
      description:
        'Returns the status of the caller and of the requested users who share an organization with them. Other ids are left out.',
      security: lib_openapi_security,
    },
  },
  update: {
    body: t.Object({
      presence_status: t.UnionEnum(enum_presence_status),
    }),
    response: {
      200: t.Object({
        data: dto_schema_presence,
      }),
      401: lib_dto_error_response,
      429: lib_dto_error_response,
    },
    detail: {
      tags: ['presence'],
      summary: 'Update my status',
      description:
        'Sets `online`, `away`, `busy` or `offline` (appear offline). The choice survives reconnects. Limit: 30 per minute per user.',
      security: lib_openapi_security,
    },
  },
};
