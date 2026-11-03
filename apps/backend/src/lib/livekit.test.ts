import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { AgentDispatch, Room } from 'livekit-server-sdk'

process.env.LIVEKIT_URL ||= 'http://localhost:7880'
process.env.LIVEKIT_API_KEY ||= 'devkey'
process.env.LIVEKIT_API_SECRET ||= 'secret'

const lib = await import('@lib/livekit.lib')

const room_uid = '00000000-0000-4000-8000-000000000001'
const agent_name = process.env.LIVEKIT_TRANSLATOR_AGENT || 'mawiid-translator'

const list_rooms = spyOn(lib.lib_livekit_room, 'listRooms')
const create_room = spyOn(lib.lib_livekit_room, 'createRoom')
const list_dispatch = spyOn(lib.lib_livekit_dispatch, 'listDispatch')
const create_dispatch = spyOn(lib.lib_livekit_dispatch, 'createDispatch')
const delete_dispatch = spyOn(lib.lib_livekit_dispatch, 'deleteDispatch')

function dispatch(id: string, agentName: string) {
  return new AgentDispatch({ id, agentName, room: room_uid })
}

afterEach(() => {
  for (const spy of [list_rooms, create_room, list_dispatch, create_dispatch, delete_dispatch]) spy.mockReset()
})

describe('lib_livekit_translator_start', () => {
  test('dispatches the translator to a live room', async () => {
    list_rooms.mockResolvedValue([new Room({ name: room_uid })])
    list_dispatch.mockResolvedValue([])
    create_dispatch.mockResolvedValue(dispatch('AD_1', agent_name))

    await lib.lib_livekit_translator_start(room_uid)

    expect(create_dispatch).toHaveBeenCalledWith(room_uid, agent_name, { metadata: JSON.stringify({ room_uid }) })
  })

  test('keeps the existing translator instead of adding a second one', async () => {
    list_rooms.mockResolvedValue([new Room({ name: room_uid })])
    list_dispatch.mockResolvedValue([dispatch('AD_1', agent_name)])

    await lib.lib_livekit_translator_start(room_uid)

    expect(create_dispatch).not.toHaveBeenCalled()
  })

  test('waits for the first join when nobody is in the room yet', async () => {
    list_rooms.mockResolvedValue([])

    expect(await lib.lib_livekit_translator_start(room_uid)).toBeNull()
    expect(create_dispatch).not.toHaveBeenCalled()
  })
})

describe('lib_livekit_translator_stop', () => {
  test('removes only translator dispatches', async () => {
    list_dispatch.mockResolvedValue([dispatch('AD_1', agent_name), dispatch('AD_2', 'other-agent')])
    delete_dispatch.mockResolvedValue()

    await lib.lib_livekit_translator_stop(room_uid)

    expect(delete_dispatch).toHaveBeenCalledTimes(1)
    expect(delete_dispatch).toHaveBeenCalledWith('AD_1', room_uid)
  })
})

describe('lib_livekit_ensure', () => {
  test('creates the room with the translator when translation is on', async () => {
    list_rooms.mockResolvedValue([])
    create_room.mockResolvedValue(new Room({ name: room_uid }))

    await lib.lib_livekit_ensure({ room_uid, room_max_participants: 12, room_metadata: '{}', room_translation_enabled: true })
    await lib.lib_livekit_ensure({ room_uid, room_max_participants: 12, room_metadata: '{}', room_translation_enabled: false })

    const [with_translation, without_translation] = create_room.mock.calls.map(([options]) => options)
    expect(with_translation?.agents?.map((agent) => agent.agentName)).toEqual([agent_name])
    expect(without_translation?.agents).toBeUndefined()
  })
})
