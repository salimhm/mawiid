import type { RedisClient } from 'bun'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import type { Room, RoomMember } from '@db/generated/tenant/client.ts'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'
import { lib_livekit_call, lib_livekit_ensure, lib_livekit_room, lib_livekit_token } from '@lib/livekit.lib'
import { room_socket_event } from '@contracts/room'
import { service_audit } from '@module/main/participants/audit.service'
import { service_event } from '@module/main/participants/event.service'
import { service_room_route } from '@module/main/participants/room-route.service'
import { dto_room } from '@module/main/participants/room.dto'

export type room_vault = ReturnType<ReturnType<typeof create_database_client>['vault_db']>

const room_role_rank: Record<string, number> = { host: 3, moderator: 2, member: 1, viewer: 0 }
const room_staff_roles = ['host', 'moderator']
const room_lock_ttl_ms = 5000
const room_knock_ttl_seconds = 10
const room_lock_release = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"

export const service_room = {
  async authorize(
    room_uid: string,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ) {
    const vault = await service_room_route.find(room_uid, database, redis)
    const room = await vault.room.findFirst({ where: { room_uid, deleted_at: null } })
    if (!room) throw lib_error.room_not_found
    const [member, banned, blocked] = await Promise.all([
      vault.roomMember.findFirst({ where: { room_id: room.room_id, user_id: payload.user_id, deleted_at: null } }),
      service_room.banned(vault, room.room_id, payload.user_id),
      redis.exists(service_room.block_key(room_uid, payload.user_id)),
    ])
    if (!member || banned || blocked) throw lib_error.forbidden
    return { vault, room, member }
  },

  block_key(room_uid: string, user_id: number) {
    return `room_block:${room_uid}:${user_id}`
  },

  async banned(vault: room_vault, room_id: number, user_id: number) {
    const row = await vault.roomMember.findFirst({
      where: { room_id, user_id, room_member_banned_at: { not: null } },
      select: { room_member_id: true },
    })
    return row !== null
  },

  staff(role: string) {
    return room_staff_roles.includes(role)
  },

  moderate(actor: RoomMember, target?: RoomMember) {
    if (!service_room.staff(actor.room_member_role)) throw lib_error.forbidden
    if (!target) return
    if (target.user_id === actor.user_id) throw lib_error.forbidden
    const actor_rank = room_role_rank[actor.room_member_role] ?? 0
    const target_rank = room_role_rank[target.room_member_role] ?? 0
    if (actor.room_member_role !== 'host' && target_rank >= actor_rank) throw lib_error.forbidden
  },

  metadata(room: Room) {
    return JSON.stringify({
      room_type: room.room_type,
      room_locked: room.room_locked,
      room_lobby_enabled: room.room_lobby_enabled,
      room_translation_enabled: room.room_translation_enabled,
      room_recording: room.room_recording_allowed,
      room_encrypted: room.room_encrypted,
    })
  },

  async sync(room: Room) {
    try {
      await lib_livekit_call(() => lib_livekit_room.updateRoomMetadata(room.room_uid, service_room.metadata(room)))
    } catch {
      console.error('Could not copy room settings to LiveKit', room.room_uid)
    }
  },

  async update(
    body: Static<typeof dto_room.update.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_room.update.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    service_room.moderate(member)
    if (room.room_status === 'closed') throw lib_error.room_closed
    const previous = { room_locked: room.room_locked, room_lobby_enabled: room.room_lobby_enabled }
    const next = {
      room_locked: body.room_locked ?? room.room_locked,
      room_lobby_enabled: body.room_lobby_enabled ?? room.room_lobby_enabled,
    }
    if (next.room_locked === previous.room_locked && next.room_lobby_enabled === previous.room_lobby_enabled) {
      return { data: room }
    }
    const [data] = await vault.$transaction([
      vault.room.update({ where: { room_id: room.room_id }, data: next }),
      vault.audit.create({
        data: service_audit.data(
          {
            room_id: room.room_id,
            room_uid: room.room_uid,
            target_user_id: null,
            action: 'room.update',
            metadata: { previous, next },
          },
          payload,
        ),
      }),
    ])
    await service_room.sync(data)
    return { data }
  },

  async knock(vault: room_vault, room: Room, user_id: number, redis: RedisClient) {
    const fresh = await redis.send('SET', [`knock:${room.room_uid}:${user_id}`, '1', 'EX', String(room_knock_ttl_seconds), 'NX'])
    if (!fresh) return
    const staff = await vault.roomMember.findMany({
      where: {
        room_id: room.room_id,
        room_member_role: { in: room_staff_roles },
        room_member_banned_at: null,
        deleted_at: null,
      },
      select: { user_id: true },
    })
    await service_event.publish(
      redis,
      staff.map((row) => row.user_id),
      room_socket_event.knock,
      { room_uid: room.room_uid, user_id },
    )
  },

  async ensure(room: Room, redis: RedisClient) {
    const key = `lock:room:${room.room_uid}`
    const owner = crypto.randomUUID()
    const deadline = Date.now() + room_lock_ttl_ms
    while (Date.now() < deadline) {
      const acquired = await redis.send('SET', [key, owner, 'NX', 'PX', String(room_lock_ttl_ms)])
      if (acquired) {
        try {
          const live = await lib_livekit_ensure({
            room_uid: room.room_uid,
            room_max_participants: room.room_max_participants,
            room_metadata: service_room.metadata(room),
          })
          if (!live) throw lib_error.livekit_unavailable
          return live
        } finally {
          await redis.send('EVAL', [room_lock_release, '1', key, owner])
        }
      }
      await Bun.sleep(100)
    }
    throw lib_error.livekit_unavailable
  },

  async join(
    body: Static<typeof dto_room.join.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_room.join.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    if (room.room_status === 'closed') throw lib_error.room_closed
    if (member.room_member_status === 'declined') throw lib_error.forbidden
    if (room.room_locked && member.room_member_role !== 'host') throw lib_error.room_locked
    const staff = service_room.staff(member.room_member_role)
    if (room.room_lobby_enabled && !staff && member.room_member_status !== 'active') {
      if (member.room_member_status !== 'waiting') {
        await vault.roomMember.update({
          where: { room_member_id: member.room_member_id },
          data: { room_member_status: 'waiting' },
        })
      }
      await service_room.knock(vault, room, member.user_id, redis)
      throw lib_error.room_waiting
    }
    if (member.room_member_status !== 'active') {
      await vault.roomMember.update({
        where: { room_member_id: member.room_member_id },
        data: { room_member_status: 'active' },
      })
    }
    const user = await database.main_db.user.findFirst({ where: { user_id: payload.user_id, deleted_at: null } })
    if (!user) throw lib_error.forbidden
    await service_room.ensure(room, redis)
    const participant_token = await lib_livekit_token(
      room.room_uid,
      {
        user_id: user.user_id,
        user_name: `${user.user_first_name} ${user.user_last_name}`,
        user_language: user.user_language ?? 'en',
      },
      member.room_member_role,
    )
    return {
      data: {
        server_url: process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL!,
        participant_token,
        room,
        room_member_role: member.room_member_role,
      },
    }
  },
}
