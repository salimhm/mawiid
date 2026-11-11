import { useLayoutEffect, useRef, useState } from 'react'
import { participantColor } from '../../../lib/participantColor'

// How close to the bottom (px) still counts as "reading the latest".
const STICK_THRESHOLD = 24

const RTL_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g
const LTR_LETTERS = /[A-Za-z\u00C0-\u024F]/g

// A speaker's line reads right to left when most of its letters are Arabic (or Hebrew).
// Set on the whole line, not per piece: pieces each with their own direction are laid out
// left to right by the line around them, so new Arabic text would land on the wrong side.
function turnDirection(turn) {
    const text = turn.segments.map((segment) => segment.text).join(' ')
    const rtl = (text.match(RTL_LETTERS) || []).length
    const ltr = (text.match(LTR_LETTERS) || []).length
    return rtl > ltr ? 'rtl' : 'ltr'
}

// At most this many characters of a speaker's line are shown, like TV subtitles: the
// latest words stay, older ones drop off the front. The full text stays in the transcript.
const CAPTION_VISIBLE_CHARS = 200

// The latest pieces of a turn that fit in CAPTION_VISIBLE_CHARS (the spaces between them
// count). The oldest piece shown may be cut, at the start of a word when it has spaces.
// `clipped` says whether anything before it was left out.
function visibleSegments(segments) {
    const shown = []
    let budget = CAPTION_VISIBLE_CHARS
    for (let i = segments.length - 1; i >= 0 && budget > 0; i--) {
        const segment = segments[i]
        const text = segment.text
        if (text.length <= budget) {
            shown.unshift(segment)
            budget -= text.length + 1
            continue
        }
        let tail = text.slice(text.length - budget)
        // Mid-word: start at the next word instead (not for text without spaces, e.g. Chinese).
        const space = tail.indexOf(' ')
        if (text[text.length - budget - 1] !== ' ' && space !== -1 && space < tail.length - 1)
            tail = tail.slice(space + 1)
        shown.unshift({ ...segment, text: tail.trimStart() })
        return { shown, clipped: true }
    }
    return { shown, clipped: shown.length < segments.length }
}

// Subtitles from the AI translation worker: one entry per speaker, the most recent
// speaker last (see mergeCaption in useRoom). Text still in another language (the
// translation is on its way) or still changing is dimmed.
// The box scrolls, following the newest text unless the reader has scrolled up.
// It spans the width of the video area (same side margins as the tiles) and takes its
// own room below them: while `open` it slides open and the tiles shrink with it, so it
// never covers anyone. In full screen it floats over the video.
export default function MeetCaptions({ captions = [], open = false, fullScreen = false, colorOf = participantColor })
{
    const listRef = useRef(null)
    const [following, setFollowing] = useState(true)
    const [expanded, setExpanded] = useState(false)

    // Runs on every caption change, including a partial caption growing in place.
    useLayoutEffect(() => {
        const list = listRef.current
        if (list && following)
            list.scrollTop = list.scrollHeight
    }, [captions, following, expanded])

    if (fullScreen && (!open || !captions.length))
        return null

    const handleScroll = () => {
        const list = listRef.current
        if (!list)
            return
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_THRESHOLD
        if (atBottom !== following)
            setFollowing(atBottom)
    }

    const jumpToLatest = () => {
        const list = listRef.current
        if (list)
            list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
        setFollowing(true)
    }

    // A fixed height (not one that grows per line) so the tiles move only when the box
    // opens, closes or changes size, never with every caption.
    const height = fullScreen
        ? (expanded ? 'max-h-[50vh]' : 'max-h-28 sm:max-h-36')
        : (expanded ? 'h-[40vh]' : 'h-24 sm:h-32')

    const box = (
            <div className='relative rounded-2xl bg-black/75 text-white backdrop-blur-md'>
                <button
                    type='button'
                    className='absolute right-2 top-1.5 z-10 rounded-full px-2 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white cursor-pointer'
                    aria-expanded={expanded}
                    onClick={() => setExpanded((prev) => !prev)}
                >
                    {expanded ? 'Smaller' : 'Bigger'}
                </button>
                <div
                    ref={listRef}
                    onScroll={handleScroll}
                    className={`${height} transition-[height,max-height] duration-300 ease-out overflow-y-auto overscroll-contain px-3 py-2 pr-16 flex flex-col gap-1`}
                    role='log'
                    aria-live='polite'
                    aria-label='Live captions'
                >
                    {!captions.length && (
                        <p className='text-sm sm:text-base text-white/50 italic'>Captions appear here when someone speaks.</p>
                    )}
                    {captions.map((turn) => {
                        const { shown, clipped } = visibleSegments(turn.segments)
                        return (
                            <p key={turn.id} dir={turnDirection(turn)} className='text-sm sm:text-lg leading-snug'>
                                {/* bdi: a Latin name keeps its own order inside an Arabic line */}
                                <span className='font-semibold' style={{ color: colorOf(turn.speakerId).text }}><bdi>{turn.speaker}</bdi>: </span>
                                {clipped && <span className='text-white/50'>… </span>}
                                {shown.map((caption, index) => (
                                    <span key={caption.id}>
                                        {index > 0 && ' '}
                                        <span className={caption.final && !caption.foreign ? '' : 'text-white/70 italic'}>{caption.text}</span>
                                    </span>
                                ))}
                            </p>
                        )
                    })}
                </div>
                {!following && (
                    <button
                        type='button'
                        className='absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#2346FA] px-3 py-1 text-xs sm:text-sm shadow-lg hover:bg-blue-500 cursor-pointer'
                        onClick={jumpToLatest}
                    >
                        Latest ↓
                    </button>
                )}
            </div>
    )

    if (fullScreen)
        return (
            <div className='fixed bottom-36 inset-x-2 sm:inset-x-6 lg:inset-x-8 z-[55]'>
                {box}
            </div>
        )

    // Animating the row from 0fr to 1fr opens the box to its real height smoothly.
    return (
        <div
            className={`grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            inert={!open}
        >
            <div className='min-h-0 overflow-hidden'>
                <div className='w-full px-2 sm:px-6 md:px-12 lg:px-20 pt-2 sm:pt-3'>
                    {box}
                </div>
            </div>
        </div>
    )
}
