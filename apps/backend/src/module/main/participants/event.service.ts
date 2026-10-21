import type { RedisClient, Server } from 'bun'
import type { Static } from 'elysia'
import type { lib_dto_payload } from '@lib/dto.lib'
import type { type_room_socket_envelope, type_room_socket_type } from '@contracts/room'
import { dto_event } from '@module/main/participants/event.dto'

const event_channel = 'ws:event'
const ticket_ttl_seconds = 30

type event_message = {
  topics: string[]
  event: type_room_socket_envelope
}

export function event_user_topic(user_id: number) {
  return `user:${user_id}`
}

export const service_event = {
  async ticket(payload: lib_dto_payload, redis: RedisClient): Promise<Static<typeof dto_event.ticket.response>> {
    const ticket = crypto.randomUUID()
    await redis.set(`ws_ticket:${ticket}`, String(payload.user_id), 'EX', ticket_ttl_seconds)
    return { data: { ticket, expires_in: ticket_ttl_seconds } }
  },

  async open(ticket: string, redis: RedisClient) {
    const user_id = Number(await redis.getdel(`ws_ticket:${ticket}`))
    return Number.isInteger(user_id) && user_id > 0 ? user_id : null
  },

  async publish(redis: RedisClient, user_ids: number[], type: type_room_socket_type, data: unknown) {
    if (user_ids.length === 0) return
    const message: event_message = {
      topics: [...new Set(user_ids)].map(event_user_topic),
      event: { type, version: 1, data, sent_at: new Date().toISOString() },
    }
    await redis.publish(event_channel, JSON.stringify(message))
  },

  async relay(server: Server<unknown>, redis: RedisClient) {
    const subscriber = await redis.duplicate()
    await subscriber.subscribe(event_channel, (raw) => {
      try {
        const message = JSON.parse(raw) as event_message
        const data = JSON.stringify(message.event)
        for (const topic of message.topics) server.publish(topic, data)
      } catch (error) {
        console.error('Could not relay a socket event', error)
      }
    })
    return subscriber
  },
}
