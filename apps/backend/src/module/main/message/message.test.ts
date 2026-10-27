import { describe, expect, mock, test } from 'bun:test';
import type { RedisClient } from 'bun';
import type { create_database_client } from '@db/client.db';
import { lib_error } from '@lib/error.lib';

const broadcast = mock(async () => null);
const authorize = mock();

mock.module('@lib/livekit.lib', () => ({
  lib_livekit_broadcast: broadcast,
  lib_livekit_identity: (user_id: number) => `user_${user_id}`,
}));

mock.module('@module/main/participants/room.service', () => ({
  service_room: { authorize },
}));

const { service_message } =
  await import('@module/main/message/message.service');

const room_uid = '00000000-0000-4000-8000-000000000001';
const message_client_id = '00000000-0000-4000-8000-000000000002';

function create_fixture() {
  const room_member = {
    findFirst: mock(
      async (): Promise<{ room_member_id: number } | null> => ({
        room_member_id: 2,
      }),
    ),
  };
  const message = {
    upsert: mock(
      async (input: {
        create: {
          room_id: number;
          user_id: number;
          message_client_id: string;
          message_text: string;
        };
      }) => ({
        message_id: 9,
        ...input.create,
        created_at: new Date('2026-10-26T12:00:00.000Z'),
      }),
    ),
    count: mock(async () => 2),
    findMany: mock(async () => [
      {
        message_id: 9,
        room_id: 4,
        user_id: 1,
        message_client_id,
        message_text: 'First message',
        created_at: new Date('2026-10-26T12:00:00.000Z'),
      },
      {
        message_id: 8,
        room_id: 4,
        user_id: 2,
        message_client_id: '00000000-0000-4000-8000-000000000003',
        message_text: 'Older message',
        created_at: new Date('2026-10-26T11:00:00.000Z'),
      },
    ]),
  };
  const vault = { roomMember: room_member, message };
  const database = {} as ReturnType<typeof create_database_client>;
  const redis = {} as RedisClient;

  authorize.mockResolvedValue({
    vault,
    room: { room_id: 4, room_uid, room_status: 'live' },
    member: { room_member_status: 'active' },
  });

  return { database, message, redis, room_member };
}

describe('service_message.create', () => {
  test('persists the message and broadcasts it only to the chosen room member', async () => {
    mock.clearAllMocks();
    const fixture = create_fixture();

    const result = await service_message.create(
      {
        room_uid,
        recipient_user_id: 2,
        message_client_id,
        message_text: ' Hello from Mawiid ',
      },
      { user_id: 1 },
      fixture.database,
      fixture.redis,
    );

    expect(result.data).toEqual({
      message_id: 9,
      room_uid,
      user_id: 1,
      recipient_user_id: 2,
      message_client_id,
      message_text: 'Hello from Mawiid',
      created_at: new Date('2026-10-26T12:00:00.000Z'),
    });
    expect(fixture.room_member.findFirst).toHaveBeenCalledWith({
      where: {
        room_id: 4,
        user_id: 2,
        deleted_at: null,
        room_member_banned_at: null,
        room_member_status: 'active',
      },
      select: { room_member_id: true },
    });
    expect(fixture.message.upsert).toHaveBeenCalledWith({
      where: {
        room_id_user_id_message_client_id: {
          room_id: 4,
          user_id: 1,
          message_client_id,
        },
      },
      create: {
        room_id: 4,
        user_id: 1,
        message_client_id,
        message_text: 'Hello from Mawiid',
      },
      update: {},
    });
    expect(broadcast).toHaveBeenCalledWith(
      room_uid,
      'mawiid.message.v1',
      expect.objectContaining({
        type: 'message.created',
        recipient_user_id: 2,
        message_id: 9,
      }),
      ['user_2'],
    );
  });

  test('broadcasts to the whole room when no recipient is given', async () => {
    mock.clearAllMocks();
    const fixture = create_fixture();

    const result = await service_message.create(
      { room_uid, message_client_id, message_text: 'Hello everyone' },
      { user_id: 1 },
      fixture.database,
      fixture.redis,
    );

    expect(result.data.recipient_user_id).toBeNull();
    expect(fixture.room_member.findFirst).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      room_uid,
      'mawiid.message.v1',
      expect.objectContaining({
        type: 'message.created',
        recipient_user_id: null,
        message_id: 9,
      }),
      undefined,
    );
  });

  test('refuses a recipient who is not an active, unbanned room member', async () => {
    mock.clearAllMocks();
    const fixture = create_fixture();
    fixture.room_member.findFirst.mockResolvedValue(null);

    await expect(
      service_message.create(
        {
          room_uid,
          recipient_user_id: 2,
          message_client_id,
          message_text: 'Hello',
        },
        { user_id: 1 },
        fixture.database,
        fixture.redis,
      ),
    ).rejects.toEqual(lib_error.forbidden);

    expect(fixture.message.upsert).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('refuses messages in a room that is not open or live', async () => {
    mock.clearAllMocks();
    const fixture = create_fixture();
    authorize.mockResolvedValue({
      vault: { roomMember: fixture.room_member, message: fixture.message },
      room: { room_id: 4, room_uid, room_status: 'scheduled' },
      member: { room_member_status: 'active' },
    });

    await expect(
      service_message.create(
        {
          room_uid,
          recipient_user_id: 2,
          message_client_id,
          message_text: 'Hello',
        },
        { user_id: 1 },
        fixture.database,
        fixture.redis,
      ),
    ).rejects.toEqual(lib_error.room_not_open);

    expect(fixture.room_member.findFirst).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('service_message.find', () => {
  test('lists a room history with deleted messages excluded and a before cursor', async () => {
    mock.clearAllMocks();
    const fixture = create_fixture();

    const result = await service_message.find(
      { room_uid, take: 2, before_message_id: 10 },
      { user_id: 1 },
      fixture.database,
      fixture.redis,
    );

    expect(result).toEqual({
      rows: 2,
      pages: 1,
      page: 1,
      take: 2,
      data: [
        {
          message_id: 9,
          room_uid,
          user_id: 1,
          message_client_id,
          message_text: 'First message',
          created_at: new Date('2026-10-26T12:00:00.000Z'),
        },
        {
          message_id: 8,
          room_uid,
          user_id: 2,
          message_client_id: '00000000-0000-4000-8000-000000000003',
          message_text: 'Older message',
          created_at: new Date('2026-10-26T11:00:00.000Z'),
        },
      ],
    });
    const where = {
      room_id: 4,
      deleted_at: null,
      message_id: { lt: 10 },
    };
    expect(fixture.message.count).toHaveBeenCalledWith({ where });
    expect(fixture.message.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { message_id: 'desc' },
      take: 2,
    });
  });

  test('refuses mutually exclusive history cursors', async () => {
    mock.clearAllMocks();
    const fixture = create_fixture();

    await expect(
      service_message.find(
        { room_uid, before_message_id: 9, after_message_id: 8 },
        { user_id: 1 },
        fixture.database,
        fixture.redis,
      ),
    ).rejects.toEqual(lib_error.bad_request);

    expect(authorize).not.toHaveBeenCalled();
    expect(fixture.message.findMany).not.toHaveBeenCalled();
  });
});
