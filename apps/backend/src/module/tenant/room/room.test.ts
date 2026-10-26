import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import { lib_error } from '@lib/error.lib'
import { lib_middleware_error } from '@lib/middleware.lib'
import type { dto_room } from '@module/tenant/room/room.dto'
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
  }
  const access = {
    findFirst: mock(async () => ({ actions: ['room.create'] })),
  }
  const room = {
    create: mock(async (input: { data: Record<string, unknown> }) => ({
      room_id: 1,
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
      ...input.data,
    })),
  }
  const vault_db = mock(() => ({ access, room }))
  const database = { main_db: { user, vault, roomRoute: room_route }, vault_db } as unknown as ReturnType<typeof create_database_client>

  return { database, user, vault, room_route, access, room, vault_db }
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

  test('reports a missing personal vault', async () => {
    const fixture = create_fixture()
    fixture.vault.findFirst.mockResolvedValueOnce(null)

    await expect(service_room.create({ room_title: 'Meeting' }, { user_id: 1 }, fixture.database)).rejects.toEqual(lib_error.vault_not_found)
    expect(fixture.room_route.create).not.toHaveBeenCalled()
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
