import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { DisconnectReason, Room, RoomEvent, Track } from 'livekit-client'
import { api, ApiError, errorMessage } from '../services/api'
import { createEventSocket } from '../services/eventSocket'
import { createRoomSignal } from '../services/roomSignal'
import { createRoomCaptions } from '../services/roomCaption'

// Keep in sync with packages/contracts/src/room.ts
const ATTRIBUTE = {
    userId: 'mawiid.user_id',
    role: 'mawiid.role',
    language: 'mawiid.language',
    handRaised: 'mawiid.hand_raised',
}
const KNOCK_RETRY_MS = 10000
const REACTION_VISIBLE_MS = 4000
const STAFF_ROLES = ['host', 'moderator']
const MESSAGE_PAGE = 50
const MESSAGE_PAGE_MAX = 100
const CAPTION_VISIBLE_MS = 6000
const CAPTION_MAX = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const userIdOf = (identity, attributes) =>
    Number(attributes[ATTRIBUTE.userId]) || Number(/^user_(\d+)$/.exec(identity)?.[1]) || null

// A message is identified by its sender and message_client_id, so the
// optimistic copy, the HTTP response and the LiveKit event all collapse into
// one entry. Saved messages are ordered by message_id; unsent ones go last.
const messageKey = (userId, clientId) => `${userId}:${clientId}`

const fromServer = (message) => ({
    key: messageKey(message.user_id, message.message_client_id),
    id: message.message_id,
    clientId: message.message_client_id,
    userId: message.user_id,
    text: message.message_text,
    createdAt: new Date(message.created_at).toISOString(),
    status: 'sent',
})

function mergeMessages(current, incoming) {
    const byKey = new Map(current.map((message) => [message.key, message]))
    for (const message of incoming) {
        const existing = byKey.get(message.key)
        if (!existing || existing.status !== 'sent' || message.status === 'sent')
            byKey.set(message.key, message)
    }
    return [...byKey.values()].sort((a, b) => {
        if (a.id && b.id)
            return a.id - b.id
        if (a.id || b.id)
            return a.id ? -1 : 1
        return a.createdAt.localeCompare(b.createdAt)
    })
}

const lastSavedId = (messages) => messages.reduce((max, message) => Math.max(max, message.id || 0), 0)

// Room settings travel in the LiveKit room metadata (see service_room.metadata).
const toSettings = (room) => ({
    locked: Boolean(room.room_locked),
    lobby: Boolean(room.room_lobby_enabled),
    translation: Boolean(room.room_translation_enabled),
})

function readSettings(metadata) {
    try {
        return toSettings(JSON.parse(metadata || '{}'))
    } catch {
        return null
    }
}

const baseLanguage = (code) => (code || '').split('-')[0].toLowerCase()

// The participant who published the captioned track (the speaker).
function trackOwner(room, trackId) {
    return [room.localParticipant, ...room.remoteParticipants.values()]
        .find((participant) => participant.trackPublications.has(trackId)) || null
}

// A translation replaces the original of the same segment, never the other way round:
// the original final arrives first, its translation a moment later.
function mergeCaption(current, caption) {
    const existing = current.find((entry) => entry.id === caption.id)
    if (!existing)
        return [...current, caption].slice(-CAPTION_MAX)
    if (existing.translated && !caption.translated)
        return current
    return current.map((entry) => (entry.id === caption.id ? caption : entry))
}

