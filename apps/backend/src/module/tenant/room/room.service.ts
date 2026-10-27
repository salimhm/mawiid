import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'
import { service_vault } from '@module/main/vault/vault.service'
import { dto_room } from '@module/tenant/room/room.dto'

export const service_room = {
  async join(
    body: Static<typeof dto_room.join.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_room.join.response>> {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!user) throw lib_error.forbidden

    const vault = await database.main_db.vault.findFirst({
      where: { vault_id: body.vault_id, deleted_at: null },
    })
    if (!vault) throw lib_error.forbidden

    const tenant = database.vault_db(vault.vault_database_url)
    return await tenant.$transaction(async (transaction) => {
      await transaction.room.updateMany({
        where: { room_uid: body.room_uid, deleted_at: null },
        data: { room_uid: body.room_uid },
      })
      const room = await transaction.room.findFirst({
        where: { room_uid: body.room_uid, deleted_at: null },
      })
      if (!room) throw lib_error.room_not_found

      const member = await transaction.roomMember.findFirst({
        where: {
          room_id: room.room_id,
          user_id: payload.user_id,
          deleted_at: null,
          room_member_banned_at: null,
          room_member_status: { in: ['invited', 'waiting', 'active'] },
        },
      })
      if (!member) throw lib_error.forbidden
      if (room.room_status === 'closed') throw lib_error.room_closed
      if (room.room_status !== 'open' && room.room_status !== 'live') throw lib_error.room_not_open
      if (room.room_locked && member.room_member_role !== 'host') throw lib_error.room_locked
      if (member.room_member_status === 'active') return { data: member }

      const status = room.room_lobby_enabled && !['host', 'moderator'].includes(member.room_member_role) ? 'waiting' : 'active'
      if (member.room_member_status === status) return { data: member }
      if (status === 'active') {
        const active = await transaction.roomMember.count({
          where: {
            room_id: room.room_id,
            room_member_status: 'active',
            deleted_at: null,
            room_member_banned_at: null,
          },
        })
        if (active >= room.room_max_participants) throw lib_error.room_full
      }

      const data = await transaction.roomMember.update({
        where: { room_member_id: member.room_member_id },
        data: { room_member_status: status },
      })
      return { data }
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && ['P1008', 'P2034', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'].includes(String(error.code))) throw lib_error.service_unavailable
      throw error
    })
  },
  async find(
    query: Static<typeof dto_room.find.query>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_room.find.response>> {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!user) throw lib_error.forbidden

    const vault = await database.main_db.vault.findFirst({
      where: { vault_id: query.vault_id, deleted_at: null },
    })
    if (!vault) throw lib_error.forbidden

    const tenant = database.vault_db(vault.vault_database_url)
    const page = query.page ?? 1
    const take = query.take ?? 20
    const where = {
      deleted_at: null,
      ...(query.room_uid ? { room_uid: query.room_uid } : {}),
      room_members: {
        some: {
          user_id: payload.user_id,
          deleted_at: null,
          room_member_banned_at: null,
          room_member_status: { in: ['invited', 'waiting', 'active'] },
        },
      },
    }
    const [data, rows] = await Promise.all([
      tenant.room.findMany({
        where,
        skip: (page - 1) * take,
        take,
        orderBy: [{ created_at: 'desc' }, { room_id: 'desc' }],
      }),
      tenant.room.count({ where }),
    ])

    return { data, rows, pages: Math.ceil(rows / take), page, take }
  },
  async create(
    body: Static<typeof dto_room.create.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_room.create.response>> {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!user) throw lib_error.forbidden

    const vault = body.vault_id
      ? await database.main_db.vault.findFirst({ where: { vault_id: body.vault_id, deleted_at: null } })
      : await service_vault.create(payload.user_id, database)
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
          room_lobby_enabled: true,
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
  async update(
    body: Static<typeof dto_room.update.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_room.update.response>> {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!user) throw lib_error.forbidden

    const vault = await database.main_db.vault.findFirst({
      where: { vault_id: body.vault_id, deleted_at: null },
    })
    if (!vault) throw lib_error.forbidden

    const tenant = database.vault_db(vault.vault_database_url)
    const room = await tenant.room.findFirst({
      where: { room_uid: body.room_uid, deleted_at: null },
      select: { room_id: true },
    })
    if (!room) throw lib_error.room_not_found

    try {
      const data = await tenant.room.update({
        where: {
          room_id: room.room_id,
          deleted_at: null,
          room_members: {
            some: {
              user_id: payload.user_id,
              deleted_at: null,
              room_member_banned_at: null,
              room_member_status: { in: ['invited', 'waiting', 'active'] },
              room_member_role: { in: ['host', 'moderator'] },
            },
          },
        },
        data: { room_title: body.room_title.trim() },
      })

      return { data }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') throw lib_error.forbidden
      throw error
    }
  },
  async delete(
    body: Static<typeof dto_room.delete.body>,
    payload: lib_dto_payload,
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_room.delete.response>> {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
    })
    if (!user) throw lib_error.forbidden

    const vault = await database.main_db.vault.findFirst({
      where: { vault_id: body.vault_id, deleted_at: null },
    })
    if (!vault) throw lib_error.forbidden

    const tenant = database.vault_db(vault.vault_database_url)
    const membership = {
      user_id: payload.user_id,
      deleted_at: null,
      room_member_banned_at: null,
      room_member_status: { in: ['invited', 'waiting', 'active'] },
      room_member_role: 'host',
    }
    const room = await tenant.room.findFirst({
      where: { room_uid: body.room_uid, deleted_at: null },
      select: {
        room_id: true,
        room_status: true,
        room_members: { where: membership, select: { room_member_id: true } },
      },
    })
    if (!room) throw lib_error.room_not_found
    if (!room.room_members.length) throw lib_error.forbidden
    if (room.room_status !== 'scheduled' && room.room_status !== 'closed') throw lib_error.room_not_deletable

    const deleted_at = new Date()
    let data
    try {
      data = await tenant.room.update({
        where: {
          room_id: room.room_id,
          deleted_at: null,
          room_status: room.room_status,
          room_members: { some: membership },
        },
        data: {
          deleted_at,
          ...(room.room_status === 'scheduled' ? {
            room_status: 'closed',
            room_close_reason: 'canceled',
            room_closed_at: deleted_at,
          } : {}),
        },
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') throw lib_error.room_not_deletable
      throw error
    }

    try {
      await database.main_db.roomRoute.updateMany({
        where: { room_uid: body.room_uid, vault_id: vault.vault_id, deleted_at: null },
        data: { deleted_at },
      })
    } catch {
      console.error('Could not clean up deleted room route', body.room_uid)
    }

    return { data }
  },
}
