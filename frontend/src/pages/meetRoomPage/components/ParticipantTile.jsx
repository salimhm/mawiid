import { useEffect, useRef } from 'react'
import * as icons from '../../../assets/icons'

const GRADIENT_COLORS = [
    'from-amber-400 via-amber-600 to-amber-900',
    'from-rose-400 via-rose-600 to-rose-900',
    'from-teal-400 via-teal-600 to-teal-900',
    'from-lime-400 via-lime-600 to-lime-900',
    'from-violet-400 via-violet-600 to-violet-900',
    'from-sky-400 via-sky-600 to-sky-900',
]

function getGradient(id)
{
    let hash = 0
    for (let i = 0; i < id.length; i++)
        hash = id.charCodeAt(i) + ((hash << 5) - hash)
    return GRADIENT_COLORS[Math.abs(hash) % GRADIENT_COLORS.length]
}

export default function ParticipantTile({ name, stream, isCamOn, isMicOn, handRaised, id })
{
    const videoElement = useRef(null)

    useEffect(() => {
        if (!videoElement.current)
            return
        if (stream && isCamOn)
            videoElement.current.srcObject = stream
        else
            videoElement.current.srcObject = null
    }, [stream, isCamOn])

    const gradient = getGradient(id || 'default')
    const showVideo = isCamOn && stream

    return (
        <div className={`relative w-full h-full min-h-0 rounded-2xl overflow-hidden bg-gradient-to-br ${gradient} flex items-center justify-center`}>

            {showVideo ? (
                <video ref={videoElement} autoPlay muted playsInline className='absolute inset-0 w-full h-full object-cover' />
            ) : (
                <>
                    <div className='absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.25),transparent_60%)]'></div>
                    <div className='absolute inset-0 bg-black/30'></div>
                    <span className='relative text-white text-xl font-bold'>
                        {name}
                    </span>
                </>
            )}

            {showVideo && <div className='absolute inset-0 bg-black/10'></div>}

            <div className='absolute left-3 bottom-3 flex items-center gap-2'>
                <span className='rounded-md bg-black/60 px-2 py-1 text-sm text-white'>
                    {name}
                </span>
                {handRaised && (
                    <span className='rounded-md bg-yellow-400/90 px-1.5 py-0.5 text-sm' title='Hand raised'>✋</span>
                )}
                {!isMicOn && (
                    <span className='rounded-md bg-red-500/80 px-1.5 py-1'>
                        {icons.micOffIcon(16, 16)}
                    </span>
                )}
            </div>
        </div>
    )
}
