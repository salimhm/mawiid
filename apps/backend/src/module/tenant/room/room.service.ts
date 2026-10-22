import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'
import { dto_room } from '@module/tenant/room/room.dto'

export const service_room = {
  async create(
    body: Static<typeof dto_room.create.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_room.create.response>> {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!user) throw lib_error.forbidden

    const vault = await database.main_db.vault.findFirst({
      where: { vault_id: body.vault_id, deleted_at: null },
    })
    if (!vault) throw lib_error.forbidden

    const tenant = database.vault_db(vault.vault_database_url)
    const access = await tenant.access.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!Array.isArray(access?.actions) || !access.actions.includes('room.create')) throw lib_error.forbidden

    const user_ids = [...new Set([payload.user_id, ...(body.user_ids ?? [])])]
    const users = await database.main_db.user.count({
      where: { user_id: { in: user_ids }, deleted_at: null },
    })
    if (users !== user_ids.length) throw lib_error.bad_request

    const room_uid = crypto.randomUUID()
    const route = await database.main_db.roomRoute.create({
      data: { room_uid, vault_id: vault.vault_id },
    })

    try {
      const data = await tenant.room.create({
        data: {
          room_uid,
          room_title: body.room_title.trim(),
          room_type: 'group',
          room_status: 'open',
          room_visibility: 'private',
          room_max_participants: 12,
          user_id: payload.user_id,
          room_members: {
            create: user_ids.map((user_id) => ({
              user_id,
              room_member_role: user_id === payload.user_id ? 'host' : 'member',
              room_member_status: user_id === payload.user_id ? 'active' : 'invited',
            })),
          },
        },
      })

      return { data }
    } catch (error) {
      try {
        await database.main_db.roomRoute.update({
          where: { room_route_id: route.room_route_id },
          data: { deleted_at: new Date() },
        })
      } catch {
        console.error('Could not clean up failed room route', route.room_route_id)
      }
      throw error
    }
  },
}
