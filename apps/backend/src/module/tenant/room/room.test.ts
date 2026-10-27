import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import { lib_error } from '@lib/error.lib'
import { lib_middleware_error } from '@lib/middleware.lib'
import type { dto_room } from '@module/tenant/room/room.dto'
import { service_vault } from '@module/main/vault/vault.service'
import { service_room } from '@module/tenant/room/room.service'

const previous_env = process.env.ENV

beforeAll(() => {
  process.env.ENV = 'dev'
})

afterAll(() => {
  if (previous_env === undefined) delete process.env.ENV
  else process.env.ENV = previous_env
})

process.env.JWT_SECRET_KEY ||= 'room-test-secret'

function create_token(user_id: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const body = encode({ user_id, exp: Math.floor(Date.now() / 1000) + 60 })
  const signature = createHmac('sha256', process.env.JWT_SECRET_KEY!).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

const { controller_room } = await import('@module/tenant/room/room.controller')

function create_fixture() {
  const user = {
    findFirst: mock(async (): Promise<{ user_id: number } | null> => ({ user_id: 1 })),
    count: mock(async (input: { where: { user_id: { in: number[] } } }) => input.where.user_id.in.length),
  }
  const vault = {
    findFirst: mock(async (): Promise<{ vault_id: number; vault_database_url: string } | null> => ({ vault_id: 1, vault_database_url: 'file:test-vault.db' })),
  }
  const room_route = {
    create: mock(async () => ({ room_route_id: 1 })),
    update: mock(async () => ({})),
    updateMany: mock(async (_query: unknown) => ({ count: 1 })),
  }
  const access = {
    findFirst: mock(async () => ({ actions: ['room.create'] })),
  }
  const room_data: Static<typeof dto_room.create.response>['data'] = {
    room_id: 1,
    room_uid: '00000000-0000-4000-8000-000000000001',
    room_title: 'Team meeting',
    room_type: 'group',
    room_status: 'open',
    room_visibility: 'private',
    room_max_participants: 12,
    user_id: 1,
    room_locked: false,
    room_lobby_enabled: false,
    room_translation_enabled: false,
    room_recording_allowed: false,
    room_encrypted: false,
    room_scheduled_at: null,
    room_started_at: null,
    room_closed_at: null,
    room_close_reason: null,
    created_at: new Date(),
    deleted_at: null,
  }
  const room = {
    create: mock(async (input: { data: Record<string, unknown> }) => ({ ...room_data, ...input.data })),
    findMany: mock(async (_query: unknown) => [room_data]),
    count: mock(async (_query: unknown) => 1),
    findFirst: mock(async (_query: unknown): Promise<{ room_id: number; room_status: string; room_members: { room_member_id: number }[] } | null> => ({ room_id: room_data.room_id, room_status: room_data.room_status, room_members: [{ room_member_id: 1 }] })),
    update: mock(async (input: { where: Record<string, unknown>; data: Partial<typeof room_data> }) => ({ ...room_data, ...input.data })),
  }
  const vault_db = mock(() => ({ access, room }))
  const database = { main_db: { user, vault, roomRoute: room_route }, vault_db } as unknown as ReturnType<typeof create_database_client>

  return { database, user, vault, room_route, access, room, room_data, vault_db }
}

function create_app(database: ReturnType<typeof create_database_client>) {
  return new Elysia()
    .decorate('database', database)
    .use(lib_middleware_error)
    .use(controller_room)
}

function create_request(body: unknown, authenticated = true) {
  return new Request('http://localhost/room', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${create_token(1)}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function find_request(query = 'vault_id=1', user_id: number | null = 1) {
  return new Request(`http://localhost/room?${query}`, {
    headers: user_id === null ? {} : { authorization: `Bearer ${create_token(user_id)}` },
  })
}

function update_request(body: unknown, user_id: number | null = 1) {
  return new Request('http://localhost/room', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(user_id === null ? {} : { authorization: `Bearer ${create_token(user_id)}` }),
    },
    body: JSON.stringify(body),
  })
}

function delete_request(body: unknown, user_id: number | null = 1) {
  return new Request('http://localhost/room', {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(user_id === null ? {} : { authorization: `Bearer ${create_token(user_id)}` }),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /room/join', () => {
  const body = { vault_id: 1, room_uid: '00000000-0000-4000-8000-000000000001' }

  function create_join_fixture() {
    const fixture = create_fixture()
    const member_data: Static<typeof dto_room.join.response>['data'] = {
      room_member_id: 2,
      room_id: 1,
      user_id: 2,
      room_member_role: 'member',
      room_member_status: 'invited',
      room_member_banned_at: null,
      created_at: new Date(),
      deleted_at: null,
    }
    const room = {
      findFirst: mock(async (_query: unknown): Promise<typeof fixture.room_data | null> => fixture.room_data),
      updateMany: mock(async (_query: unknown) => ({ count: 1 })),
    }
    const member = {
      findFirst: mock(async (_query: unknown): Promise<typeof member_data | null> => member_data),
      count: mock(async (_query: unknown) => 1),
      update: mock(async (input: { where: { room_member_id: number }; data: { room_member_status: string } }) => {
        member_data.room_member_status = input.data.room_member_status
        return { ...member_data }
      }),
    }
    const transaction = { room, roomMember: member }
    const run_transaction = mock(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction))
    const vault_db = mock(() => ({ $transaction: run_transaction }))
    const database = { main_db: { user: fixture.user, vault: fixture.vault }, vault_db } as unknown as ReturnType<typeof create_database_client>

    return { ...fixture, database, room, member, member_data, vault_db, run_transaction }
  }

  function join_request(input: unknown = body, user_id: number | null = 2) {
    return new Request('http://localhost/room/join', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(user_id === null ? {} : { authorization: `Bearer ${create_token(user_id)}` }),
      },
      body: JSON.stringify(input),
    })
  }

  test('joins the selected vault as the authenticated member without creation permission', async () => {
    const fixture = create_join_fixture()
    const response = await create_app(fixture.database).handle(join_request({ ...body, user_id: 999, room_member_role: 'host' }))
    const result = await response.json() as Static<typeof dto_room.join.response>

    expect(response.status).toBe(200)
    expect(result.data).toMatchObject({ user_id: 2, room_member_role: 'member', room_member_status: 'active' })
    expect(fixture.user.findFirst).toHaveBeenCalledWith({ where: { user_id: 2, deleted_at: null } })
    expect(fixture.vault.findFirst).toHaveBeenCalledWith({ where: { vault_id: 1, deleted_at: null } })
    expect(fixture.vault_db).toHaveBeenCalledWith('file:test-vault.db')
    expect(fixture.run_transaction).toHaveBeenCalledTimes(1)
    expect(fixture.room.updateMany).toHaveBeenCalledWith({
      where: { room_uid: body.room_uid, deleted_at: null },
      data: { room_uid: body.room_uid },
    })
    expect(fixture.room.findFirst).toHaveBeenCalledWith({ where: { room_uid: body.room_uid, deleted_at: null } })
    expect(fixture.member.findFirst).toHaveBeenCalledWith({ where: {
      room_id: 1,
      user_id: 2,
      deleted_at: null,
      room_member_banned_at: null,
      room_member_status: { in: ['invited', 'waiting', 'active'] },
    } })
    expect(fixture.member.count).toHaveBeenCalledWith({ where: {
      room_id: 1, room_member_status: 'active', deleted_at: null, room_member_banned_at: null,
    } })
    expect(fixture.member.update).toHaveBeenCalledWith({ where: { room_member_id: 2 }, data: { room_member_status: 'active' } })
    expect(fixture.access.findFirst).not.toHaveBeenCalled()
  })

  test('joins a live room', async () => {
    const fixture = create_join_fixture()
    fixture.room_data.room_status = 'live'
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(200)
    expect(fixture.member_data.room_member_status).toBe('active')
  })

  test('requires authentication', async () => {
    const fixture = create_join_fixture()
    const response = await create_app(fixture.database).handle(join_request(body, null))

    expect(response.status).toBe(401)
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects missing or deleted users', async () => {
    const fixture = create_join_fixture()
    fixture.user.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(403)
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects missing or deleted vaults', async () => {
    const fixture = create_join_fixture()
    fixture.vault.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(403)
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects missing or deleted rooms', async () => {
    const fixture = create_join_fixture()
    fixture.room.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'room-not-found' })
    expect(fixture.member.update).not.toHaveBeenCalled()
  })

  test('rejects absent or ineligible memberships without writes', async () => {
    const fixture = create_join_fixture()
    fixture.member.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(403)
    expect(fixture.member.update).not.toHaveBeenCalled()
  })

  test.each([
    ['closed', 410, 'room-closed'],
    ['scheduled', 409, 'room-not-open'],
  ] as const)('rejects %s rooms', async (status, expected_status, code) => {
    const fixture = create_join_fixture()
    fixture.room_data.room_status = status
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(expected_status)
    expect(await response.json()).toEqual({ code })
    expect(fixture.member.update).not.toHaveBeenCalled()
  })

  test('refuses non-hosts in locked rooms', async () => {
    const fixture = create_join_fixture()
    fixture.room_data.room_locked = true
    fixture.member_data.room_member_role = 'moderator'
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ code: 'room-locked' })
    expect(fixture.member.update).not.toHaveBeenCalled()
  })

  test('allows the host to join a locked room', async () => {
    const fixture = create_join_fixture()
    fixture.room_data.room_locked = true
    fixture.member_data.room_member_role = 'host'
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(200)
    expect(fixture.member_data.room_member_status).toBe('active')
  })

  test('puts lobby guests into waiting without consuming capacity', async () => {
    const fixture = create_join_fixture()
    fixture.room_data.room_lobby_enabled = true
    fixture.member.count.mockResolvedValue(12)
    const response = await create_app(fixture.database).handle(join_request())
    const result = await response.json() as Static<typeof dto_room.join.response>

    expect(response.status).toBe(200)
    expect(result.data.room_member_status).toBe('waiting')
    expect(fixture.member.count).not.toHaveBeenCalled()
  })

  test.each(['host', 'moderator'])('lets %s bypass the lobby', async (role) => {
    const fixture = create_join_fixture()
    fixture.room_data.room_lobby_enabled = true
    fixture.member_data.room_member_role = role
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(200)
    expect(fixture.member_data.room_member_status).toBe('active')
  })

  test('keeps waiting guests waiting while the lobby is enabled', async () => {
    const fixture = create_join_fixture()
    fixture.room_data.room_lobby_enabled = true
    fixture.member_data.room_member_status = 'waiting'
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(200)
    expect(fixture.member.update).not.toHaveBeenCalled()
    expect(fixture.member.count).not.toHaveBeenCalled()
  })

  test('lets a waiting guest join when the lobby is disabled', async () => {
    const fixture = create_join_fixture()
    fixture.member_data.room_member_status = 'waiting'
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(200)
    expect(fixture.member_data.room_member_status).toBe('active')
  })

  test('rejects a full room without promoting the invitee', async () => {
    const fixture = create_join_fixture()
    fixture.member.count.mockResolvedValue(12)
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'room-full' })
    expect(fixture.member.update).not.toHaveBeenCalled()
  })

  test('allows an already active member to rejoin a full room without demotion', async () => {
    const fixture = create_join_fixture()
    fixture.room_data.room_lobby_enabled = true
    fixture.member_data.room_member_status = 'active'
    fixture.member.count.mockResolvedValue(12)
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(200)
    expect(fixture.member_data.room_member_status).toBe('active')
    expect(fixture.member.update).not.toHaveBeenCalled()
    expect(fixture.member.count).not.toHaveBeenCalled()
  })

  test('repeated joins update the same membership only once', async () => {
    const fixture = create_join_fixture()
    const app = create_app(fixture.database)
    const first = await app.handle(join_request())
    const second = await app.handle(join_request())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(fixture.member.update).toHaveBeenCalledTimes(1)
  })

  test('propagates database failures', async () => {
    const fixture = create_join_fixture()
    const failure = new Error('Membership write failed')
    fixture.member.update.mockRejectedValue(failure)

    await expect(service_room.join(body, { user_id: 2 }, fixture.database)).rejects.toBe(failure)
  })

  test.each(['P1008', 'P2034', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'])('returns a retryable response for transaction conflict %s', async (code) => {
    const fixture = create_join_fixture()
    fixture.room.updateMany.mockRejectedValue({ code })
    const response = await create_app(fixture.database).handle(join_request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'service-unavailable' })
    expect(fixture.member.update).not.toHaveBeenCalled()
  })

  test.each([
    {},
    { vault_id: 1 },
    { room_uid: body.room_uid },
    { ...body, vault_id: 0 },
    { ...body, vault_id: 1.5 },
    { ...body, room_uid: 'invalid' },
  ] as unknown[])('rejects invalid join body %j', async (input) => {
    const fixture = create_join_fixture()
    const response = await create_app(fixture.database).handle(join_request(input))

    expect(response.status).toBe(422)
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })
})

