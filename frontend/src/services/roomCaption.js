// Live captions from the AI translation worker (services/ai, mawiid_ai.agent). The original
// text goes to everyone on lk.transcription; each translation goes only to the listeners
// of its language on mawiid.translation.v1. A phrase's partial and final captions share a
// segment id, so the final one replaces the partial.
// Keep in sync with packages/contracts/src/room.ts
export const CAPTION_TOPIC = {
    transcription: 'lk.transcription',
    translation: 'mawiid.translation.v1',
}

const ATTRIBUTE = {
    segmentId: 'lk.segment_id',
    trackId: 'lk.transcribed_track_id',
    final: 'lk.transcription_final',
    language: 'mawiid.language',
}

const TEXT_MAX_LENGTH = 2000

export function createRoomCaptions(room, { onCaption } = {}) {
    const handle = (translated) => async (reader, participantInfo) => {
        // Anyone can publish on a topic: only the AI worker's captions are shown.
        if (!room.remoteParticipants.get(participantInfo.identity)?.isAgent)
            return
        const attributes = reader.info.attributes ?? {}
        let text
        try {
            text = (await reader.readAll()).trim()
        } catch {
            return
        }
        if (!text || text.length > TEXT_MAX_LENGTH)
            return
        onCaption?.({
            segmentId: attributes[ATTRIBUTE.segmentId] || reader.info.id,
            trackId: attributes[ATTRIBUTE.trackId] || '',
            language: attributes[ATTRIBUTE.language] || '',
            final: attributes[ATTRIBUTE.final] === 'true',
            translated,
            text,
        })
    }

    room.registerTextStreamHandler(CAPTION_TOPIC.transcription, handle(false))
    room.registerTextStreamHandler(CAPTION_TOPIC.translation, handle(true))

    const close = () => {
        room.unregisterTextStreamHandler(CAPTION_TOPIC.transcription)
        room.unregisterTextStreamHandler(CAPTION_TOPIC.translation)
    }

    return { close }
}
