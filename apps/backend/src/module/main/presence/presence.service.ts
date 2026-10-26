import type { RedisClient } from 'bun';
import type { Static } from 'elysia';
import type { create_database_client } from '@db/client.db';
import type { lib_dto_payload } from '@lib/dto.lib';
import { enum_presence_status } from '@lib/enum.lib';
import { lib_error } from '@lib/error.lib';
import { lib_rate_limit } from '@lib/rate-limit.lib';
import {
  dto_presence,
  type dto_schema_presence,
} from '@module/main/presence/presence.dto';

type type_database = ReturnType<typeof create_database_client>;
type type_presence = Static<typeof dto_schema_presence>;
type type_presence_status = (typeof enum_presence_status)[number];
type type_presence_server = { publish(topic: string, data: string): unknown };

export type type_presence_socket_user = {
  user_id: number;
  topics: string[];
  organization_topics: string[];
};

const presence_channel = 'ws:event';
const presence_ticket_seconds = 30;
const presence_heartbeat_seconds = 45;
const presence_live_seconds = 6 * 60 * 60;
const presence_sweep_limit = 100;

const presence_key = {
  ticket: (ticket: string) => `ws_ticket:${ticket}`,
  heartbeat: (user_id: number) => `presence:user:${user_id}`,
  choice: (user_id: number) => `presence:choice:${user_id}`,
  sockets: (user_id: number) => `presence:sockets:${user_id}`,
  live: (user_id: number) => `user:${user_id}:live`,
  seen: 'presence:seen',
};

function presence_status_of(
  heartbeat: string | null,
  choice: string | null,
  live: string | null,
): type_presence_status {
  if (!heartbeat || choice === 'offline') return 'offline';
  if (live) return 'busy';
  return enum_presence_status.find((status) => status === choice) ?? 'online';
}

function presence_heartbeat_value(choice: string | null) {
  return JSON.stringify({
    presence_status: presence_status_of('1', choice, null),
    presence_updated_at: new Date().toISOString(),
  });
}

function presence_updated_at(heartbeat: string) {
  const value: unknown = JSON.parse(heartbeat);
  if (
    typeof value === 'object' &&
    value !== null &&
    'presence_updated_at' in value
  ) {
    return String(value.presence_updated_at);
  }
  return null;
}

async function presence_memberships(user_id: number, database: type_database) {
  return await database.main_db.member.findMany({
    where: { user_id, deleted_at: null, department: { deleted_at: null } },
    select: {
      department_id: true,
      department: { select: { organization_id: true } },
    },
  });
}

async function presence_topics(user_id: number, database: type_database) {
  const memberships = await presence_memberships(user_id, database);
  const department_topics = memberships.map(
    (membership) => `department:${membership.department_id}`,
  );
  const organization_topics = [
    ...new Set(
      memberships.map(
        (membership) => `organization:${membership.department.organization_id}`,
      ),
    ),
  ];
  return {
    topics: [
      `user:${user_id}`,
      ...new Set(department_topics),
      ...organization_topics,
    ],
    organization_topics,
  };
}

async function presence_visible(
  user_id: number,
  user_ids: number[],
  database: type_database,
) {
  const memberships = await presence_memberships(user_id, database);
  const organization_ids = [
    ...new Set(
      memberships.map((membership) => membership.department.organization_id),
    ),
  ];
  const teammates = await database.main_db.member.findMany({
    where: {
      user_id: { in: user_ids },
      deleted_at: null,
      department: {
        deleted_at: null,
        organization_id: { in: organization_ids },
      },
    },
    select: { user_id: true },
  });
  const allowed = new Set([
    user_id,
    ...teammates.map((teammate) => teammate.user_id),
  ]);
  return user_ids.filter((id) => allowed.has(id));
}

async function presence_read(
  user_ids: number[],
  redis: RedisClient,
): Promise<type_presence[]> {
  if (user_ids.length === 0) return [];
  const [heartbeats, choices, lives] = await Promise.all([
    redis.mget(...user_ids.map(presence_key.heartbeat)),
    redis.mget(...user_ids.map(presence_key.choice)),
    redis.mget(...user_ids.map(presence_key.live)),
  ]);
  return user_ids.map((user_id, index) => {
    const heartbeat = heartbeats[index] ?? null;
    const presence_status = presence_status_of(
      heartbeat,
      choices[index] ?? null,
      lives[index] ?? null,
    );
    return {
      user_id,
      presence_status,
      presence_updated_at:
        heartbeat && presence_status !== 'offline'
          ? presence_updated_at(heartbeat)
          : null,
    };
  });
}