describe('DELETE /room', () => {
  const body = { vault_id: 1, room_uid: '00000000-0000-4000-8000-000000000001' }

  function create_delete_fixture(status = 'closed') {
    const fixture = create_fixture()
    fixture.room_data.room_status = status
    fixture.room_data.room_closed_at = status === 'closed' ? new Date('2026-10-21T10:00:00Z') : null
    fixture.room_data.room_close_reason = status === 'closed' ? 'ended' : null
    return fixture
  }

  test('soft-deletes closed rooms with a guarded host write and scoped route cleanup', async () => {
    const fixture = create_delete_fixture()
    const response = await create_app(fixture.database).handle(delete_request({ ...body, room_close_reason: 'changed' }))
    const result = await response.json() as Static<typeof dto_room.delete.response>
    const deleted_at = fixture.room.update.mock.calls[0]![0].data.deleted_at

    expect(response.status).toBe(200)
    expect(deleted_at).toBeInstanceOf(Date)
    expect(result.data).toMatchObject({ room_status: 'closed', room_close_reason: 'ended', room_closed_at: '2026-10-21T10:00:00.000Z', deleted_at: deleted_at!.toISOString() })
    expect(fixture.room.update).toHaveBeenCalledWith({
      where: {
        room_id: 1,
        deleted_at: null,
        room_status: 'closed',
        room_members: { some: {
          user_id: 1,
          deleted_at: null,
          room_member_banned_at: null,
          room_member_status: { in: ['invited', 'waiting', 'active'] },
          room_member_role: 'host',
        } },
      },
      data: { deleted_at },
    })
    expect(fixture.room_route.updateMany).toHaveBeenCalledWith({
      where: { room_uid: body.room_uid, vault_id: 1, deleted_at: null },
      data: { deleted_at },
    })
    expect(fixture.access.findFirst).not.toHaveBeenCalled()
  })

  test('cancels scheduled rooms using the deletion timestamp', async () => {
    const fixture = create_delete_fixture('scheduled')
    const response = await create_app(fixture.database).handle(delete_request(body))
    const result = await response.json() as Static<typeof dto_room.delete.response>

    expect(response.status).toBe(200)
    expect(result.data).toMatchObject({ room_status: 'closed', room_close_reason: 'canceled' })
    expect(result.data.room_closed_at).toBe(result.data.deleted_at)
    expect(fixture.room.update.mock.calls[0]![0].where.room_status).toBe('scheduled')
  })

  test.each(['open', 'live'])('rejects %s rooms without writes', async (status) => {
    const fixture = create_delete_fixture(status)
    const response = await create_app(fixture.database).handle(delete_request(body))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'room-not-deletable' })
    expect(fixture.room.update).not.toHaveBeenCalled()
    expect(fixture.room_route.updateMany).not.toHaveBeenCalled()
  })

  test('requires authentication', async () => {
    const fixture = create_delete_fixture()
    const response = await create_app(fixture.database).handle(delete_request(body, null))

    expect(response.status).toBe(401)
    expect(fixture.room.update).not.toHaveBeenCalled()
  })

  test('rejects missing or deleted users', async () => {
    const fixture = create_delete_fixture()
    fixture.user.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(delete_request(body))

    expect(response.status).toBe(403)
    expect(fixture.user.findFirst).toHaveBeenCalledWith({ where: { user_id: 1, deleted_at: null } })
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects missing or deleted vaults', async () => {
    const fixture = create_delete_fixture()
    fixture.vault.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(delete_request(body))

    expect(response.status).toBe(403)
    expect(fixture.vault.findFirst).toHaveBeenCalledWith({ where: { vault_id: 1, deleted_at: null } })
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('returns not found for missing or deleted rooms in the selected vault', async () => {
    const fixture = create_delete_fixture()
    fixture.room.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(delete_request(body))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'room-not-found' })
    expect(fixture.vault_db).toHaveBeenCalledWith('file:test-vault.db')
    expect(fixture.room.update).not.toHaveBeenCalled()
  })

  test('rejects callers without eligible host membership before checking room state', async () => {
    const fixture = create_delete_fixture('open')
    fixture.room.findFirst.mockResolvedValue({ room_id: 1, room_status: 'open', room_members: [] })
    const response = await create_app(fixture.database).handle(delete_request(body, 2))

    expect(response.status).toBe(403)
    expect(fixture.room.update).not.toHaveBeenCalled()
    expect(fixture.room_route.updateMany).not.toHaveBeenCalled()
  })

  test('rejects concurrent eligibility changes without cleaning up the route', async () => {
    const fixture = create_delete_fixture()
    fixture.room.update.mockRejectedValue({ code: 'P2025' })
    const response = await create_app(fixture.database).handle(delete_request(body))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'room-not-deletable' })
    expect(fixture.room_route.updateMany).not.toHaveBeenCalled()
  })

  test('propagates unrelated database failures without route cleanup', async () => {
    const fixture = create_delete_fixture()
    const failure = new Error('Database write failed')
    fixture.room.update.mockRejectedValue(failure)

    await expect(service_room.delete(body, { user_id: 1 }, fixture.database)).rejects.toBe(failure)
    expect(fixture.room_route.updateMany).not.toHaveBeenCalled()
  })

  test('keeps successful tenant deletion when main route cleanup fails', async () => {
    const fixture = create_delete_fixture()
    fixture.room_route.updateMany.mockRejectedValue(new Error('Main database unavailable'))
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await create_app(fixture.database).handle(delete_request(body))

      expect(response.status).toBe(200)
      const result = await response.json() as Static<typeof dto_room.delete.response>
      expect(result.data.deleted_at).not.toBeNull()
      expect(log).toHaveBeenCalledWith('Could not clean up deleted room route', body.room_uid)
    } finally {
      log.mockRestore()
    }
  })

  test('allows an already missing or deleted route', async () => {
    const fixture = create_delete_fixture()
    fixture.room_route.updateMany.mockResolvedValue({ count: 0 })
    const response = await create_app(fixture.database).handle(delete_request(body))

    expect(response.status).toBe(200)
  })

  test.each([
    {},
    { vault_id: 1 },
    { room_uid: body.room_uid },
    { ...body, vault_id: 0 },
    { ...body, vault_id: 1.5 },
    { ...body, room_uid: 'not-a-uuid' },
  ] as unknown[])('rejects invalid body %j', async (input) => {
    const fixture = create_delete_fixture()
    const response = await create_app(fixture.database).handle(delete_request(input))

    expect(response.status).toBe(422)
    expect(fixture.room.update).not.toHaveBeenCalled()
    expect(fixture.room_route.updateMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /room', () => {
  const body = { vault_id: 1, room_uid: '00000000-0000-4000-8000-000000000001', room_title: ' Renamed meeting ' }

  test('renames with host/moderator membership enforced in the write', async () => {
    const fixture = create_fixture()
    fixture.access.findFirst.mockResolvedValue({ actions: [] })
    const response = await create_app(fixture.database).handle(update_request(body))
    const result = await response.json() as Static<typeof dto_room.update.response>

    expect(response.status).toBe(200)
    expect(result.data).toMatchObject({ room_id: 1, room_uid: body.room_uid, room_title: 'Renamed meeting' })
    expect(fixture.room.update).toHaveBeenCalledWith({
      where: {
        room_id: 1,
        deleted_at: null,
        room_members: { some: {
          user_id: 1,
          deleted_at: null,
          room_member_banned_at: null,
          room_member_status: { in: ['invited', 'waiting', 'active'] },
          room_member_role: { in: ['host', 'moderator'] },
        } },
      },
      data: { room_title: 'Renamed meeting' },
    })
    expect(fixture.access.findFirst).not.toHaveBeenCalled()
  })

  test('looks up the room only in the requested active vault', async () => {
    const fixture = create_fixture()
    fixture.vault.findFirst.mockResolvedValue({ vault_id: 2, vault_database_url: 'file:second-vault.db' })
    const response = await create_app(fixture.database).handle(update_request({ ...body, vault_id: 2 }))

    expect(response.status).toBe(200)
    expect(fixture.vault.findFirst).toHaveBeenCalledWith({ where: { vault_id: 2, deleted_at: null } })
    expect(fixture.vault_db).toHaveBeenCalledWith('file:second-vault.db')
    expect(fixture.room.findFirst).toHaveBeenCalledWith({ where: { room_uid: body.room_uid, deleted_at: null }, select: { room_id: true } })
  })

  test('requires authentication', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(update_request(body, null))

    expect(response.status).toBe(401)
    expect(fixture.room.update).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted user', async () => {
    const fixture = create_fixture()
    fixture.user.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(update_request(body))

    expect(response.status).toBe(403)
    expect(fixture.user.findFirst).toHaveBeenCalledWith({ where: { user_id: 1, deleted_at: null } })
    expect(fixture.room.update).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted vault', async () => {
    const fixture = create_fixture()
    fixture.vault.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(update_request(body))

    expect(response.status).toBe(403)
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted room', async () => {
    const fixture = create_fixture()
    fixture.room.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(update_request(body))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'room-not-found' })
    expect(fixture.room.update).not.toHaveBeenCalled()
  })

  test('returns forbidden when no eligible host/moderator membership matches at write time', async () => {
    const fixture = create_fixture()
    fixture.room.update.mockRejectedValue({ code: 'P2025' })
    const response = await create_app(fixture.database).handle(update_request(body, 2))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'forbidden' })
  })

  test('does not hide unrelated database failures as permission errors', async () => {
    const fixture = create_fixture()
    const failure = new Error('Database write failed')
    fixture.room.update.mockRejectedValue(failure)

    await expect(service_room.update(body, { user_id: 1 }, fixture.database)).rejects.toBe(failure)
  })

  test('changes only the title even when extra fields are submitted', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(update_request({ ...body, room_locked: true, user_id: 999 }))
    const result = await response.json() as Static<typeof dto_room.update.response>

    expect(response.status).toBe(200)
    expect(fixture.room.update).toHaveBeenCalledWith(expect.objectContaining({ data: { room_title: 'Renamed meeting' } }))
    expect(result.data.room_locked).toBe(false)
    expect(result.data.user_id).toBe(1)
  })

  test.each([
    { ...body, room_title: '' },
    { ...body, room_title: '   ' },
    { ...body, room_title: 'x'.repeat(201) },
    { ...body, room_uid: 'invalid' },
    { ...body, vault_id: 0 },
    { ...body, vault_id: 1.5 },
    { room_title: 'Title' },
    { vault_id: 1, room_uid: body.room_uid },
  ])('rejects invalid update %j', async (input) => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(update_request(input))

    expect(response.status).toBe(422)
    expect(fixture.room.update).not.toHaveBeenCalled()
  })
})

