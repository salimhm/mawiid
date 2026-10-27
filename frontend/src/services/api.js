// Thin client for the Mawiid backend. Requests go through the dev server's
// /api proxy (see src/index.ts), so no CORS setup is needed and the refresh
// cookie is first-party.
const API_BASE = '/api'
const DEV_TOKEN_KEY = 'mawiid.dev_token'
const STALE_KEYS = ['mawiid.session', 'mawiid.token']
const REFRESH_LOCK = 'mawiid.refresh'

export class ApiError extends Error {
    constructor(code, status) {
        super(code)
        this.code = code
        this.status = status
    }
}

// The session is { status, access_token, user } and lives in memory only.
// status is 'loading' until the first refresh settles, then 'signed-in' or
// 'signed-out'. The refresh token never reaches JavaScript: the backend keeps
// it in an HttpOnly cookie, so a reload restores the session with /auth/refresh.
// A dev token (?token=<jwt> or BUN_PUBLIC_DEV_TOKEN) is an access token only and
// cannot be refreshed.
let session = { status: 'loading', access_token: '', user: null }
const listeners = new Set()
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mawiid.auth')

export function getSession() {
    return session
}

function setSession(next) {
    session = next?.access_token
        ? { status: 'signed-in', access_token: next.access_token, user: next.user || null }
        : { status: 'signed-out', access_token: '', user: null }
    listeners.forEach((listener) => listener())
}

export function subscribeSession(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function readDevToken() {
    try {
        return localStorage.getItem(DEV_TOKEN_KEY) || ''
    } catch {
        return ''
    }
}

function writeDevToken(token) {
    try {
        if (token)
            localStorage.setItem(DEV_TOKEN_KEY, token)
        else
            localStorage.removeItem(DEV_TOKEN_KEY)
    } catch {}
}

// Called once at startup, before the first route change: client-side
// navigation drops the query string.
export function captureTokenFromUrl() {
    try {
        STALE_KEYS.forEach((key) => localStorage.removeItem(key))
    } catch {}
    const fromUrl = new URLSearchParams(window.location.search).get('token')
    if (!fromUrl)
        return
    writeDevToken(fromUrl)
    const url = new URL(window.location.href)
    url.searchParams.delete('token')
    window.history.replaceState(window.history.state, '', url)
}

async function request(path, { method = 'GET', body, token } = {}) {
    const headers = {}
    if (token)
        headers.Authorization = `Bearer ${token}`
    if (body !== undefined)
        headers['Content-Type'] = 'application/json'

    let res
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            credentials: 'same-origin',
            body: body === undefined ? undefined : JSON.stringify(body),
        })
    } catch {
        throw new ApiError('backend-unavailable', 0)
    }

    const json = await res.json().catch(() => ({}))
    if (!res.ok)
        throw new ApiError(json.code || 'internal-server-error', res.status)
    return json.data
}

// A refresh token is single use. Requests in this tab share one refresh, and
// the Web Locks API keeps tabs from refreshing at the same time: the second tab
// waits, then sends the cookie the first one received.
let refreshing = null

function withRefreshLock(run) {
    if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request(REFRESH_LOCK, run)
    return run()
}

function refreshSession() {
    refreshing ??= withRefreshLock(() => request('/auth/refresh', { method: 'POST' }))
        .then((next) => {
            setSession(next)
            return next
        })
        .catch((err) => {
            if (err instanceof ApiError && err.status === 401)
                setSession(null)
            throw err
        })
        .finally(() => {
            refreshing = null
        })
    return refreshing
}

const ready = (() => {
    if (typeof window === 'undefined')
        return Promise.resolve()
    const devToken = readDevToken() || (typeof process !== 'undefined' && process.env.BUN_PUBLIC_DEV_TOKEN) || ''
    if (devToken) {
        session = { status: 'signed-in', access_token: devToken, user: null, dev: true }
        return Promise.resolve()
    }
    return refreshSession().catch(() => setSession(null))
})()

channel?.addEventListener('message', ({ data }) => {
    if (data === 'logout' && session.status === 'signed-in')
        setSession(null)
    if (data === 'login' && session.status !== 'signed-in')
        refreshSession().catch(() => {})
})

export async function apiFetch(path, options = {}) {
    await ready
    const current = getSession()
    if (!current.access_token)
        throw new ApiError('unauthorized', 401)

    try {
        return await request(path, { ...options, token: current.access_token })
    } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'invalid-token')
            throw err
        if (current.dev) {
            writeDevToken('')
            setSession(null)
            throw err
        }
        const next = await refreshSession()
        return await request(path, { ...options, token: next.access_token })
    }
}

const signIn = async (path, body) => {
    const next = await request(path, { method: 'POST', body })
    writeDevToken('')
    setSession(next)
    channel?.postMessage('login')
    return next
}

