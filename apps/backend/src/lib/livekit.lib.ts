import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
  ServerError,
  TrackSource,
  WebhookReceiver,
  type ParticipantPermission,
} from 'livekit-server-sdk'
import { room_attribute } from '@contracts/room'
import { lib_error } from '@lib/error.lib'

const api_key = process.env.LIVEKIT_API_KEY!
const api_secret = process.env.LIVEKIT_API_SECRET!
const encoder = new TextEncoder()

export const lib_livekit_room = new RoomServiceClient(process.env.LIVEKIT_URL!, api_key, api_secret)
export const lib_livekit_webhook = new WebhookReceiver(api_key, api_secret)

export const lib_livekit_track_source: Record<string, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
}

const lib_livekit_sources: Record<string, TrackSource[]> = {
  host: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  moderator: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  member: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE],
  viewer: [],
}

export function lib_livekit_identity(user_id: number) {
  return `user_${user_id}`
}

export function lib_livekit_user_id(identity: string) {
  const match = /^user_(\d+)$/.exec(identity)
  return match ? Number(match[1]) : null
}

export function lib_livekit_permission(role: string): Partial<ParticipantPermission> {
  const sources = lib_livekit_sources[role] ?? []
  return {
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishData: true,
    canPublishSources: sources,
    canUpdateMetadata: false,
  }
}

export async function lib_livekit_call<result>(call: () => Promise<result>): Promise<result | null> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof ServerError && (error.status === 404 || error.code === 'not_found')) return null
    console.error('LiveKit call failed', error)
    throw lib_error.livekit_unavailable
  }
}

export async function lib_livekit_token(
  room_uid: string,
  user: { user_id: number; user_name: string; user_language: string },
  role: string,
) {
  const sources = lib_livekit_sources[role] ?? []
  const token = new AccessToken(api_key, api_secret, {
    identity: lib_livekit_identity(user.user_id),
    name: user.user_name,
    ttl: process.env.LIVEKIT_TOKEN_TTL || '5m',
    attributes: {
      [room_attribute.user_id]: String(user.user_id),
      [room_attribute.role]: role,
      [room_attribute.language]: user.user_language,
    },
  })
  token.addGrant({
    roomJoin: true,
    room: room_uid,
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishSources: sources.length > 0 ? sources : undefined,
    canPublishData: true,
    canUpdateOwnMetadata: false,
  })
  return await token.toJwt()
}

export async function lib_livekit_ensure(room: { room_uid: string; room_max_participants: number; room_metadata: string }) {
  const rooms = await lib_livekit_call(() => lib_livekit_room.listRooms([room.room_uid]))
  const existing = rooms?.[0]
  if (existing) return existing
  return await lib_livekit_call(() =>
    lib_livekit_room.createRoom({
      name: room.room_uid,
      emptyTimeout: 300,
      departureTimeout: 20,
      maxParticipants: room.room_max_participants,
      metadata: room.room_metadata,
    }),
  )
}

export async function lib_livekit_broadcast(room_uid: string, topic: string, event: unknown, identities?: string[]) {
  return await lib_livekit_call(() =>
    lib_livekit_room.sendData(room_uid, encoder.encode(JSON.stringify(event)), DataPacket_Kind.RELIABLE, {
      topic,
      destinationIdentities: identities,
    }),
  )
}

export async function lib_livekit_participant(room_uid: string, user_id: number) {
  return await lib_livekit_call(() => lib_livekit_room.getParticipant(room_uid, lib_livekit_identity(user_id)))
}

export async function lib_livekit_role(room_uid: string, user_id: number, role: string) {
  return await lib_livekit_call(() =>
    lib_livekit_room.updateParticipant(room_uid, lib_livekit_identity(user_id), {
      attributes: { [room_attribute.role]: role },
      permission: lib_livekit_permission(role),
    }),
  )
}

export async function lib_livekit_remove(room_uid: string, user_id: number) {
  return await lib_livekit_call(() =>
    lib_livekit_room.removeParticipant(room_uid, lib_livekit_identity(user_id), {
      revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
    }),
  )
}
