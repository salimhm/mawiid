import type { RedisClient } from 'bun'
import type { Static } from 'elysia'
import type { WebhookEvent } from 'livekit-server-sdk'
import type { create_database_client } from '@db/client.db'
import type { Room, RoomMember } from '@db/generated/tenant/client.ts'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'
import {
  lib_livekit_call,
  lib_livekit_identity,
  lib_livekit_participant,
  lib_livekit_remove,
  lib_livekit_role,
  lib_livekit_room,
  lib_livekit_track_source,
  lib_livekit_user_id,
  lib_livekit_webhook,
} from '@lib/livekit.lib'
import { room_attribute } from '@contracts/room'
import { service_audit } from '@module/main/participants/audit.service'
import { dto_participant } from '@module/main/participants/participant.dto'
import { service_room_member } from '@module/main/participants/room-member.service'
import { service_room_route } from '@module/main/participants/room-route.service'
import { service_room, type room_vault } from '@module/main/participants/room.service'

const webhook_ttl_seconds = 86400

function participant_data(room: Room, member: RoomMember, attributes: Record<string, string> = {}) {
  return {
    room_uid: room.room_uid,
    user_id: member.user_id,
    room_member_role: member.room_member_role,
    participant_attributes: attributes,
  }
}

export const service_participant = {
  async update(
    body: Static<typeof dto_participant.update.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_participant.update.response>> {
    const { room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const attributes: Record<string, string> = {}
    if (body.participant_hand_raised !== undefined) {
      attributes[room_attribute.hand_raised] = body.participant_hand_raised ? 'true' : ''
    }
    if (body.participant_language) attributes[room_attribute.language] = body.participant_language
    if (Object.keys(attributes).length === 0) throw lib_error.bad_request
    const info = await lib_livekit_call(() =>
      lib_livekit_room.updateParticipant(room.room_uid, lib_livekit_identity(payload.user_id), { attributes }),
    )
    if (!info) throw lib_error.participant_not_found
    return { data: participant_data(room, member, info.attributes) }
  },

  async delete(
    body: Static<typeof dto_participant.delete.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_participant.delete.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const target = await service_room_member.target(vault, room, body.user_id)
    service_room.moderate(member, target)
    if (body.block_minutes) {
      await redis.set(service_room.block_key(room.room_uid, target.user_id), String(payload.user_id), 'EX', body.block_minutes * 60)
    }
    const removed = await lib_livekit_remove(room.room_uid, target.user_id)
    if (removed === null && !body.block_minutes) throw lib_error.participant_not_found
    await service_audit.create(
      vault,
      {
        room_id: room.room_id,
        room_uid: room.room_uid,
        target_user_id: target.user_id,
        action: 'participant.remove',
        metadata: { connected: removed !== null, block_minutes: body.block_minutes ?? null },
      },
      payload,
    )
    return { data: participant_data(room, target) }
  },

  async mute(
    body: Static<typeof dto_participant.mute.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_participant.mute.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const target = await service_room_member.target(vault, room, body.user_id)
    service_room.moderate(member, target)
    const info = await lib_livekit_participant(room.room_uid, target.user_id)
    if (!info) throw lib_error.participant_not_found
    let track_sids: string[] = []
    if (body.muted) {
      const source = lib_livekit_track_source[body.track_source]
      track_sids = info.tracks.filter((track) => track.source === source && !track.muted).map((track) => track.sid)
      if (track_sids.length === 0 && !info.tracks.some((track) => track.source === source)) {
        throw lib_error.track_not_found
      }
      for (const track_sid of track_sids) {
        await lib_livekit_call(() =>
          lib_livekit_room.mutePublishedTrack(room.room_uid, lib_livekit_identity(target.user_id), track_sid, true),
        )
      }
    }
    await service_room_member.notify(room, target.user_id, {
      type: body.muted ? 'participant.muted' : 'participant.unmute_requested',
      room_uid: room.room_uid,
      track_source: body.track_source,
    })
    await service_audit.create(
      vault,
      {
        room_id: room.room_id,
        room_uid: room.room_uid,
        target_user_id: target.user_id,
        action: body.muted ? 'participant.mute' : 'participant.unmute_request',
        metadata: { track_source: body.track_source, track_sids },
      },
      payload,
    )
    return { data: participant_data(room, target, info.attributes) }
  },

  async promote(
    body: Static<typeof dto_participant.promote.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_participant.promote.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const target = await service_room_member.target(vault, room, body.user_id)
    service_room.moderate(member, target)
    if (target.room_member_role !== 'viewer') throw lib_error.bad_request
    const data = await service_room_member.role(vault, room, target, 'member', 'participant.promote', payload)
    return { data: participant_data(room, data) }
  },

  async demote(
    body: Static<typeof dto_participant.demote.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_participant.demote.response>> {
    const { vault, room, member } = await service_room.authorize(body.room_uid, payload, database, redis)
    const target = await service_room_member.target(vault, room, body.user_id)
    service_room.moderate(member, target)
    if (!['member', 'moderator'].includes(target.room_member_role)) throw lib_error.bad_request
    const data = await service_room_member.role(vault, room, target, 'viewer', 'participant.demote', payload)
    return { data: participant_data(room, data) }
  },

  async join(event: WebhookEvent, database: ReturnType<typeof create_database_client>, redis: RedisClient) {
    const room_uid = event.room?.name
    const identity = event.participant?.identity
    const user_id = identity ? lib_livekit_user_id(identity) : null
    if (!room_uid || !user_id) return false
    let vault: room_vault | null = null
    try {
      vault = await service_room_route.find(room_uid, database, redis)
    } catch (error) {
      if (error !== lib_error.room_not_found) throw error
    }
    const room = vault ? await vault.room.findFirst({ where: { room_uid, deleted_at: null } }) : null
    let member: RoomMember | null = null
    if (room) {
      try {
        member = (await service_room.authorize(room_uid, { user_id }, database, redis)).member
      } catch (error) {
        if (error !== lib_error.forbidden) throw error
      }
    }
    const allowed =
      room !== null &&
      member !== null &&
      room.room_status !== 'closed' &&
      member.room_member_status !== 'declined' &&
      (!room.room_lobby_enabled || service_room.staff(member.room_member_role) || member.room_member_status === 'active')
    if (!room || !member || !allowed) {
      await lib_livekit_remove(room_uid, user_id)
      if (vault && room) {
        await service_audit.create(
          vault,
          {
            room_id: room.room_id,
            room_uid,
            target_user_id: user_id,
            action: 'participant.enforce_remove',
            metadata: { participant_sid: event.participant?.sid ?? null },
          },
          null,
        )
      }
      return true
    }
    if (event.participant?.attributes[room_attribute.role] !== member.room_member_role) {
      await lib_livekit_role(room_uid, user_id, member.room_member_role)
    }
    return false
  },

  async webhook(
    body: string,
    authorization: string | undefined,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_participant.webhook.response>> {
    let event: WebhookEvent
    try {
      event = await lib_livekit_webhook.receive(body, authorization)
    } catch {
      throw lib_error.invalid_token
    }
    const key = `webhook:${event.id}`
    const fresh = await redis.send('SET', [key, '1', 'EX', String(webhook_ttl_seconds), 'NX'])
    if (!fresh) return { data: { duplicate: true, removed: false } }
    try {
      const removed = event.event === 'participant_joined' ? await service_participant.join(event, database, redis) : false
      return { data: { duplicate: false, removed } }
    } catch (error) {
      await redis.del(key)
      throw error
    }
  },
}
