import type { RedisClient } from 'bun';
import type { Static } from 'elysia';
import type { create_database_client } from '@db/client.db';
import type { lib_dto_payload } from '@lib/dto.lib';
import { lib_error } from '@lib/error.lib';
import { lib_livekit_broadcast, lib_livekit_identity } from '@lib/livekit.lib';
import { room_topic, type type_room_event_message } from '@contracts/room';
import { dto_message } from '@module/main/message/message.dto';
import { service_room } from '@module/main/participants/room.service';

const message_active_status = 'active';

export const service_message = {
  async find(
    query: Static<typeof dto_message.find.query>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_message.find.response>> {
    if (query.before_message_id && query.after_message_id) {
      throw lib_error.bad_request;
    }

    const { vault, room } = await service_room.authorize(
      query.room_uid,
      payload,
      database,
      redis,
    );
    const take = query.take ?? 50;
    const where = {
      room_id: room.room_id,
      deleted_at: null,
      ...(query.before_message_id
        ? { message_id: { lt: query.before_message_id } }
        : {}),
      ...(query.after_message_id
        ? { message_id: { gt: query.after_message_id } }
        : {}),
    };
    const [rows, messages] = await Promise.all([
      vault.message.count({ where }),
      vault.message.findMany({
        where,
        orderBy: { message_id: 'desc' },
        take,
      }),
    ]);

    return {
      rows,
      pages: Math.ceil(rows / take),
      page: 1,
      take,
      data: messages.map((message) => ({
        message_id: message.message_id,
        room_uid: room.room_uid,
        user_id: message.user_id,
        message_client_id: message.message_client_id,
        message_text: message.message_text,
        created_at: message.created_at,
      })),
    };
  },

  async create(
    body: Static<typeof dto_message.create.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_message.create.response>> {
    const { vault, room, member } = await service_room.authorize(
      body.room_uid,
      payload,
      database,
      redis,
    );
    if (room.room_status !== 'live') throw lib_error.room_not_open;
    if (member.room_member_status !== message_active_status)
      throw lib_error.forbidden;

    const recipient = await vault.roomMember.findFirst({
      where: {
        room_id: room.room_id,
        user_id: body.recipient_user_id,
        deleted_at: null,
        room_member_banned_at: null,
        room_member_status: message_active_status,
      },
      select: { room_member_id: true },
    });
    if (!recipient) throw lib_error.forbidden;

    const message = await vault.message.upsert({
      where: {
        room_id_user_id_message_client_id: {
          room_id: room.room_id,
          user_id: payload.user_id,
          message_client_id: body.message_client_id,
        },
      },
      create: {
        room_id: room.room_id,
        user_id: payload.user_id,
        message_client_id: body.message_client_id,
        message_text: body.message_text.trim(),
      },
      update: {},
    });

    const data: Static<typeof dto_message.create.response>['data'] = {
      message_id: message.message_id,
      room_uid: room.room_uid,
      user_id: message.user_id,
      recipient_user_id: body.recipient_user_id,
      message_client_id: message.message_client_id,
      message_text: message.message_text,
      created_at: message.created_at,
    };
    const event: type_room_event_message = {
      type: 'message.created',
      ...data,
      created_at: data.created_at.toISOString(),
    };

    await lib_livekit_broadcast(room.room_uid, room_topic.message, event, [
      lib_livekit_identity(body.recipient_user_id),
    ]);

    return { data };
  },
};