async function presence_read_one(
  user_id: number,
  redis: RedisClient,
): Promise<type_presence> {
  const [presence] = await presence_read([user_id], redis);
  return (
    presence ?? {
      user_id,
      presence_status: 'offline',
      presence_updated_at: null,
    }
  );
}

async function presence_broadcast(
  user_id: number,
  organization_topics: string[],
  redis: RedisClient,
) {
  const presence = await presence_read_one(user_id, redis);
  await service_presence.notify(
    [`user:${user_id}`, ...organization_topics],
    'presence.updated',
    presence,
    redis,
  );
}

async function presence_ping(
  user_id: number,
  organization_topics: string[],
  redis: RedisClient,
) {
  const alive = await redis.expire(
    presence_key.heartbeat(user_id),
    presence_heartbeat_seconds,
  );
  await Promise.all([
    redis.expire(presence_key.sockets(user_id), presence_heartbeat_seconds),
    redis.send('ZADD', [
      presence_key.seen,
      String(Date.now()),
      String(user_id),
    ]),
  ]);
  if (alive) return;
  const choice = await redis.get(presence_key.choice(user_id));
  await redis.set(
    presence_key.heartbeat(user_id),
    presence_heartbeat_value(choice),
    'EX',
    presence_heartbeat_seconds,
  );
  await presence_broadcast(user_id, organization_topics, redis);
}

async function presence_choose(
  user_id: number,
  organization_topics: string[],
  presence_status: type_presence_status,
  redis: RedisClient,
) {
  await lib_rate_limit(redis, `presence:${user_id}`, 30, 60);
  if (presence_status === 'online')
    await redis.del(presence_key.choice(user_id));
  else await redis.set(presence_key.choice(user_id), presence_status);
  if (await redis.exists(presence_key.heartbeat(user_id))) {
    await redis.set(
      presence_key.heartbeat(user_id),
      presence_heartbeat_value(presence_status),
      'EX',
      presence_heartbeat_seconds,
    );
  }
  await presence_broadcast(user_id, organization_topics, redis);
}