export const auth = {
    login: (user_identifier, user_password) => signIn('/auth/login', { user_identifier, user_password }),
    register: (fields) => signIn('/auth/register', fields),
    requestCode: (user_phone) => request('/auth/otp', { method: 'POST', body: { user_phone } }),
    loginWithCode: (user_phone, otp_code) => signIn('/auth/otp/login', { user_phone, otp_code }),
    registerWithCode: (fields) => signIn('/auth/otp/register', fields),
    logout: async () => {
        writeDevToken('')
        setSession(null)
        channel?.postMessage('logout')
        await request('/auth/logout', { method: 'POST' }).catch(() => {})
    },
}

export const api = {
    createRoom: (room_title) => apiFetch('/room', { method: 'POST', body: { room_title } }),
    joinRoom: (room_uid) => apiFetch('/room/join', { method: 'POST', body: { room_uid } }),
    eventTicket: () => apiFetch('/event/ticket', { method: 'POST' }).then((data) => data.ticket),
    updateParticipant: (room_uid, changes) => apiFetch('/participant', { method: 'PATCH', body: { room_uid, ...changes } }),
    updateRoomMember: (room_uid, user_id, changes) => apiFetch('/room-member', { method: 'PATCH', body: { room_uid, user_id, ...changes } }),
    deleteRoomMember: (room_uid, user_id, ban) => apiFetch('/room-member', { method: 'DELETE', body: { room_uid, user_id, ban } }),
    updateRoom: (room_uid, changes) => apiFetch('/room', { method: 'PATCH', body: { room_uid, ...changes } }),
    muteParticipant: (room_uid, user_id, track_source, muted) => apiFetch('/participant/mute', { method: 'POST', body: { room_uid, user_id, track_source, muted } }),
    promoteParticipant: (room_uid, user_id) => apiFetch('/participant/promote', { method: 'POST', body: { room_uid, user_id } }),
    demoteParticipant: (room_uid, user_id) => apiFetch('/participant/demote', { method: 'POST', body: { room_uid, user_id } }),
    removeParticipant: (room_uid, user_id, block_minutes) => apiFetch('/participant', { method: 'DELETE', body: { room_uid, user_id, ...(block_minutes ? { block_minutes } : {}) } }),
    // Newest first. Pass before_message_id or after_message_id, not both.
    listMessages: (room_uid, { take, before_message_id, after_message_id } = {}) => {
        const query = new URLSearchParams({ room_uid })
        if (take)
            query.set('take', take)
        if (before_message_id)
            query.set('before_message_id', before_message_id)
        if (after_message_id)
            query.set('after_message_id', after_message_id)
        return apiFetch(`/message?${query}`)
    },
    sendMessage: (room_uid, message_client_id, message_text) => apiFetch('/message', { method: 'POST', body: { room_uid, message_client_id, message_text } }),
}

const ERROR_MESSAGES = {
    'unauthorized': 'You are not signed in. Please sign in to continue.',
    'invalid-token': 'Your session has expired. Please sign in again.',
    'invalid-credentials': 'Incorrect username, email or password.',
    'user-email-exist': 'An account already uses this email. Sign in instead.',
    'user-username-exist': 'This username is taken. Choose another one.',
    'invalid-otp-code': 'That code is incorrect. Check it and try again.',
    'code-expired': 'This code has expired. Request a new one.',
    'user-not-found': 'No account uses this phone number yet.',
    'user-phone-exist': 'An account already uses this phone number. Sign in instead.',
    'too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'service-unavailable': 'Sign-in codes cannot be sent right now. Try again later.',
    'forbidden': 'You are not allowed to join this room.',
    'participant-not-found': 'That participant is no longer connected.',
    'track-not-found': 'That participant is not sharing this yet.',
    'room-member-not-found': 'That person is no longer a member of this room.',
    'bad-request': 'That action does not apply to this participant.',
    'room-not-found': 'This room does not exist. Check the code and try again.',
    'vault-unavailable': 'Your workspace could not be set up right now. Try again in a moment.',
    'room-closed': 'This room has been closed.',
    'room-locked': 'This room is locked by the host.',
    'room-not-open': 'This room is not open, so messages cannot be sent.',
    'room-waiting': 'Waiting for the host to let you in…',
    'unprocessable-entity': 'Some of the information is invalid. Check it and try again.',
    'livekit-unavailable': 'The media server is unavailable. Try again shortly.',
    'backend-unavailable': 'Cannot reach the Mawiid server.',
}

export function errorMessage(error) {
    const code = error instanceof ApiError ? error.code : ''
    return ERROR_MESSAGES[code] || 'Something went wrong. Please try again.'
}
