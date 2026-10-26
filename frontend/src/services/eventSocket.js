import { api } from './api'

// Backend realtime socket (lobby events). Port of create_participant_socket
// from apps/backend/src/module/main/participants/participant.client.ts.
export const ROOM_SOCKET_EVENT = {
    knock: 'room.knock',
    admitted: 'room.admitted',
}

const PING_MS = 20000
const MAX_DELAY_MS = 30000

export function createEventSocket({ onKnock, onAdmitted } = {}) {
    const admittedWaiters = new Map()
    let socket = null
    let closed = false
    let attempt = 0
    let ping
    let retry

    const onEnvelope = (envelope) => {
        const data = envelope.data
        if (!data || typeof data.room_uid !== 'string')
            return

        if (envelope.type === ROOM_SOCKET_EVENT.knock && typeof data.user_id === 'number')
            onKnock?.(data)

        if (envelope.type === ROOM_SOCKET_EVENT.admitted) {
            onAdmitted?.(data)
            const waiters = admittedWaiters.get(data.room_uid)
            admittedWaiters.delete(data.room_uid)
            waiters?.forEach((resolve) => resolve())
        }
    }

    const schedule = () => {
        clearInterval(ping)
        if (closed)
            return
        const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** attempt)
        attempt += 1
        retry = setTimeout(connect, delay)
    }

    async function connect() {
        if (closed)
            return
        try {
            const ticket = await api.eventTicket()
            if (closed)
                return
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
            const current = new WebSocket(`${protocol}://${window.location.host}/api/event/ws?ticket=${encodeURIComponent(ticket)}`)
            socket = current
            current.onopen = () => {
                attempt = 0
                ping = setInterval(() => current.send('ping'), PING_MS)
            }
            current.onmessage = (message) => {
                if (typeof message.data !== 'string' || message.data === 'pong')
                    return
                try {
                    const envelope = JSON.parse(message.data)
                    if (envelope?.version === 1 && typeof envelope.type === 'string')
                        onEnvelope(envelope)
                } catch {}
            }
            current.onclose = () => {
                if (socket === current)
                    schedule()
            }
        } catch {
            schedule()
        }
    }

    const waitAdmitted = (room_uid) => new Promise((resolve) => {
        const waiters = admittedWaiters.get(room_uid) ?? new Set()
        waiters.add(resolve)
        admittedWaiters.set(room_uid, waiters)
    })

    const close = () => {
        closed = true
        clearInterval(ping)
        clearTimeout(retry)
        socket?.close()
        socket = null
    }

    connect()

    return { waitAdmitted, close }
}