export const service_presence = {
  async ticket(
    payload: lib_dto_payload,
    redis: RedisClient,
  ): Promise<Static<(typeof dto_presence.ticket.response)[200]>> {
    await lib_rate_limit(redis, `ticket:${payload.user_id}`, 10, 60);
    const ticket = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url');
    await redis.set(
      presence_key.ticket(ticket),
      String(payload.user_id),
      'EX',
      presence_ticket_seconds,
    );
    return { data: { ticket, expires_in: presence_ticket_seconds } };
  },

  async connect(
    ticket: string,
    database: type_database,
    redis: RedisClient,
  ): Promise<type_presence_socket_user> {
    const user_id = Number(await redis.getdel(presence_key.ticket(ticket)));
    if (!Number.isInteger(user_id) || user_id <= 0)
      throw lib_error.invalid_token;
    return { user_id, ...(await presence_topics(user_id, database)) };
  },

  async open(socket_user: type_presence_socket_user, redis: RedisClient) {
    const { user_id, organization_topics } = socket_user;
    const choice = await redis.get(presence_key.choice(user_id));
    await redis.set(
      presence_key.heartbeat(user_id),
      presence_heartbeat_value(choice),
      'EX',
      presence_heartbeat_seconds,
    );
    await redis.incr(presence_key.sockets(user_id));
    await redis.expire(
      presence_key.sockets(user_id),
      presence_heartbeat_seconds,
    );
    await redis.send('ZADD', [
      presence_key.seen,
      String(Date.now()),
      String(user_id),
    ]);
    await presence_broadcast(user_id, organization_topics, redis);
  },

  async message(
    socket_user: type_presence_socket_user,
    message: Static<typeof dto_presence.socket.body>,
    redis: RedisClient,
  ) {
    const { user_id, organization_topics } = socket_user;
    if (message.type === 'presence.ping')
      return await presence_ping(user_id, organization_topics, redis);
    await presence_choose(
      user_id,
      organization_topics,
      message.data.presence_status,
      redis,
    );
  },

  async close(socket_user: type_presence_socket_user, redis: RedisClient) {
    const { user_id, organization_topics } = socket_user;
    const sockets = await redis.decr(presence_key.sockets(user_id));
    if (sockets > 0) return;
    await redis.del(
      presence_key.sockets(user_id),
      presence_key.heartbeat(user_id),
    );
    await redis.send('ZREM', [presence_key.seen, String(user_id)]);
    await presence_broadcast(user_id, organization_topics, redis);
  },

  async find(
    query: Static<typeof dto_presence.find.query>,
    payload: lib_dto_payload,
    database: type_database,
    redis: RedisClient,
  ): Promise<Static<(typeof dto_presence.find.response)[200]>> {
    const user_ids = [...new Set(query.user_id)];
    const visible = await presence_visible(payload.user_id, user_ids, database);
    return { data: await presence_read(visible, redis) };
  },

  async update(
    body: Static<typeof dto_presence.update.body>,
    payload: lib_dto_payload,
    database: type_database,
    redis: RedisClient,
  ): Promise<Static<(typeof dto_presence.update.response)[200]>> {
    const { organization_topics } = await presence_topics(
      payload.user_id,
      database,
    );
    await presence_choose(
      payload.user_id,
      organization_topics,
      body.presence_status,
      redis,
    );
    return { data: await presence_read_one(payload.user_id, redis) };
  },

  async enter_live(
    user_id: number,
    room_uid: string,
    database: type_database,
    redis: RedisClient,
  ) {
    await redis.set(
      presence_key.live(user_id),
      room_uid,
      'EX',
      presence_live_seconds,
    );
    const { organization_topics } = await presence_topics(user_id, database);
    await presence_broadcast(user_id, organization_topics, redis);
  },

  async leave_live(
    user_id: number,
    room_uid: string,
    database: type_database,
    redis: RedisClient,
  ) {
    if ((await redis.get(presence_key.live(user_id))) !== room_uid) return;
    await redis.del(presence_key.live(user_id));
    const { organization_topics } = await presence_topics(user_id, database);
    await presence_broadcast(user_id, organization_topics, redis);
  },

  async notify(
    topics: string[],
    type: string,
    data: unknown,
    redis: RedisClient,
  ) {
    const event = { type, version: 1, data, sent_at: new Date().toISOString() };
    await redis.publish(presence_channel, JSON.stringify({ topics, event }));
  },

  async relay(server: type_presence_server, redis: RedisClient) {
    const subscriber = await redis.duplicate();
    await subscriber.subscribe(presence_channel, (message) => {
      const value: unknown = JSON.parse(message);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('topics' in value) ||
        !('event' in value)
      )
        return;
      if (!Array.isArray(value.topics)) return;
      const event = JSON.stringify(value.event);
      for (const topic of value.topics) server.publish(String(topic), event);
    });
    return subscriber;
  },

  async sweep(database: type_database, redis: RedisClient) {
    const deadline = Date.now() - presence_heartbeat_seconds * 1000;
    const user_ids: string[] = await redis.send('ZRANGEBYSCORE', [
      presence_key.seen,
      '-inf',
      String(deadline),
      'LIMIT',
      '0',
      String(presence_sweep_limit),
    ]);
    for (const id of user_ids) {
      const user_id = Number(id);
      if (await redis.exists(presence_key.heartbeat(user_id))) {
        await redis.send('ZADD', [presence_key.seen, String(Date.now()), id]);
        continue;
      }
      if (Number(await redis.send('ZREM', [presence_key.seen, id])) !== 1)
        continue;
      const { organization_topics } = await presence_topics(user_id, database);
      await presence_broadcast(user_id, organization_topics, redis);
    }
  },

  async start(
    server: type_presence_server,
    database: type_database,
    redis: RedisClient,
  ) {
    const subscriber = await service_presence.relay(server, redis);
    const timer = setInterval(() => {
      void service_presence
        .sweep(database, redis)
        .catch(() => console.error('Presence sweep failed'));
    }, 5000);
    return () => {
      clearInterval(timer);
      subscriber.close();
    };
  },
};
