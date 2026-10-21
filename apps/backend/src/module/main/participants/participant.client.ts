import { RoomEvent, type DataPacket_Kind, type RemoteParticipant, type Room } from 'livekit-client'
import {
  room_signal_limit,
  room_socket_event,
  room_topic,
  type type_room_event_admitted,
  type type_room_event_knock,
  type type_room_event_moderation,
  type type_room_event_reaction,
  type type_room_event_typing,
  type type_room_socket_envelope,
} from '@contracts/room'

export type type_participant_signal_handler = {
  on_typing?: (identity: string, typing: boolean) => void
  on_reaction?: (identity: string, event: type_room_event_reaction) => void
  on_moderation?: (event: type_room_event_moderation) => void
}

export type type_participant_socket_handler = {
  on_knock?: (data: type_room_event_knock) => void
  on_admitted?: (data: type_room_event_admitted) => void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const participant_moderation_types = ['participant.muted', 'participant.unmute_requested', 'participant.role_changed']
const participant_socket_ping_ms = 20000
const participant_socket_max_delay_ms = 30000

function participant_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function participant_parse(payload: Uint8Array | string) {
  const size = typeof payload === 'string' ? payload.length : payload.byteLength
  if (size === 0 || size > room_signal_limit.payload_max_bytes) return null
  try {
    return JSON.parse(typeof payload === 'string' ? payload : decoder.decode(payload)) as unknown
  } catch {
    return null
  }
}

export function participant_reaction_valid(reaction: string) {
  const length = [...reaction].length
  return length > 0 && length <= room_signal_limit.reaction_max_length && reaction.trim() === reaction
}

function participant_is_typing(value: unknown): value is type_room_event_typing {
  return participant_record(value) && value.type === 'typing' && typeof value.typing === 'boolean'
}

function participant_is_reaction(value: unknown): value is type_room_event_reaction {
  return (
    participant_record(value) &&
    value.type === 'reaction' &&
    typeof value.reaction_id === 'string' &&
    value.reaction_id.length <= 64 &&
    typeof value.reaction === 'string' &&
    participant_reaction_valid(value.reaction)
  )
}

function participant_is_moderation(value: unknown): value is type_room_event_moderation {
  return (
    participant_record(value) &&
    typeof value.type === 'string' &&
    participant_moderation_types.includes(value.type) &&
    typeof value.room_uid === 'string' &&
    (typeof value.track_source === 'string' || typeof value.room_member_role === 'string')
  )
}

function participant_is_knock(value: unknown): value is type_room_event_knock {
  return participant_record(value) && typeof value.room_uid === 'string' && typeof value.user_id === 'number'
}

function participant_is_admitted(value: unknown): value is type_room_event_admitted {
  return participant_record(value) && typeof value.room_uid === 'string'
}

export function create_participant_signal(room: Room, handler: type_participant_signal_handler) {
  const typing_timer = new Map<string, ReturnType<typeof setTimeout>>()
  let typing_active = false
  let typing_sent_at = 0
  let typing_idle: ReturnType<typeof setTimeout> | undefined
  let reaction_sent_at = 0

  function typing_set(identity: string, typing: boolean) {
    const timer = typing_timer.get(identity)
    if (timer) clearTimeout(timer)
    typing_timer.delete(identity)
    if (typing) {
      typing_timer.set(
        identity,
        setTimeout(() => typing_set(identity, false), room_signal_limit.typing_expire_ms),
      )
    }
    if (typing || timer) handler.on_typing?.(identity, typing)
  }

  function on_data(payload: Uint8Array, participant?: RemoteParticipant, _kind?: DataPacket_Kind, topic?: string) {
    if (topic === room_topic.moderation) {
      if (participant) return
      const event = participant_parse(payload)
      if (participant_is_moderation(event)) handler.on_moderation?.(event)
      return
    }
    if (!participant) return
    if (topic === room_topic.typing) {
      const event = participant_parse(payload)
      if (participant_is_typing(event)) typing_set(participant.identity, event.typing)
      return
    }
    if (topic === room_topic.reaction) {
      const event = participant_parse(payload)
      if (participant_is_reaction(event)) handler.on_reaction?.(participant.identity, event)
    }
  }

  function on_disconnected(participant: RemoteParticipant) {
    typing_set(participant.identity, false)
  }

  async function publish(topic: string, event: unknown, reliable: boolean) {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(event)), { topic, reliable })
  }

  async function send_typing(typing: boolean) {
    clearTimeout(typing_idle)
    if (typing) typing_idle = setTimeout(() => void send_typing(false), room_signal_limit.typing_interval_ms)
    const now = Date.now()
    if (typing && typing_active && now - typing_sent_at < room_signal_limit.typing_interval_ms) return false
    if (!typing && !typing_active) return false
    typing_active = typing
    typing_sent_at = typing ? now : 0
    const event: type_room_event_typing = { type: 'typing', typing }
    await publish(room_topic.typing, event, false)
    return true
  }

  async function send_reaction(reaction: string) {
    if (!participant_reaction_valid(reaction)) return false
    const now = Date.now()
    if (now - reaction_sent_at < room_signal_limit.reaction_interval_ms) return false
    reaction_sent_at = now
    const event: type_room_event_reaction = { type: 'reaction', reaction_id: crypto.randomUUID(), reaction }
    await publish(room_topic.reaction, event, true)
    return true
  }

  function close() {
    room.off(RoomEvent.DataReceived, on_data)
    room.off(RoomEvent.ParticipantDisconnected, on_disconnected)
    clearTimeout(typing_idle)
    for (const timer of typing_timer.values()) clearTimeout(timer)
    typing_timer.clear()
  }

  room.on(RoomEvent.DataReceived, on_data)
  room.on(RoomEvent.ParticipantDisconnected, on_disconnected)

  return { send_typing, send_reaction, close }
}

