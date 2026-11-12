import { useLayoutEffect, useRef, useState } from 'react'
import { participantColor } from '../../../lib/participantColor'
import { textDirection } from '../../../lib/textDirection'

// How close to the bottom (px) still counts as "reading the latest".
const STICK_THRESHOLD = 24

// A speaker's line reads right to left when most of its letters are Arabic (or Hebrew).
// Set on the whole line, not per piece: pieces each with their own direction are laid out
// left to right by the line around them, so new Arabic text would land on the wrong side.
function turnDirection(turn) {
    return textDirection(turn.segments.map((segment) => segment.text).join(' ')) || 'ltr'
}

// Subtitles from the AI translation worker: one line per turn of speech, the latest last
// (see mergeCaption in useRoom). A speaker's text keeps joining their line until someone
// else talks, or until it switches between left to right and right to left. Only finished
// text is shown, in full.
// Text still in another language (no translation came back) is dimmed.
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
    // opens or closes, never with every caption. "Bigger" grows the box up over the tiles
    // instead of taking room from them, so the people keep their size.
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
                        return (
                            <p key={turn.id} dir={turnDirection(turn)} className='text-sm sm:text-lg leading-snug'>
                                {/* bdi: a Latin name keeps its own order inside an Arabic line */}
                                <span className='font-semibold' style={{ color: colorOf(turn.speakerId).text }}><bdi>{turn.speaker}</bdi>: </span>
                                {turn.segments.map((caption, index) => (
                                    <span key={caption.id}>
                                        {index > 0 && ' '}
                                        <span className={!caption.foreign ? '' : 'text-white/70 italic'}>{caption.text}</span>
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

    // The row below the tiles always has the small box's height (animating 0fr to 1fr opens
    // it smoothly). The box itself sits on the bottom of that row: small, it fills it exactly;
    // bigger, it rises over the tiles without resizing them.
    return (
        <div
            className={`relative grid shrink-0 transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            inert={!open}
        >
            <div className='min-h-0 overflow-hidden'>
                <div className='pt-2 sm:pt-3'>
                    <div className='h-24 sm:h-32' />
                </div>
            </div>
            <div className={`absolute inset-x-0 bottom-0 z-40 px-2 sm:px-6 md:px-12 lg:px-20 transition-opacity duration-300 ease-out ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {box}
            </div>
        </div>
    )
}