describe('GET /room', () => {
  test('returns membership-filtered rooms without requiring creation permission', async () => {
    const fixture = create_fixture()
    fixture.access.findFirst.mockResolvedValue({ actions: [] })
    const response = await create_app(fixture.database).handle(find_request('vault_id=1', 2))
    const result = await response.json() as Static<typeof dto_room.find.response>

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ page: 1, take: 20, rows: 1, pages: 1 })
    expect(result.data[0]?.room_uid).toBe(fixture.room_data.room_uid)
    const where = {
      deleted_at: null,
      room_members: { some: {
        user_id: 2,
        deleted_at: null,
        room_member_banned_at: null,
        room_member_status: { in: ['invited', 'waiting', 'active'] },
      } },
    }
    expect(fixture.room.findMany).toHaveBeenCalledWith({
      where, skip: 0, take: 20, orderBy: [{ created_at: 'desc' }, { room_id: 'desc' }],
    })
    expect(fixture.room.count).toHaveBeenCalledWith({ where })
    expect(fixture.access.findFirst).not.toHaveBeenCalled()
    expect(fixture.room.create).not.toHaveBeenCalled()
  })

  test('uses the requested page and size with matching totals', async () => {
    const fixture = create_fixture()
    fixture.room.count.mockResolvedValue(5)
    const response = await create_app(fixture.database).handle(find_request('vault_id=1&page=2&take=2'))
    const result = await response.json() as Static<typeof dto_room.find.response>

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ page: 2, take: 2, rows: 5, pages: 3 })
    expect(fixture.room.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2, take: 2 }))
  })

  test('applies the room UUID filter to both data and totals', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(find_request(`vault_id=1&room_uid=${fixture.room_data.room_uid}`))

    expect(response.status).toBe(200)
    expect(fixture.room.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ room_uid: fixture.room_data.room_uid }) }))
    expect(fixture.room.count).toHaveBeenCalledWith({ where: expect.objectContaining({ room_uid: fixture.room_data.room_uid }) })
  })

  test('returns an empty list when no rooms are accessible', async () => {
    const fixture = create_fixture()
    fixture.room.findMany.mockResolvedValue([])
    fixture.room.count.mockResolvedValue(0)
    const response = await create_app(fixture.database).handle(find_request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], rows: 0, pages: 0, page: 1, take: 20 })
  })

  test('resolves only the requested active vault', async () => {
    const fixture = create_fixture()
    fixture.vault.findFirst.mockResolvedValue({ vault_id: 2, vault_database_url: 'file:second-vault.db' })
    const response = await create_app(fixture.database).handle(find_request('vault_id=2'))

    expect(response.status).toBe(200)
    expect(fixture.vault.findFirst).toHaveBeenCalledWith({ where: { vault_id: 2, deleted_at: null } })
    expect(fixture.vault_db).toHaveBeenCalledTimes(1)
    expect(fixture.vault_db).toHaveBeenCalledWith('file:second-vault.db')
  })

  test('requires authentication', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(find_request('vault_id=1', null))

    expect(response.status).toBe(401)
    expect(fixture.room.findMany).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted user before opening the vault', async () => {
    const fixture = create_fixture()
    fixture.user.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(find_request())

    expect(response.status).toBe(403)
    expect(fixture.user.findFirst).toHaveBeenCalledWith({ where: { user_id: 1, deleted_at: null } })
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted vault before querying rooms', async () => {
    const fixture = create_fixture()
    fixture.vault.findFirst.mockResolvedValue(null)
    const response = await create_app(fixture.database).handle(find_request())

    expect(response.status).toBe(403)
    expect(fixture.room.findMany).not.toHaveBeenCalled()
  })

  test.each([
    '',
    'vault_id=0',
    'vault_id=1.5',
    'vault_id=1&page=0',
    'vault_id=1&page=1.5',
    'vault_id=1&page=1000001',
    'vault_id=1&take=0',
    'vault_id=1&take=101',
    'vault_id=1&take=1.5',
    'vault_id=1&room_uid=invalid',
  ])('rejects invalid query %s', async (query) => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(find_request(query))

    expect(response.status).toBe(422)
    expect(fixture.room.findMany).not.toHaveBeenCalled()
  })
})

