import type { RedisClient } from 'bun'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import type { Room, RoomMember } from '@db/generated/tenant/client.ts'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'
import { lib_livekit_broadcast, lib_livekit_identity, lib_livekit_remove, lib_livekit_role } from '@lib/livekit.lib'
import { room_socket_event, room_topic, type type_room_event_moderation } from '@contracts/room'
import { service_audit, type audit_entry } from '@module/main/participants/audit.service'
import { service_event } from '@module/main/participants/event.service'
import { dto_room_member } from '@module/main/participants/room-member.dto'
import { service_room, type room_vault } from '@module/main/participants/room.service'

const room_member_privileged_roles = ['host', 'moderator']
const room_member_status_from: Record<string, string[]> = {
  active: ['invited', 'waiting', 'declined'],
  declined: ['invited', 'waiting'],
}

export const service_room_member = {
  async target(vault: room_vault, room: Room, user_id: number) {
    const target = await vault.roomMember.findFirst({ where: { room_id: room.room_id, user_id, deleted_at: null } })
    if (!target) throw lib_error.room_member_not_found
    return target
  },

  async notify(room: Room, user_id: number, event: type_room_event_moderation) {
    try {
      await lib_livekit_broadcast(room.room_uid, room_topic.moderation, event, [lib_livekit_identity(user_id)])
    } catch {
      console.error('Could not send a moderation notice', room.room_uid, user_id)
    }
  },

  async role(
    vault: room_vault,
    room: Room,
    target: RoomMember,
    role: string,
    action: string,
    payload: lib_dto_payload,
  ) {
    const [data] = await vault.$transaction([
      vault.roomMember.update({ where: { room_member_id: target.room_member_id }, data: { room_member_role: role } }),
      vault.audit.create({
        data: service_audit.data(
          {
            room_id: room.room_id,
            room_uid: room.room_uid,
            target_user_id: target.user_id,
            action,
            metadata: { previous_role: target.room_member_role, next_role: role },
          },
          payload,
        ),
      }),
    ])
    const connected = await lib_livekit_role(room.room_uid, target.user_id, role)
    if (connected) {
      await service_room_member.notify(room, target.user_id, {
        type: 'participant.role_changed',
        room_uid: room.room_uid,
        room_member_role: role,
      })
    }
    return data
  },

  async update(
    body: Static<typeof dto_room_member.update.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_room_member.update.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const target = await service_room_member.target(vault, room, body.user_id)
    service_room.moderate(member, target)
    if (!body.room_member_role && !body.room_member_status) throw lib_error.bad_request
    const role = body.room_member_role && body.room_member_role !== target.room_member_role ? body.room_member_role : null
    const status =
      body.room_member_status && body.room_member_status !== target.room_member_status ? body.room_member_status : null
    if (role && member.room_member_role !== 'host') {
      if ([role, target.room_member_role].some((value) => room_member_privileged_roles.includes(value))) {
        throw lib_error.forbidden
      }
    }
    if (status && !room_member_status_from[status]?.includes(target.room_member_status)) throw lib_error.bad_request
    let data = target
    if (status) {
      const entry: audit_entry = {
        room_id: room.room_id,
        room_uid: room.room_uid,
        target_user_id: target.user_id,
        action: status === 'active' ? 'lobby.admit' : 'lobby.deny',
        metadata: { previous_status: target.room_member_status, next_status: status },
      }
      const [updated] = await vault.$transaction([
        vault.roomMember.update({ where: { room_member_id: target.room_member_id }, data: { room_member_status: status } }),
        vault.audit.create({ data: service_audit.data(entry, payload) }),
      ])
      data = updated
      if (status === 'active') {
        await service_event.publish(redis, [target.user_id], room_socket_event.admitted, { room_uid: room.room_uid })
      }
    }
    if (role) data = await service_room_member.role(vault, room, data, role, 'room_member.role', payload)
    return { data }
  },

  async delete(
    body: Static<typeof dto_room_member.delete.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_room_member.delete.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const target = await vault.roomMember.findFirst({
      where: { room_id: room.room_id, user_id: body.user_id },
      orderBy: { room_member_id: 'desc' },
    })
    if (!target) throw lib_error.room_member_not_found
    service_room.moderate(member, target)
    let data = target
    const ban = body.ban === true && !target.room_member_banned_at
    if (target.deleted_at === null || ban) {
      const now = new Date()
      const [updated] = await vault.$transaction([
        vault.roomMember.update({
          where: { room_member_id: target.room_member_id },
          data: { deleted_at: target.deleted_at ?? now, ...(ban ? { room_member_banned_at: now } : {}) },
        }),
        vault.audit.create({
          data: service_audit.data(
            {
              room_id: room.room_id,
              room_uid: room.room_uid,
              target_user_id: target.user_id,
              action: ban ? 'room_member.ban' : 'room_member.delete',
              metadata: { room_member_role: target.room_member_role, ban },
            },
            payload,
          ),
        }),
      ])
      data = updated
    }
    await lib_livekit_remove(room.room_uid, target.user_id)
    return { data }
  },
}
