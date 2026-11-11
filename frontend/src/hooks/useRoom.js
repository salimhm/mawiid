import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { DisconnectReason, Room, RoomEvent, Track } from 'livekit-client'
import { api, ApiError, errorMessage } from '../services/api'
import { randomId, reachableUrl } from '../lib/utils'
import { createEventSocket } from '../services/eventSocket'
import { createRoomSignal } from '../services/roomSignal'
import { createRoomCaptions } from '../services/roomCaption'

const CAPTIONS_KEY = 'mawiid.captions'

// Keep in sync with packages/contracts/src/room.ts
const ATTRIBUTE = {
    userId: 'mawiid.user_id',
    role: 'mawiid.role',
    language: 'mawiid.language',
    translationEnabled: 'mawiid.translation_enabled',
    handRaised: 'mawiid.hand_raised',
}
const KNOCK_RETRY_MS = 10000
const REACTION_VISIBLE_MS = 4000
const STAFF_ROLES = ['host', 'moderator']
const MESSAGE_PAGE = 50
const MESSAGE_PAGE_MAX = 100
// Captions are kept as one entry per speaker (their current turn); at most this many
// speakers are on screen, the one who spoke longest ago drops out first.
const CAPTION_MAX = 10
// Pieces kept in one turn, so a long monologue does not grow without end.
const TURN_SEGMENT_MAX = 50
const ROOM_EVENT_MAX = 200
// The featured speaker changes at most this often, so people talking over each other
// (or a cough) does not make the spotlight jump back and forth.
const SPEAKER_HOLD_MS = 1500

// Why a participant left, as a line in the chat. LiveKit sends the reason with
// the disconnect; anything not listed reads as a lost connection.
const LEFT_TEXT = {
    [DisconnectReason.CLIENT_INITIATED]: 'left',
    [DisconnectReason.PARTICIPANT_REMOVED]: 'was removed from the meeting',
    [DisconnectReason.DUPLICATE_IDENTITY]: 'was disconnected: the same account joined from another device',
    [DisconnectReason.ROOM_DELETED]: 'left: the meeting ended',
    [DisconnectReason.ROOM_CLOSED]: 'left: the meeting ended',
    [DisconnectReason.SERVER_SHUTDOWN]: 'was disconnected: the server restarted',
}
const leftText = (reason) => LEFT_TEXT[reason] || 'lost the connection'

// What the local person sees when their own connection ends.
function localStatus(reason) {
    if (reason === DisconnectReason.PARTICIPANT_REMOVED)
        return 'removed'
    if (reason === DisconnectReason.DUPLICATE_IDENTITY)
        return 'replaced'
    if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED)
        return 'ended'
    if (reason === DisconnectReason.CLIENT_INITIATED)
        return 'disconnected'
    return 'lost'
}

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

