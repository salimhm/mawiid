// Subtitles from the AI translation worker, newest last. Captions left in another
// language (no translation came) or still changing are dimmed.
export default function MeetCaptions({ captions = [] })
{
    if (!captions.length)
        return null

    return (
        <div className='pointer-events-none fixed bottom-36 left-1/2 z-[55] flex w-[calc(100vw-32px)] max-w-3xl -translate-x-1/2 flex-col items-center gap-1.5' aria-live='polite'>
            {captions.map((caption) => (
                <p key={caption.id} className='max-w-full rounded-xl bg-black/75 px-3 py-1.5 text-center text-sm sm:text-lg text-white backdrop-blur-md'>
                    <span className='font-semibold text-white/60'>{caption.speaker}: </span>
                    <span dir='auto' className={caption.final && !caption.foreign ? '' : 'text-white/70 italic'}>{caption.text}</span>
                </p>
            ))}
        </div>
    )
}