export function useRoom(roomUid, {
    initialCamOn = false,
    initialMicOn = false,
    videoDeviceId = '',
    audioDeviceId = '',
    speakerDeviceId = '',
} = {}) {
    const roomRef = useRef(null)
    const signalRef = useRef(null)
    const streamCache = useRef(new Map())

    const [status, setStatus] = useState('connecting')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [localUser, setLocalUser] = useState({ id: 'local', name: 'You', isLocal: true })
    const [participants, setParticipants] = useState([])
    const [knocks, setKnocks] = useState([])
    const [typing, setTyping] = useState([])
    const [reactions, setReactions] = useState([])
    const [settings, setSettings] = useState({ locked: false, lobby: false, translation: false })
    const [captions, setCaptions] = useState([])
    const [messages, setMessages] = useState([])
    const [hasOlderMessages, setHasOlderMessages] = useState(false)
    // Newest message_id in the history loaded on join: those count as read.
    const [joinedAtMessageId, setJoinedAtMessageId] = useState(0)
    const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
    const messagesRef = useRef(messages)
    messagesRef.current = messages

    const addMessages = useCallback((incoming) => {
        if (incoming.length)
            setMessages((prev) => mergeMessages(prev, incoming))
    }, [])

    // Fetches everything after the newest saved message. The API returns the
    // newest page first, so a full page means a gap, filled with before cursors.
    const catchUpMessages = useCallback(async () => {
        const after = lastSavedId(messagesRef.current)
        if (!after)
            return
        let page = await api.listMessages(roomUid, { after_message_id: after, take: MESSAGE_PAGE_MAX })
        addMessages(page.map(fromServer))
        while (page.length === MESSAGE_PAGE_MAX) {
            const before = Math.min(...page.map((message) => message.message_id))
            page = (await api.listMessages(roomUid, { before_message_id: before, take: MESSAGE_PAGE_MAX }))
                .filter((message) => message.message_id > after)
            addMessages(page.map(fromServer))
        }
    }, [roomUid, addMessages])

    // One MediaStream per track, so tiles don't re-attach on every refresh.
    const streamFor = useCallback((track) => {
        const mediaTrack = track?.mediaStreamTrack
        if (!mediaTrack)
            return null
        let stream = streamCache.current.get(mediaTrack.id)
        if (!stream) {
            stream = new MediaStream([mediaTrack])
            streamCache.current.set(mediaTrack.id, stream)
        }
        return stream
    }, [])

    const toParticipant = useCallback((participant, isLocal) => {
        const screen = participant.getTrackPublication(Track.Source.ScreenShare)
        const camera = participant.getTrackPublication(Track.Source.Camera)
        const microphone = participant.getTrackPublication(Track.Source.Microphone)
        const video = screen?.track && !screen.isMuted ? screen : camera
        const attributes = participant.attributes || {}

        return {
            id: participant.identity,
            userId: userIdOf(participant.identity, attributes),
            name: isLocal ? `${participant.name || 'You'} (You)` : participant.name || participant.identity,
            role: attributes[ATTRIBUTE.role] || '',
            language: attributes[ATTRIBUTE.language] || '',
            handRaised: attributes[ATTRIBUTE.handRaised] === 'true',
            stream: streamFor(video?.track),
            isCamOn: Boolean(video?.track && !video.isMuted),
            // From the publication, not the received track: a remote track
            // is only set once its media arrives, which can fail or lag.
            isCamPublished: Boolean(camera && !camera.isMuted),
            isMicOn: Boolean(microphone && !microphone.isMuted),
            isScreenSharing: Boolean(screen?.track && !screen.isMuted),
            isLocal,
        }
    }, [streamFor])

    const showReaction = useCallback((name, event) => {
        setReactions((prev) => [...prev, { id: event.reaction_id, name, reaction: event.reaction }])
        setTimeout(() => setReactions((prev) => prev.filter((entry) => entry.id !== event.reaction_id)), REACTION_VISIBLE_MS)
    }, [])

    const refresh = useCallback(() => {
        const room = roomRef.current
        if (!room)
            return
        setLocalUser(toParticipant(room.localParticipant, true))
        // The AI translation worker joins as a participant too; it has no tile.
        setParticipants([...room.remoteParticipants.values()].filter((p) => !p.isAgent).map((p) => toParticipant(p, false)))
    }, [toParticipant])

    const showCaption = useCallback((caption) => {
        const room = roomRef.current
        if (!room)
            return
        const speaker = trackOwner(room, caption.trackId)
        const myLanguage = room.localParticipant.attributes?.[ATTRIBUTE.language]
        setCaptions((prev) => mergeCaption(prev, {
            id: caption.segmentId,
            speaker: speaker === room.localParticipant ? 'You' : speaker?.name || speaker?.identity || 'Speaker',
            text: caption.text,
            final: caption.final,
            translated: caption.translated,
            foreign: !caption.translated && Boolean(myLanguage) && baseLanguage(caption.language) !== baseLanguage(myLanguage),
            shownAt: Date.now(),
        }))
    }, [])

    useEffect(() => {
        if (!captions.length)
            return
        const timer = setInterval(() => {
            const now = Date.now()
            setCaptions((prev) => {
                const kept = prev.filter((caption) => now - caption.shownAt < CAPTION_VISIBLE_MS)
                return kept.length === prev.length ? prev : kept
            })
        }, 1000)
        return () => clearInterval(timer)
    }, [captions.length])

    useEffect(() => {
        if (!roomUid)
            return

        let cancelled = false
        const audioElements = new Set()
        const room = new Room({
            adaptiveStream: true,
            dynacast: true,
            videoCaptureDefaults: videoDeviceId ? { deviceId: videoDeviceId } : undefined,
            audioCaptureDefaults: audioDeviceId ? { deviceId: audioDeviceId } : undefined,
            audioOutput: speakerDeviceId ? { deviceId: speakerDeviceId } : undefined,
        })
        roomRef.current = room

        // Opened before joining so staff receive knocks and guests in the
        // lobby receive room.admitted.
        const socket = createEventSocket({
            onKnock: ({ room_uid, user_id, user_name }) => {
                if (room_uid === roomUid)
                    setKnocks((prev) => (prev.some((knock) => knock.userId === user_id) ? prev : [...prev, { userId: user_id, userName: user_name || `User #${user_id}` }]))
            },
        })

        const onTrackSubscribed = (track) => {
            if (track.kind === Track.Kind.Audio) {
                const element = track.attach()
                element.hidden = true
                document.body.appendChild(element)
                audioElements.add(element)
            }
            refresh()
        }

        const onTrackUnsubscribed = (track) => {
            track.detach().forEach((element) => {
                element.remove()
                audioElements.delete(element)
            })
            if (track.mediaStreamTrack)
                streamCache.current.delete(track.mediaStreamTrack.id)
            refresh()
        }

        const signal = createRoomSignal(room, {
            onMessage: (event) => {
                if (event.room_uid === roomUid)
                    addMessages([fromServer(event)])
            },
            onModeration: (event) => {
                if (event.type === 'participant.muted')
                    setNotice(`Your ${event.track_source.replace(/_/g, ' ')} was muted by a moderator`)
                if (event.type === 'participant.unmute_requested')
                    setNotice(`A moderator asked you to turn on your ${event.track_source.replace(/_/g, ' ')}`)
                if (event.type === 'participant.role_changed')
                    setNotice(`Your role is now ${event.room_member_role}`)
                refresh()
            },
            onTyping: (participant, isTyping) => {
                setTyping((prev) => {
                    const others = prev.filter((entry) => entry.id !== participant.identity)
                    return isTyping ? [...others, { id: participant.identity, name: participant.name || participant.identity }] : others
                })
            },
            onReaction: (participant, event) => showReaction(participant.name || participant.identity, event),
        })
        signalRef.current = signal
        const captionFeed = createRoomCaptions(room, { onCaption: showCaption })

        const onMetadata = (metadata) => {
            const next = readSettings(metadata)
            if (!next)
                return
            setSettings(next)
            if (!next.translation)
                setCaptions([])
        }

        const onDisconnected = (reason) => {
            if (!cancelled)
                setStatus(reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed' : 'disconnected')
        }

        room
            .on(RoomEvent.ParticipantConnected, refresh)
            .on(RoomEvent.ParticipantDisconnected, refresh)
            .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
            .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
            .on(RoomEvent.TrackMuted, refresh)
            .on(RoomEvent.TrackUnmuted, refresh)
            .on(RoomEvent.LocalTrackPublished, refresh)
            .on(RoomEvent.LocalTrackUnpublished, refresh)
            .on(RoomEvent.ParticipantAttributesChanged, refresh)
            .on(RoomEvent.ParticipantNameChanged, refresh)
            .on(RoomEvent.ParticipantPermissionsChanged, refresh)
            .on(RoomEvent.RoomMetadataChanged, onMetadata)
            .on(RoomEvent.Reconnecting, () => setStatus('reconnecting'))
            .on(RoomEvent.Reconnected, () => {
                setStatus('connected')
                catchUpMessages().catch(() => {})
            })
            .on(RoomEvent.Disconnected, onDisconnected)

        const join = async () => {
            while (!cancelled) {
                try {
                    return await api.joinRoom(roomUid)
                } catch (err) {
                    if (!(err instanceof ApiError) || err.code !== 'room-waiting')
                        throw err
                    setStatus('waiting')
                    // Re-knock periodically in case room.admitted was missed.
                    await Promise.race([socket.waitAdmitted(roomUid), sleep(KNOCK_RETRY_MS)])
                }
            }
        }

        const start = async () => {
            setStatus('connecting')
            setError('')
            const joined = await join()
            if (cancelled || !joined)
                return

            try {
                await room.connect(joined.server_url, joined.participant_token)
            } catch {
                throw new ApiError('livekit-unavailable', 503)
            }
            if (cancelled)
                return

            setStatus('connected')
            api.listMessages(roomUid, { take: MESSAGE_PAGE })
                .then((page) => {
                    if (cancelled)
                        return
                    addMessages(page.map(fromServer))
                    setHasOlderMessages(page.length === MESSAGE_PAGE)
                    setJoinedAtMessageId(page[0]?.message_id || 0)
                })
                .catch(() => {
                    if (!cancelled)
                        setNotice('Unable to load the chat history')
                })
            setSettings(readSettings(room.metadata) || toSettings(joined.room || {}))
            refresh()

            if (room.localParticipant.permissions?.canPublish === false)
                return
            if (initialCamOn) {
                try {
                    await room.localParticipant.setCameraEnabled(true)
                } catch {
                    setNotice('Unable to access camera')
                }
            }
            if (initialMicOn) {
                try {
                    await room.localParticipant.setMicrophoneEnabled(true)
                } catch {
                    setNotice('Unable to access microphone')
                }
            }
            refresh()
        }

        setMessages([])
        setCaptions([])
        setHasOlderMessages(false)
        setJoinedAtMessageId(0)
        start().catch((err) => {
            if (cancelled)
                return
            setStatus('error')
            setError(errorMessage(err))
        })

        return () => {
            cancelled = true
            socket.close()
            signal.close()
            captionFeed.close()
            signalRef.current = null
            room.removeAllListeners()
            room.disconnect()
            audioElements.forEach((element) => element.remove())
            streamCache.current.clear()
            if (roomRef.current === room)
                roomRef.current = null
        }
        // Device choices only apply when joining.
    }, [roomUid, refresh, showReaction, showCaption, addMessages, catchUpMessages])

    const runLocal = useCallback(async (action, failure) => {
        const room = roomRef.current
        if (!room || room.state !== 'connected')
            return
        try {
            await action(room.localParticipant)
        } catch {
            setNotice(failure)
        }
        refresh()
    }, [refresh])

    const toggleMic = useCallback(() => runLocal(
        (local) => local.setMicrophoneEnabled(!local.isMicrophoneEnabled),
        'Unable to access microphone',
    ), [runLocal])

    const toggleCam = useCallback(() => runLocal(
        (local) => local.setCameraEnabled(!local.isCameraEnabled),
        'Unable to access camera',
    ), [runLocal])

    const toggleScreenShare = useCallback(() => runLocal(
        (local) => local.setScreenShareEnabled(!local.isScreenShareEnabled),
        'Unable to share your screen',
    ), [runLocal])

    const updateSelf = useCallback(async (changes) => {
        try {
            await api.updateParticipant(roomUid, changes)
        } catch (err) {
            setNotice(errorMessage(err))
        }
    }, [roomUid])

    const toggleHand = useCallback(
        () => updateSelf({ participant_hand_raised: !localUser.handRaised }),
        [updateSelf, localUser.handRaised],
    )

    const setLanguage = useCallback(
        (language) => updateSelf({ participant_language: language }),
        [updateSelf],
    )

    const answerKnock = useCallback(async (userId, admit) => {
        setKnocks((prev) => prev.filter((knock) => knock.userId !== userId))
        try {
            await api.updateRoomMember(roomUid, userId, { room_member_status: admit ? 'active' : 'declined' })
        } catch (err) {
            setNotice(errorMessage(err))
        }
    }, [roomUid])

    const sendTyping = useCallback((isTyping) => {
        signalRef.current?.sendTyping(isTyping).catch(() => {})
    }, [])

    const deliverMessage = useCallback(async (message) => {
        addMessages([{ ...message, status: 'sending' }])
        try {
            const saved = await api.sendMessage(roomUid, message.clientId, message.text)
            addMessages([fromServer(saved)])
        } catch (err) {
            addMessages([{ ...message, status: 'failed' }])
            setNotice(err instanceof ApiError && err.code === 'forbidden' ? 'You are not allowed to send messages in this room.' : errorMessage(err))
        }
    }, [roomUid, addMessages])

    const sendMessage = useCallback((text) => {
        const room = roomRef.current
        const trimmed = text.trim()
        if (!room || room.state !== 'connected' || !trimmed)
            return
        const userId = userIdOf(room.localParticipant.identity, room.localParticipant.attributes || {})
        const clientId = crypto.randomUUID()
        deliverMessage({
            key: messageKey(userId, clientId),
            id: null,
            clientId,
            userId,
            text: trimmed,
            createdAt: new Date().toISOString(),
        })
    }, [deliverMessage])

    // Same message_client_id, so a retry never creates a duplicate.
    const retryMessage = useCallback((message) => deliverMessage(message), [deliverMessage])

    const loadOlderMessages = useCallback(async () => {
        const saved = messagesRef.current.filter((message) => message.id)
        if (!saved.length || loadingOlderMessages)
            return
        setLoadingOlderMessages(true)
        try {
            const page = await api.listMessages(roomUid, { before_message_id: saved[0].id, take: MESSAGE_PAGE })
            addMessages(page.map(fromServer))
            setHasOlderMessages(page.length === MESSAGE_PAGE)
        } catch (err) {
            setNotice(errorMessage(err))
        } finally {
            setLoadingOlderMessages(false)
        }
    }, [roomUid, addMessages, loadingOlderMessages])

    const sendReaction = useCallback(async (reaction) => {
        try {
            const event = await signalRef.current?.sendReaction(reaction)
            if (event)
                showReaction('You', event)
        } catch {
            setNotice('Unable to send the reaction')
        }
    }, [showReaction])

    const moderate = useCallback(async (action, success) => {
        try {
            await action()
            if (success)
                setNotice(success)
        } catch (err) {
            setNotice(err instanceof ApiError && err.code === 'forbidden' ? 'You are not allowed to do that.' : errorMessage(err))
        }
        refresh()
    }, [refresh])

    const moderation = useMemo(() => ({
        mute: (participant, source) => moderate(() => api.muteParticipant(roomUid, participant.userId, source, true), `Muted ${participant.name}`),
        askToUnmute: (participant, source) => moderate(() => api.muteParticipant(roomUid, participant.userId, source, false), `Asked ${participant.name} to turn it on`),
        promote: (participant) => moderate(() => api.promoteParticipant(roomUid, participant.userId), `${participant.name} is now a member`),
        demote: (participant) => moderate(() => api.demoteParticipant(roomUid, participant.userId), `${participant.name} is now a viewer`),
        makeModerator: (participant) => moderate(() => api.updateRoomMember(roomUid, participant.userId, { room_member_role: 'moderator' }), `${participant.name} is now a moderator`),
        remove: (participant, blockMinutes) => moderate(() => api.removeParticipant(roomUid, participant.userId, blockMinutes), blockMinutes ? `Removed ${participant.name} for ${blockMinutes} minutes` : `Removed ${participant.name}`),
        ban: (participant) => moderate(() => api.deleteRoomMember(roomUid, participant.userId, true), `Banned ${participant.name}`),
    }), [moderate, roomUid])

    const updateSettings = useCallback((changes) => moderate(async () => {
        const data = await api.updateRoom(roomUid, changes)
        setSettings(toSettings(data))
        if (!data.room_translation_enabled)
            setCaptions([])
    }), [moderate, roomUid])

    const leave = useCallback(() => {
        roomRef.current?.disconnect()
    }, [])

    const clearNotice = useCallback(() => setNotice(''), [])

    return {
        status,
        error,
        notice,
        clearNotice,
        localUser,
        participants,
        knocks,
        typing,
        reactions,
        messages,
        hasOlderMessages,
        joinedAtMessageId,
        loadingOlderMessages,
        sendMessage,
        retryMessage,
        loadOlderMessages,
        settings,
        captions,
        isStaff: STAFF_ROLES.includes(localUser.role),
        roomCode: roomUid,
        sendTyping,
        sendReaction,
        moderation,
        updateSettings,
        toggleMic,
        toggleCam,
        toggleScreenShare,
        toggleHand,
        setLanguage,
        admit: (userId) => answerKnock(userId, true),
        deny: (userId) => answerKnock(userId, false),
        leave,
    }
}
