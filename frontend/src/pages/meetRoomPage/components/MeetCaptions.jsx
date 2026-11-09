import { useLayoutEffect, useRef, useState } from 'react'
import { participantColor } from '../../../lib/participantColor'

// How close to the bottom (px) still counts as "reading the latest".
const STICK_THRESHOLD = 24

// Subtitles from the AI translation worker, newest last. Captions still in another
// language (the translation is on its way) or still changing are dimmed.
// Captions do not disappear: the box scrolls, following the newest caption unless
// the reader has scrolled up to read an earlier one.
// The box takes its own room below the video tiles: while `open` it slides open and the
// tiles shrink with it, so it never covers anyone. In full screen it floats over the video.
export default function MeetCaptions({ captions = [], open = false, fullScreen = false })
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
                    {captions.map((caption) => (
                        <p key={caption.id} className='text-sm sm:text-lg leading-snug'>
                            <span className={`font-semibold ${participantColor(caption.speakerId).text}`}>{caption.speaker}: </span>
                            <span dir='auto' className={caption.final && !caption.foreign ? '' : 'text-white/70 italic'}>{caption.text}</span>
                        </p>
                    ))}
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
            <div className='fixed bottom-36 left-1/2 z-[55] w-[calc(100vw-32px)] max-w-3xl -translate-x-1/2'>
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
                <div className='mx-auto w-[calc(100vw-32px)] max-w-3xl pt-2 sm:pt-3'>
                    {box}
                </div>
            </div>
        </div>
    )
}
