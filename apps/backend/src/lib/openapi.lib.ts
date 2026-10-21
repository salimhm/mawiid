import { openapi } from '@elysiajs/openapi';

export const lib_openapi_security = [{ dev_user: [] }];

export const lib_openapi = openapi({
  enabled: process.env.ENV === 'dev' || process.env.OPENAPI_ENABLED === 'true',
  path: '/openapi',
  exclude: {
    paths: ['/presence/ws'],
  },
  documentation: {
    info: {
      title: 'Mawiid API',
      version: '0.1.0',
      description:
        'Mawiid backend API. Until real authentication exists, send the dev header `x-user-id` (only accepted when `ENV=dev`). Errors return `{ code }` with the matching HTTP status.',
    },
    tags: [
      {
        name: 'health',
        description: 'Liveness of the backend.',
      },
      {
        name: 'presence',
        description:
          'Online status and the WebSocket gateway. Real-time events are sent on `WS /presence/ws?ticket=<ticket>`: get a ticket with `POST /presence/ticket`, then send `{ "type": "presence.ping" }` every 20 s or `{ "type": "presence.status", "data": { "presence_status": "away" } }`. The server sends `{ type, version, data, sent_at }` events such as `presence.updated` and `room.ring`.',
      },
    ],
    components: {
      securitySchemes: {
        dev_user: {
          type: 'apiKey',
          in: 'header',
          name: 'x-user-id',
          description: 'Dev only: the id of the user to act as.',
        },
      },
    },
  },
});
