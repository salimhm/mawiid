import type { RedisClient } from 'bun';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { create_database_client } from '@db/client.db';
import { lib_error } from '@lib/error.lib';
import { service_presence, type type_presence_socket_user } from '@module/main/presence/presence.service';

type type_member = { user_id: number; department_id: number; organization_id: number };
type type_event = { topics: string[]; event: { type: string; data: { user_id: number; presence_status: string } } };

function create_fake_redis() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const sorted = new Map<string, Map<string, number>>();
  const published: type_event[] = [];
  const zset = (key: string) => {
    const existing = sorted.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    sorted.set(key, created);
    return created;
  };
  const redis = {
    async set(key: string, value: string, ...options: (string | number)[]) {
      values.set(key, value);
      const ex = options.indexOf('EX');
      if (ex >= 0) ttls.set(key, Number(options[ex + 1]));
      return 'OK';
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async getdel(key: string) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
    async mget(...keys: string[]) {
      return keys.map((key) => values.get(key) ?? null);
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) if (values.delete(key)) removed += 1;
      return removed;
    },
    async exists(key: string) {
      return values.has(key);
    },
    async incr(key: string) {
      const next = Number(values.get(key) ?? 0) + 1;
      values.set(key, String(next));
      return next;
    },
    async decr(key: string) {
      const next = Number(values.get(key) ?? 0) - 1;
      values.set(key, String(next));
      return next;
    },
    async expire(key: string, seconds: number) {
      if (!values.has(key)) return 0;
      ttls.set(key, seconds);
      return 1;
    },
    async publish(_channel: string, message: string) {
      published.push(JSON.parse(message));
      return 1;
    },
    async send(command: string, args: string[]) {
      const [key = '', first = '', second = ''] = args;
      if (command === 'ZADD') zset(key).set(second, Number(first));
      if (command === 'ZREM') return zset(key).delete(first) ? 1 : 0;
      if (command === 'ZRANGEBYSCORE') {
        return [...zset(key).entries()].filter(([, score]) => score <= Number(second)).map(([member]) => member);
      }
      return 1;
    },
  };
  return { redis: redis as unknown as RedisClient, values, ttls, sorted, published };
}

function create_fake_database(members: type_member[]) {
  const database = {
    main_db: {
      member: {
        async findMany(args: { where: { user_id: number | { in: number[] }; department: { organization_id?: { in: number[] } } } }) {
          const { user_id, department } = args.where;
          return members
            .filter((member) => (typeof user_id === 'number' ? member.user_id === user_id : user_id.in.includes(member.user_id)))
            .filter((member) => !department.organization_id || department.organization_id.in.includes(member.organization_id))
            .map((member) => ({
              user_id: member.user_id,
              department_id: member.department_id,
              department: { organization_id: member.organization_id },
            }));
        },
      },
    },
  };
  return database as unknown as ReturnType<typeof create_database_client>;
}

const members: type_member[] = [
  { user_id: 1, department_id: 10, organization_id: 100 },
  { user_id: 2, department_id: 11, organization_id: 100 },
  { user_id: 3, department_id: 20, organization_id: 200 },
];

let fake = create_fake_redis();
let database = create_fake_database(members);

async function connect(user_id: number): Promise<type_presence_socket_user> {
  const { data } = await service_presence.ticket({ user_id }, fake.redis);
  return await service_presence.connect(data.ticket, database, fake.redis);
}

function last_presence(user_id: number) {
  return fake.published.filter((item) => item.event.data.user_id === user_id).at(-1);
}

beforeEach(() => {
  fake = create_fake_redis();
  database = create_fake_database(members);
});

describe('presence ticket', () => {
  test('is stored for 30 seconds and works only once', async () => {
    const { data } = await service_presence.ticket({ user_id: 1 }, fake.redis);
    expect(data.expires_in).toBe(30);
    expect(fake.ttls.get(`ws_ticket:${data.ticket}`)).toBe(30);
    const socket_user = await service_presence.connect(data.ticket, database, fake.redis);
    expect(socket_user.user_id).toBe(1);
    expect(service_presence.connect(data.ticket, database, fake.redis)).rejects.toEqual(lib_error.invalid_token);
  });

  test('subscribes the socket to user, department and organization topics', async () => {
    const socket_user = await connect(1);
    expect(socket_user.topics).toEqual(['user:1', 'department:10', 'organization:100']);
    expect(socket_user.organization_topics).toEqual(['organization:100']);
  });

  test('is rate limited to 10 per minute', async () => {
    for (let index = 0; index < 10; index += 1) await service_presence.ticket({ user_id: 1 }, fake.redis);
    expect(service_presence.ticket({ user_id: 1 }, fake.redis)).rejects.toEqual(lib_error.too_many_requests);
  });
});

