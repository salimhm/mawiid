import { RoomEvent } from 'livekit-client'

// LiveKit data messages (typing, reactions, moderation notices). Port of
// create_participant_signal from
// apps/backend/src/module/main/participants/participant.client.ts.
// Keep in sync with packages/contracts/src/room.ts
export const ROOM_TOPIC = {
    moderation: 'mawiid.moderation.v1',
    typing: 'mawiid.typing.v1',
    reaction: 'mawiid.reaction.v1',
}

const LIMIT = {
    typingIntervalMs: 3000,
    typingExpireMs: 5000,
    reactionIntervalMs: 250,
    reactionMaxLength: 16,
    payloadMaxBytes: 1024,
}

const MODERATION_TYPES = ['participant.muted', 'participant.unmute_requested', 'participant.role_changed']
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function parse(payload) {
    if (!payload || payload.byteLength === 0 || payload.byteLength > LIMIT.payloadMaxBytes)
        return null
    try {
        return JSON.parse(decoder.decode(payload))
    } catch {
        return null
    }
}

export function isValidReaction(reaction) {
    const length = [...reaction].length
    return length > 0 && length <= LIMIT.reactionMaxLength && reaction.trim() === reaction
}

const isTyping = (value) => isRecord(value) && value.type === 'typing' && typeof value.typing === 'boolean'

const isReaction = (value) =>
    isRecord(value)
    && value.type === 'reaction'
    && typeof value.reaction_id === 'string'
    && value.reaction_id.length <= 64
    && typeof value.reaction === 'string'
    && isValidReaction(value.reaction)

const isModeration = (value) =>
    isRecord(value)
    && MODERATION_TYPES.includes(value.type)
    && typeof value.room_uid === 'string'
    && (typeof value.track_source === 'string' || typeof value.room_member_role === 'string')

export function createRoomSignal(room, { onTyping, onReaction, onModeration } = {}) {
    const typingTimers = new Map()
    let typingActive = false
    let typingSentAt = 0
    let typingIdle
    let reactionSentAt = 0

    const setTyping = (participant, typing) => {
        const timer = typingTimers.get(participant.identity)
        if (timer)
            clearTimeout(timer)
        typingTimers.delete(participant.identity)
        if (typing)
            typingTimers.set(participant.identity, setTimeout(() => setTyping(participant, false), LIMIT.typingExpireMs))
        if (typing || timer)
            onTyping?.(participant, typing)
    }

    // Moderation notices are only trusted when sent by the server (no participant).
    const onData = (payload, participant, _kind, topic) => {
        if (topic === ROOM_TOPIC.moderation) {
            if (participant)
                return
            const event = parse(payload)
            if (isModeration(event))
                onModeration?.(event)
            return
        }
        if (!participant)
            return
        const event = parse(payload)
        if (topic === ROOM_TOPIC.typing && isTyping(event))
            setTyping(participant, event.typing)
        if (topic === ROOM_TOPIC.reaction && isReaction(event))
            onReaction?.(participant, event)
    }

    const onDisconnected = (participant) => setTyping(participant, false)

    const publish = (topic, event, reliable) =>
        room.localParticipant.publishData(encoder.encode(JSON.stringify(event)), { topic, reliable })

    // Sent at most once per interval while typing, then once when typing stops.
    const sendTyping = async (typing) => {
        clearTimeout(typingIdle)
        if (typing)
            typingIdle = setTimeout(() => sendTyping(false), LIMIT.typingIntervalMs)
        const now = Date.now()
        if (typing && typingActive && now - typingSentAt < LIMIT.typingIntervalMs)
            return false
        if (!typing && !typingActive)
            return false
        typingActive = typing
        typingSentAt = typing ? now : 0
        await publish(ROOM_TOPIC.typing, { type: 'typing', typing }, false)
        return true
    }

    const sendReaction = async (reaction) => {
        if (!isValidReaction(reaction))
            return null
        const now = Date.now()
        if (now - reactionSentAt < LIMIT.reactionIntervalMs)
            return null
        reactionSentAt = now
        const event = { type: 'reaction', reaction_id: crypto.randomUUID(), reaction }
        await publish(ROOM_TOPIC.reaction, event, true)
        return event
    }

    const close = () => {
        room.off(RoomEvent.DataReceived, onData)
        room.off(RoomEvent.ParticipantDisconnected, onDisconnected)
        clearTimeout(typingIdle)
        typingTimers.forEach((timer) => clearTimeout(timer))
        typingTimers.clear()
    }

    room.on(RoomEvent.DataReceived, onData)
    room.on(RoomEvent.ParticipantDisconnected, onDisconnected)

    return { sendTyping, sendReaction, close }
}