// Captions state: one turn per speaker, oldest first.
//   turn = { id, speakerId, speaker, segments: [caption], replaced: [segment ids] }
// - An update to a segment already on screen (a partial growing, or its translation)
//   changes it in place. A translation replaces the original, never the other way round:
//   the original final arrives first, its translation a moment later.
// - A new segment from the person who spoke last joins their turn.
// - A new segment from anyone else starts a new turn at the bottom. If that person
//   already had a turn on screen, it is removed: their old text is replaced by the new.
// - Late updates for segments of a replaced turn are ignored.
function mergeCaption(turns, caption) {
    const turnIndex = turns.findIndex((turn) => turn.segments.some((segment) => segment.id === caption.id))
    if (turnIndex !== -1) {
        const turn = turns[turnIndex]
        const existing = turn.segments.find((segment) => segment.id === caption.id)
        if (existing.translated && !caption.translated)
            return turns
        const segments = turn.segments.map((segment) => (segment.id === caption.id ? caption : segment))
        return turns.map((entry, index) => (index === turnIndex ? { ...turn, segments } : entry))
    }
    if (turns.some((turn) => turn.replaced.includes(caption.id)))
        return turns

    const last = turns[turns.length - 1]
    if (last && last.speakerId === caption.speakerId) {
        const segments = [...last.segments, caption].slice(-TURN_SEGMENT_MAX)
        return [...turns.slice(0, -1), { ...last, speaker: caption.speaker, segments }]
    }

    const previous = turns.find((turn) => turn.speakerId === caption.speakerId)
    const others = turns.filter((turn) => turn !== previous)
    const turn = {
        id: caption.id,
        speakerId: caption.speakerId,
        speaker: caption.speaker,
        segments: [caption],
        replaced: previous ? previous.segments.map((segment) => segment.id) : [],
    }
    return [...others, turn].slice(-CAPTION_MAX)
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
    // The caption language just picked, until the worker sees it: translations still on their
    // way in the previous language are dropped instead of mixed in.
    const pickedLanguageRef = useRef('')

    const [status, setStatus] = useState('connecting')
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [localUser, setLocalUser] = useState({ id: 'local', name: 'You', isLocal: true })
    const [participants, setParticipants] = useState([])
    const [knocks, setKnocks] = useState([])
    const [typing, setTyping] = useState([])
    const [reactions, setReactions] = useState([])
    const [settings, setSettings] = useState({ locked: false, lobby: false })
    const [captions, setCaptions] = useState([])
    const [messages, setMessages] = useState([])
    // Joins, departures, removals and connection changes seen since joining,
    // shown in the chat between the messages. Kept only in this tab.
    const [roomEvents, setRoomEvents] = useState([])
    const [hasOlderMessages, setHasOlderMessages] = useState(false)
    // Newest message_id in the history loaded on join: those count as read.
    const [joinedAtMessageId, setJoinedAtMessageId] = useState(0)
    const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
    // The person to feature in the speaker layout: the last other person who spoke.
    const [spotlightId, setSpotlightId] = useState(null)
    const messagesRef = useRef(messages)
    messagesRef.current = messages

    const addRoomEvent = useCallback((text) => {
        const event = { key: `event:${randomId()}`, text, createdAt: new Date().toISOString() }
        setRoomEvents((prev) => [...prev, event].slice(-ROOM_EVENT_MAX))
    }, [])

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
        const isScreenSharing = Boolean(screen?.track && !screen.isMuted)
        const attributes = participant.attributes || {}

        return {
            id: participant.identity,
            userId: userIdOf(participant.identity, attributes),
            // Same on every client: orders people for their tile/caption color.
            joinedAt: participant.joinedAt?.getTime() || 0,
            name: isLocal ? `${participant.name || 'You'} (You)` : participant.name || participant.identity,
            role: attributes[ATTRIBUTE.role] || '',
            language: attributes[ATTRIBUTE.language] || '',
            translationEnabled: attributes[ATTRIBUTE.translationEnabled] === 'true',
            handRaised: attributes[ATTRIBUTE.handRaised] === 'true',
            // The camera and a shared screen are kept apart: the room shows a shared screen
            // on its own stage while the person's tile keeps their camera.
            stream: streamFor(camera?.track),
            isCamOn: Boolean(camera?.track && !camera.isMuted),
            screenStream: isScreenSharing ? streamFor(screen.track) : null,
            // From the publication, not the received track: a remote track
            // is only set once its media arrives, which can fail or lag.
            isCamPublished: Boolean(camera && !camera.isMuted),
            isMicOn: Boolean(microphone && !microphone.isMuted),
            isScreenSharing,
            isSpeaking: Boolean(participant.isSpeaking),
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
        const myLanguage = pickedLanguageRef.current || room.localParticipant.attributes?.[ATTRIBUTE.language]
        if (caption.translated && pickedLanguageRef.current && baseLanguage(caption.language) !== baseLanguage(pickedLanguageRef.current))
            return
        setCaptions((prev) => mergeCaption(prev, {
            id: caption.segmentId,
            speaker: speaker === room.localParticipant ? 'You' : speaker?.name || speaker?.identity || 'Speaker',
            speakerId: speaker?.identity || caption.trackId,
            text: caption.text,
            final: caption.final,
            translated: caption.translated,
            foreign: !caption.translated && Boolean(myLanguage) && baseLanguage(caption.language) !== baseLanguage(myLanguage),
        }))
    }, [])

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
        }

        const onDisconnected = (reason) => {
            if (!cancelled)
                setStatus(localStatus(reason))
        }

        // The AI translation worker joins as a participant too; the chat leaves it out.
        const nameOf = (participant) => participant.name || participant.identity
        const onParticipantConnected = (participant) => {
            if (!participant.isAgent)
                addRoomEvent(`${nameOf(participant)} joined`)
            refresh()
        }
        const onParticipantDisconnected = (participant, reason) => {
            if (!participant.isAgent)
                addRoomEvent(`${nameOf(participant)} ${leftText(reason)}`)
            refresh()
        }
        // Loudest first. You are never featured on your own screen, nor is the AI worker.
        let spotlight = null
        let spotlightSince = 0
        let spotlightTimer = null
        const onActiveSpeakers = (speakers) => {
            refresh()
            const next = speakers.find((participant) => !participant.isLocal && !participant.isAgent)?.identity
            if (!next || next === spotlight) {
                clearTimeout(spotlightTimer)
                return
            }
            clearTimeout(spotlightTimer)
            spotlightTimer = setTimeout(() => {
                spotlight = next
                spotlightSince = Date.now()
                if (!cancelled)
                    setSpotlightId(next)
            }, Math.max(0, spotlightSince + SPEAKER_HOLD_MS - Date.now()))
        }

        const onAttributesChanged = (changed, participant) => {
            const role = changed[ATTRIBUTE.role]
            if (role && !participant.isAgent)
                addRoomEvent(participant.isLocal ? `You are now ${role}` : `${nameOf(participant)} is now ${role}`)
            refresh()
        }

        room
            .on(RoomEvent.ParticipantConnected, onParticipantConnected)
            .on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
            .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
            .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
            .on(RoomEvent.TrackMuted, refresh)
            .on(RoomEvent.TrackUnmuted, refresh)
            .on(RoomEvent.LocalTrackPublished, refresh)
            .on(RoomEvent.LocalTrackUnpublished, refresh)
            .on(RoomEvent.ParticipantAttributesChanged, onAttributesChanged)
            .on(RoomEvent.ParticipantNameChanged, refresh)
            .on(RoomEvent.ParticipantPermissionsChanged, refresh)
            .on(RoomEvent.RoomMetadataChanged, onMetadata)
            .on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers)
            .on(RoomEvent.Reconnecting, () => {
                setStatus('reconnecting')
                addRoomEvent('Connection lost, reconnecting…')
            })
            .on(RoomEvent.Reconnected, () => {
                setStatus('connected')
                addRoomEvent('Reconnected')
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
                await room.connect(reachableUrl(joined.server_url), joined.participant_token)
            } catch {
                throw new ApiError('livekit-unavailable', 503)
            }
            if (cancelled)
                return

            setStatus('connected')
            addRoomEvent('You joined the meeting')
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
            // A new connection starts with captions off: bring back this person's own choice.
            if (localStorage.getItem(CAPTIONS_KEY) === 'true')
                api.updateParticipant(roomUid, { participant_translation_enabled: true }).catch(() => {})
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
        setRoomEvents([])
        setCaptions([])
        setHasOlderMessages(false)
        setJoinedAtMessageId(0)
        setSpotlightId(null)
        start().catch((err) => {
            if (cancelled)
                return
            setStatus('error')
            setError(errorMessage(err))
        })

        return () => {
            cancelled = true
            clearTimeout(spotlightTimer)
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
    }, [roomUid, refresh, showReaction, showCaption, addMessages, addRoomEvent, catchUpMessages])

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

    // The worker detects the language of each phrase someone speaks, so changing
    // what you read doesn't change how you are heard.
    // The worker sends the recent captions again in the new language, so the old ones are
    // cleared rather than left in the previous language and direction.
    // Picking a language means wanting captions in it, so captions are switched on too.
    const setLanguage = useCallback((language) => {
        pickedLanguageRef.current = language
        setCaptions([])
        if (localUser.translationEnabled)
            return updateSelf({ participant_language: language })
        localStorage.setItem(CAPTIONS_KEY, 'true')
        return updateSelf({ participant_language: language, participant_translation_enabled: true })
    }, [updateSelf, localUser.translationEnabled])

    const toggleTranslation = useCallback(() => {
        const enabled = !localUser.translationEnabled
        localStorage.setItem(CAPTIONS_KEY, String(enabled))
        if (!enabled)
            setCaptions([])
        return updateSelf({ participant_translation_enabled: enabled })
    }, [updateSelf, localUser.translationEnabled])

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
        const clientId = randomId()
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
        roomEvents,
        hasOlderMessages,
        joinedAtMessageId,
        loadingOlderMessages,
        sendMessage,
        retryMessage,
        loadOlderMessages,
        settings,
        captions,
        spotlightId,
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
        toggleTranslation,
        admit: (userId) => answerKnock(userId, true),
        deny: (userId) => answerKnock(userId, false),
        leave,
    }
}
