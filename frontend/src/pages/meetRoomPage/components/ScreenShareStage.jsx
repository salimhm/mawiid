import { useCallback, useEffect, useRef, useState } from 'react'
import * as icons from '../../../assets/icons'
import {
    canFullscreen,
    exitFullscreen,
    fullscreenElement,
    onFullscreenChange,
    requestElementFullscreen,
} from '../../../lib/fullscreen'

// A shared screen. As the stage it fills the space it is given, with a button (and a
// double-click) to put it in the browser's full screen; as a thumbnail it is a small
// tile that features it on the stage when clicked.
// Your own share shows a placeholder instead of the screen itself, which would show
// itself again and again (and costs a second decode for nothing).
export default function ScreenShareStage({
    name,
    stream,
    isLocal = false,
    thumbnail = false,
    onSelect,
    onStopSharing,
}) {
    const containerRef = useRef(null)
    const videoRef = useRef(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [supported, setSupported] = useState(false)
    const showVideo = Boolean(stream) && !isLocal

    useEffect(() => {
        const video = videoRef.current
        if (!video)
            return
        video.srcObject = stream
        return () => {
            video.srcObject = null
        }
    }, [stream, showVideo])

    useEffect(() => {
        setSupported(canFullscreen(videoRef.current))
        const update = () => setIsFullscreen(fullscreenElement() === containerRef.current)
        update()
        return onFullscreenChange(update)
    }, [showVideo])

    const toggleFullscreen = useCallback(async () => {
        try {
            if (fullscreenElement() === containerRef.current)
                await exitFullscreen()
            else
                await requestElementFullscreen(containerRef.current, videoRef.current)
        } catch {
            // Refused (no user gesture, or blocked by the page's permissions): nothing to do.
        }
    }, [])

    const label = isLocal ? 'You are presenting' : `${name} is presenting`

    if (thumbnail)
        return (
            <button
                type='button'
                onClick={onSelect}
                className='relative flex h-full w-full min-w-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-900 text-white ring-1 ring-white/10 hover:ring-white/40 transition cursor-pointer'
                aria-label={`Show ${isLocal ? 'your screen' : `${name}'s screen`} on the stage`}
                title='Show on the stage'
            >
                {showVideo
                    ? <video ref={videoRef} autoPlay playsInline muted className='absolute inset-0 h-full w-full object-contain' />
                    : <span className='text-white/60'>{icons.shareScreenIcon(28, 28, 1.5)}</span>}
                <span className='absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-full bg-black/60 px-2 py-0.5 font-montserrat text-[11px] font-semibold'>
                    {label}
                </span>
            </button>
        )

    return (
        <section
            ref={containerRef}
            onDoubleClick={showVideo && supported ? toggleFullscreen : undefined}
            className='group relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-2xl md:rounded-[20px] bg-neutral-950 text-white [&:fullscreen]:rounded-none'
            aria-label={label}
        >
            {showVideo
                ? <video ref={videoRef} autoPlay playsInline muted className='h-full w-full object-contain' />
                : (
                    <div className='flex flex-col items-center gap-4 px-6 text-center'>
                        <span className='text-white/60'>{icons.shareScreenIcon(56, 56, 1.25)}</span>
                        <p className='font-montserrat text-base sm:text-xl font-semibold'>You are presenting to everyone</p>
                        {onStopSharing && (
                            <button
                                type='button'
                                onClick={onStopSharing}
                                className='rounded-full bg-[#2346FA] px-5 py-2 text-sm hover:bg-blue-500 transition cursor-pointer'
                            >
                                Stop presenting
                            </button>
                        )}
                    </div>
                )}

            {/* Overlays: always shown on touch screens, on hover or keyboard focus elsewhere. */}
            {showVideo && (
                <span className='pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-24px)] truncate rounded-full bg-black/60 px-3 py-1.5 font-montserrat text-xs md:text-sm font-semibold backdrop-blur-md transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100'>
                    {label}
                </span>
            )}
            {showVideo && supported && (
                <button
                    type='button'
                    onClick={toggleFullscreen}
                    onDoubleClick={(event) => event.stopPropagation()}
                    className='absolute right-3 top-3 z-10 flex items-center justify-center rounded-full bg-black/60 p-2.5 text-white backdrop-blur-md transition hover:bg-black/80 hover:scale-105 active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-white [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100'
                    title={isFullscreen ? 'Exit full screen (Esc)' : 'Full screen (or double-click)'}
                    aria-label={isFullscreen ? 'Exit full screen' : 'Show the shared screen in full screen'}
                    aria-pressed={isFullscreen}
                >
                    {isFullscreen ? icons.minimizeIcon(20, 20) : icons.maximizeIcon(20, 20)}
                </button>
            )}
        </section>
    )
}