describe('POST /room', () => {
  test('creates a routed room with a host and invited members', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(create_request({ vault_id: 1, room_title: ' Team meeting ', user_ids: [2, 3] }))
    const result = await response.json() as Static<typeof dto_room.create.response>

    expect(response.status).toBe(200)
    expect(result.data).toMatchObject({ room_title: 'Team meeting', room_type: 'group', room_status: 'open', room_lobby_enabled: true, user_id: 1 })
    expect(result.data.room_uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(fixture.vault_db).toHaveBeenCalledWith('file:test-vault.db')
    expect(fixture.room_route.create).toHaveBeenCalledWith({ data: { room_uid: result.data.room_uid, vault_id: 1 } })
    expect(fixture.room.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      room_members: { create: [
        { user_id: 1, room_member_role: 'host', room_member_status: 'active' },
        { user_id: 2, room_member_role: 'member', room_member_status: 'invited' },
        { user_id: 3, room_member_role: 'member', room_member_status: 'invited' },
      ] },
    }) })
  })

  test.each([{ user_ids: undefined }, { user_ids: [1, 2] }])('never duplicates the creator for %j', async ({ user_ids }) => {
    const fixture = create_fixture()
    await service_room.create({ vault_id: 1, room_title: 'Meeting', user_ids: user_ids ? [...user_ids] : undefined }, { user_id: 1 }, fixture.database)

    const data = fixture.room.create.mock.calls[0]![0].data
    const members = data.room_members as { create: { user_id: number }[] }
    expect(members.create.filter((member) => member.user_id === 1)).toHaveLength(1)
  })

  test('requires authentication', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(create_request({ vault_id: 1, room_title: 'Meeting' }, false))

    expect(response.status).toBe(401)
    expect(fixture.room_route.create).not.toHaveBeenCalled()
  })

  test('rejects a token signed with another secret', async () => {
    const fixture = create_fixture()
    const [header, body] = create_token(1).split('.')
    const forged = `${header}.${body}.${createHmac('sha256', 'another-secret').update(`${header}.${body}`).digest('base64url')}`
    const request = new Request('http://localhost/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${forged}` },
      body: JSON.stringify({ vault_id: 1, room_title: 'Meeting' }),
    })
    const response = await create_app(fixture.database).handle(request)

    expect(response.status).toBe(401)
    expect(fixture.room.create).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted creator', async () => {
    const fixture = create_fixture()
    fixture.user.findFirst.mockResolvedValue(null)

    await expect(service_room.create({ vault_id: 1, room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toEqual(lib_error.forbidden)
    expect(fixture.user.findFirst).toHaveBeenCalledWith({ where: { user_id: 1, deleted_at: null } })
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('rejects a missing or deleted vault', async () => {
    const fixture = create_fixture()
    fixture.vault.findFirst.mockResolvedValue(null)

    await expect(service_room.create({ vault_id: 1, room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toEqual(lib_error.forbidden)
    expect(fixture.vault_db).not.toHaveBeenCalled()
  })

  test('uses the caller personal vault when no vault is given', async () => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(create_request({ room_title: 'Meeting' }))

    expect(response.status).toBe(200)
    expect(fixture.vault.findFirst).toHaveBeenCalledWith({ where: { vault_owner_type: 'user', vault_owner_id: 1, deleted_at: null } })
    expect(fixture.room_route.create).toHaveBeenCalledWith({ data: { room_uid: expect.any(String), vault_id: 1 } })
  })

  test('creates the personal vault on first use', async () => {
    const fixture = create_fixture()
    const provision = spyOn(service_vault, 'create').mockResolvedValueOnce({ vault_id: 7, vault_database_url: 'file:new-vault.db' } as Awaited<ReturnType<typeof service_vault.create>>)
    await service_room.create({ room_title: 'Meeting' }, { user_id: 1 }, fixture.database)

    expect(provision).toHaveBeenCalledWith(1, fixture.database)
    expect(fixture.vault_db).toHaveBeenCalledWith('file:new-vault.db')
    expect(fixture.room_route.create).toHaveBeenCalledWith({ data: { room_uid: expect.any(String), vault_id: 7 } })
    provision.mockRestore()
  })

  test('does not route a room when the personal vault cannot be created', async () => {
    const fixture = create_fixture()
    const provision = spyOn(service_vault, 'create').mockRejectedValueOnce(lib_error.vault_unavailable)

    await expect(service_room.create({ room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toEqual(lib_error.vault_unavailable)
    expect(fixture.room_route.create).not.toHaveBeenCalled()
    provision.mockRestore()
  })

  test('checks creation permission in the requested vault', async () => {
    const fixture = create_fixture()
    fixture.access.findFirst.mockResolvedValue({ actions: [] })
    const response = await create_app(fixture.database).handle(create_request({ vault_id: 2, room_title: 'Meeting' }))

    expect(response.status).toBe(403)
    expect(fixture.vault.findFirst).toHaveBeenCalledWith({ where: { vault_id: 2, deleted_at: null } })
    expect(fixture.access.findFirst).toHaveBeenCalledWith({ where: { user_id: 1, deleted_at: null } })
    expect(fixture.room_route.create).not.toHaveBeenCalled()
    expect(fixture.room.create).not.toHaveBeenCalled()
  })

  test('rejects missing or deleted invitees before writing', async () => {
    const fixture = create_fixture()
    fixture.user.count.mockResolvedValue(1)

    await expect(service_room.create({ vault_id: 1, room_title: 'Meeting', user_ids: [2] }, { user_id: 1 }, fixture.database)).rejects.toEqual(lib_error.bad_request)
    expect(fixture.user.count).toHaveBeenCalledWith({ where: { user_id: { in: [1, 2] }, deleted_at: null } })
    expect(fixture.room_route.create).not.toHaveBeenCalled()
  })

  test.each([
    { room_title: '   ' },
    { room_title: 'Meeting', user_ids: [2, 2] },
    { room_title: 'Meeting', user_ids: Array.from({ length: 12 }, (_, index) => index + 2) },
    { room_title: 'Meeting', user_ids: [-1] },
  ])('rejects invalid input %j', async (input) => {
    const fixture = create_fixture()
    const response = await create_app(fixture.database).handle(create_request({ vault_id: 1, ...input }))

    expect(response.status).toBe(422)
    expect(fixture.room_route.create).not.toHaveBeenCalled()
  })

  test('soft-deletes the allocated route if vault creation fails', async () => {
    const fixture = create_fixture()
    const failure = new Error('Vault write failed')
    fixture.room.create.mockRejectedValue(failure)

    await expect(service_room.create({ vault_id: 1, room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toBe(failure)
    expect(fixture.room_route.update).toHaveBeenCalledWith({ where: { room_route_id: 1 }, data: { deleted_at: expect.any(Date) } })
  })

  test('does not create a room when routing fails', async () => {
    const fixture = create_fixture()
    fixture.room_route.create.mockRejectedValue(new Error('Routing write failed'))

    await expect(service_room.create({ vault_id: 1, room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toThrow('Routing write failed')
    expect(fixture.room.create).not.toHaveBeenCalled()
  })

  test('preserves the vault error when route cleanup also fails', async () => {
    const fixture = create_fixture()
    const failure = new Error('Vault write failed')
    fixture.room.create.mockRejectedValue(failure)
    fixture.room_route.update.mockRejectedValue(new Error('Route cleanup failed'))
    const log = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(service_room.create({ vault_id: 1, room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toBe(failure)
      expect(log).toHaveBeenCalledWith('Could not clean up failed room route', 1)
    } finally {
      log.mockRestore()
    }
  })
})
