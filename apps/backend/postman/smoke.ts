// End-to-end smoke test through the frontend dev server's /api proxy.
// Needs the backend (postman:dev), the frontend and LiveKit running, and seeded data.
// No request here changes room data or writes to the audit log.
import { createClient } from '@libsql/client'
import { join } from 'node:path'

const frontend_url = process.env.FRONTEND_URL || 'http://localhost:3100'
const api_url = `${frontend_url}/api`
const environment = (await Bun.file(join(import.meta.dir, 'mawiid.postman_environment.json')).json()) as {
  values: { key: string; value: string }[]
}
const token = (key: string) => environment.values.find((value) => value.key === `token_${key}`)?.value ?? ''

// The Postman environment file can be older than the local data, so the room is read from the database.
const main_db = createClient({ url: `file:${join(import.meta.dir, 'data/main.db')}` })
const route = await main_db.execute('select room_uid from room_route where deleted_at is null order by room_route_id limit 1')
main_db.close()
const room_uid = String(route.rows[0]?.room_uid ?? '')

let failed = 0

async function check(name: string, run: () => Promise<void>) {
  try {
    await run()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name}: ${error instanceof Error ? error.message : error}`)
  }
}

async function request(method: string, path: string, user?: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (user) headers.authorization = `Bearer ${token(user)}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${api_url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

async function expect_status(method: string, path: string, user: string | undefined, body: unknown, status: number, code?: string) {
  const res = await request(method, path, user, body)
  if (res.status !== status || (code && res.body?.code !== code)) {
    throw new Error(`expected ${status}${code ? ` ${code}` : ''}, got ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body
}

function socket(ticket: string) {
  return new Promise<{ code: number; reason: string; pong: boolean }>((resolve, reject) => {
    const url = new URL(`${api_url}/event/ws`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('ticket', ticket)
    const ws = new WebSocket(url)
    let pong = false
    const timer = setTimeout(() => reject(new Error('socket timed out')), 5000)
    // Give the backend time to validate the ticket before pinging.
    ws.onopen = () => setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 500)
    ws.onmessage = (event) => {
      if (event.data === 'pong') {
        pong = true
        ws.close(1000)
      }
    }
    ws.onclose = (event) => {
      clearTimeout(timer)
      resolve({ code: event.code, reason: event.reason, pong })
    }
  })
}

console.log(`Smoke test against ${frontend_url} (room ${room_uid || 'not found'})\n`)

await check('frontend serves the app on client routes', async () => {
  const res = await fetch(`${frontend_url}/meet/anything`)
  if (res.status !== 200 || !(await res.text()).includes('<div id="root">')) throw new Error(`got ${res.status}`)
})

await check('proxy reaches backend /health', async () => {
  await expect_status('GET', '/health', undefined, undefined, 200)
})

await check('seeded room exists', async () => {
  if (!room_uid) throw new Error('no room in postman/data/main.db, run `make seed`')
})

await check('join without token is rejected', async () => {
  await expect_status('POST', '/room/join', undefined, { room_uid }, 401, 'unauthorized')
})

await check('join with an invalid token is rejected', async () => {
  const res = await fetch(`${api_url}/room/join`, {
    method: 'POST',
    headers: { authorization: 'Bearer not-a-jwt', 'content-type': 'application/json' },
    body: JSON.stringify({ room_uid }),
  })
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
})

await check('join an unknown room returns room-not-found', async () => {
  await expect_status('POST', '/room/join', 'host', { room_uid: crypto.randomUUID() }, 404, 'room-not-found')
})

await check('non-member cannot join', async () => {
  await expect_status('POST', '/room/join', 'outsider', { room_uid }, 403, 'forbidden')
})

await check('host joins and gets a LiveKit token', async () => {
  const body = await expect_status('POST', '/room/join', 'host', { room_uid }, 200)
  if (!body.data.participant_token || !body.data.server_url) throw new Error('missing server_url or participant_token')
  if (body.data.room_member_role !== 'host') throw new Error(`role is ${body.data.room_member_role}`)
})

await check('member joins with the member role', async () => {
  const body = await expect_status('POST', '/room/join', 'member', { room_uid }, 200)
  if (body.data.room_member_role !== 'member') throw new Error(`role is ${body.data.room_member_role}`)
})

await check('member cannot change room settings', async () => {
  await expect_status('PATCH', '/room', 'member', { room_uid, room_locked: true }, 403, 'forbidden')
})

await check('member cannot read the audit log', async () => {
  await expect_status('GET', `/audit?room_uid=${room_uid}`, 'member', undefined, 403, 'forbidden')
})

await check('host can read the audit log', async () => {
  const body = await expect_status('GET', `/audit?room_uid=${room_uid}&take=1`, 'host', undefined, 200)
  if (!Array.isArray(body.data)) throw new Error('data is not a list')
})

await check('invalid body is rejected', async () => {
  await expect_status('POST', '/room/join', 'host', { room_uid: 42 }, 422, 'validation-error')
})

await check('event socket answers ping with a valid ticket', async () => {
  const body = await expect_status('POST', '/event/ticket', 'member', undefined, 200)
  const result = await socket(body.data.ticket)
  if (!result.pong) throw new Error(`no pong, closed with ${result.code} ${result.reason}`)
})

await check('event socket rejects an invalid ticket with 4401', async () => {
  const result = await socket('invalid-ticket')
  if (result.code !== 4401) throw new Error(`closed with ${result.code} ${result.reason}`)
})

const refresh_cookie = '__Host-mawiid_refresh'

async function auth_post(path: string, body?: unknown, refresh_token?: string) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (refresh_token) headers.cookie = `${refresh_cookie}=${refresh_token}`
  const res = await fetch(`${api_url}${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const set_cookie = res.headers.getSetCookie().find((value) => value.startsWith(`${refresh_cookie}=`)) ?? ''
  return { status: res.status, body: (await res.json().catch(() => null)) as any, set_cookie, refresh_token: set_cookie.split(';')[0]!.slice(refresh_cookie.length + 1) }
}

await check('password login by email sets a secure HttpOnly refresh cookie', async () => {
  const res = await auth_post('/auth/login', { user_identifier: 'host@mawiid.test', user_password: 'mawiid-password' })
  if (res.status !== 200 || !res.body.data.access_token) throw new Error(`got ${res.status} ${JSON.stringify(res.body)}`)
  if ('refresh_token' in res.body.data) throw new Error('refresh token leaked in the body')
  if (!/HttpOnly/i.test(res.set_cookie) || !/Secure/i.test(res.set_cookie) || !/SameSite=Strict/i.test(res.set_cookie)) throw new Error(`cookie is ${res.set_cookie}`)
})

await check('password login with a wrong password is rejected', async () => {
  const res = await auth_post('/auth/login', { user_identifier: 'member', user_password: 'not-the-password' })
  if (res.status !== 401 || res.body?.code !== 'invalid-credentials') throw new Error(`got ${res.status} ${JSON.stringify(res.body)}`)
})

await check('refresh rotates the cookie, logout revokes it', async () => {
  const login = await auth_post('/auth/login', { user_identifier: 'viewer', user_password: 'mawiid-password' })
  const refreshed = await auth_post('/auth/refresh', undefined, login.refresh_token)
  if (refreshed.status !== 200 || !refreshed.refresh_token || refreshed.refresh_token === login.refresh_token) throw new Error(`refresh got ${refreshed.status}`)
  await auth_post('/auth/logout', undefined, refreshed.refresh_token)
  const after = await auth_post('/auth/refresh', undefined, refreshed.refresh_token)
  if (after.status !== 401) throw new Error(`refresh after logout got ${after.status}`)
})

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