export function create_participant_socket(
  base_url: string,
  ticket: () => Promise<string>,
  handler: type_participant_socket_handler,
) {
  const admitted_waiter = new Map<string, Set<() => void>>()
  let socket: WebSocket | null = null
  let closed = false
  let attempt = 0
  let ping: ReturnType<typeof setInterval> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  function on_envelope(envelope: type_room_socket_envelope) {
    if (envelope.type === room_socket_event.knock && participant_is_knock(envelope.data)) {
      handler.on_knock?.(envelope.data)
    }
    if (envelope.type === room_socket_event.admitted && participant_is_admitted(envelope.data)) {
      handler.on_admitted?.(envelope.data)
      const waiters = admitted_waiter.get(envelope.data.room_uid)
      admitted_waiter.delete(envelope.data.room_uid)
      for (const resolve of waiters ?? []) resolve()
    }
  }

  function schedule() {
    clearInterval(ping)
    if (closed) return
    const delay = Math.min(participant_socket_max_delay_ms, 1000 * 2 ** attempt)
    attempt += 1
    retry = setTimeout(() => void connect(), delay)
  }

  async function connect() {
    if (closed) return
    try {
      const url = new URL('/event/ws', base_url)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', await ticket())
      const current = new WebSocket(url)
      socket = current
      current.onopen = () => {
        attempt = 0
        ping = setInterval(() => current.send('ping'), participant_socket_ping_ms)
      }
      current.onmessage = (message) => {
        if (typeof message.data !== 'string' || message.data === 'pong') return
        const envelope = participant_parse(message.data)
        if (participant_record(envelope) && typeof envelope.type === 'string' && envelope.version === 1) {
          on_envelope(envelope as type_room_socket_envelope)
        }
      }
      current.onclose = () => {
        if (socket === current) schedule()
      }
    } catch {
      schedule()
    }
  }

  function wait_admitted(room_uid: string) {
    return new Promise<void>((resolve) => {
      const waiters = admitted_waiter.get(room_uid) ?? new Set()
      waiters.add(resolve)
      admitted_waiter.set(room_uid, waiters)
    })
  }

  function close() {
    closed = true
    clearInterval(ping)
    clearTimeout(retry)
    socket?.close()
    socket = null
  }

  void connect()

  return { wait_admitted, close }
}
