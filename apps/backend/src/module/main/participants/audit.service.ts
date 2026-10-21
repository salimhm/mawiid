import type { RedisClient } from 'bun'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'
import { lib_livekit_identity } from '@lib/livekit.lib'
import { dto_audit } from '@module/main/participants/audit.dto'
import { service_room, type room_vault } from '@module/main/participants/room.service'

const audit_attempts = 3

export type audit_entry = {
  room_id: number
  room_uid: string
  target_user_id: number | null
  action: string
  metadata?: Record<string, unknown>
}

export const service_audit = {
  data(entry: audit_entry, payload: lib_dto_payload | null) {
    return {
      room_id: entry.room_id,
      user_id: payload?.user_id ?? null,
      audit_action: entry.action,
      audit_target: entry.target_user_id ? lib_livekit_identity(entry.target_user_id) : `room_${entry.room_uid}`,
      audit_metadata: { room_uid: entry.room_uid, ...entry.metadata },
    }
  },

  async create(vault: room_vault, entry: audit_entry, payload: lib_dto_payload | null) {
    const data = service_audit.data(entry, payload)
    for (let attempt = 1; ; attempt++) {
      try {
        return await vault.audit.create({ data })
      } catch (error) {
        if (attempt >= audit_attempts) {
          console.error('Could not write an audit row', JSON.stringify(data), error)
          throw lib_error.internal_server_error
        }
        await Bun.sleep(100 * attempt)
      }
    }
  },

  async find(
    query: Static<typeof dto_audit.find.query>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_audit.find.response>> {
    const { vault, room, member } = await service_room.authorize(query.room_uid, payload, database, redis)
    if (member.room_member_role !== 'host') {
      const access = await vault.access.findFirst({ where: { user_id: payload.user_id, deleted_at: null } })
      const actions = Array.isArray(access?.actions) ? access.actions : []
      if (!actions.includes('audit.find')) throw lib_error.forbidden
    }
    const page = query.page ?? 1
    const take = query.take ?? 20
    const where = {
      room_id: room.room_id,
      deleted_at: null,
      ...(query.audit_action?.length ? { audit_action: { in: query.audit_action } } : {}),
    }
    const [rows, data] = await Promise.all([
      vault.audit.count({ where }),
      vault.audit.findMany({ where, orderBy: { audit_id: 'desc' }, skip: (page - 1) * take, take }),
    ])
    return { rows, pages: Math.ceil(rows / take), page, take, data }
  },
}