describe('presence status', () => {
  test('a connected user is online for teammates', async () => {
    await service_presence.open(await connect(1), fake.redis);
    const event = last_presence(1);
    expect(event?.topics).toEqual(['user:1', 'organization:100']);
    expect(event?.event.data.presence_status).toBe('online');
    const { data } = await service_presence.find({ user_id: [1] }, { user_id: 2 }, database, fake.redis);
    expect(data[0]?.presence_status).toBe('online');
  });

  test('someone outside the organization cannot see the status', async () => {
    await service_presence.open(await connect(1), fake.redis);
    const { data } = await service_presence.find({ user_id: [1, 3] }, { user_id: 3 }, database, fake.redis);
    expect(data.map((presence) => presence.user_id)).toEqual([3]);
  });

  test('appear offline hides the user and survives a reconnect', async () => {
    const socket_user = await connect(1);
    await service_presence.open(socket_user, fake.redis);
    await service_presence.message(socket_user, { type: 'presence.status', data: { presence_status: 'offline' } }, fake.redis);
    expect(last_presence(1)?.event.data.presence_status).toBe('offline');
    await service_presence.close(socket_user, fake.redis);
    await service_presence.open(await connect(1), fake.redis);
    const { data } = await service_presence.find({ user_id: [1] }, { user_id: 2 }, database, fake.redis);
    expect(data[0]).toEqual({ user_id: 1, presence_status: 'offline', presence_updated_at: null });
  });

  test('joining a live shows busy and leaving shows online again', async () => {
    await service_presence.open(await connect(1), fake.redis);
    await service_presence.enter_live(1, 'room-a', database, fake.redis);
    expect(last_presence(1)?.event.data.presence_status).toBe('busy');
    await service_presence.leave_live(1, 'room-other', database, fake.redis);
    expect(last_presence(1)?.event.data.presence_status).toBe('busy');
    await service_presence.leave_live(1, 'room-a', database, fake.redis);
    expect(last_presence(1)?.event.data.presence_status).toBe('online');
  });

  test('update through PATCH returns the new status', async () => {
    await service_presence.open(await connect(1), fake.redis);
    const { data } = await service_presence.update({ presence_status: 'away' }, { user_id: 1 }, database, fake.redis);
    expect(data.presence_status).toBe('away');
  });
});

describe('presence connection end', () => {
  test('closing one of two devices keeps the user online', async () => {
    const phone = await connect(1);
    const laptop = await connect(1);
    await service_presence.open(phone, fake.redis);
    await service_presence.open(laptop, fake.redis);
    await service_presence.close(phone, fake.redis);
    expect(last_presence(1)?.event.data.presence_status).toBe('online');
    await service_presence.close(laptop, fake.redis);
    expect(last_presence(1)?.event.data.presence_status).toBe('offline');
  });

  test('the sweeper marks a user offline once when pings stop', async () => {
    await service_presence.open(await connect(1), fake.redis);
    fake.values.delete('presence:user:1');
    fake.sorted.get('presence:seen')?.set('1', Date.now() - 60_000);
    const before = fake.published.length;
    await service_presence.sweep(database, fake.redis);
    await service_presence.sweep(database, fake.redis);
    expect(fake.published.length).toBe(before + 1);
    expect(last_presence(1)?.event.data.presence_status).toBe('offline');
  });

  test('a ping refreshes the heartbeat for 45 seconds', async () => {
    const socket_user = await connect(1);
    await service_presence.open(socket_user, fake.redis);
    fake.ttls.set('presence:user:1', 3);
    await service_presence.message(socket_user, { type: 'presence.ping' }, fake.redis);
    expect(fake.ttls.get('presence:user:1')).toBe(45);
  });
});

describe('presence events', () => {
  test('notify wraps data in the versioned envelope', async () => {
    await service_presence.notify(['user:2'], 'room.ring', { room_uid: 'room-a' }, fake.redis);
    const item = fake.published.at(-1) as unknown as { topics: string[]; event: Record<string, unknown> };
    expect(item.topics).toEqual(['user:2']);
    expect(item.event.type).toBe('room.ring');
    expect(item.event.version).toBe(1);
    expect(typeof item.event.sent_at).toBe('string');
  });
});
