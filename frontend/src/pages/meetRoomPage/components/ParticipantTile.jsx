import { useEffect, useRef } from 'react'
import { BiSolidHand, BiSolidMicrophoneOff } from 'react-icons/bi'
import { NEUTRAL_COLOR } from '../../../lib/participantColor'

function initials(name = '') {
  return name
    .replace(/\s*\(You\)\s*/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'M'
}

export default function ParticipantTile({
  name,
  stream,
  isCamOn,
  isMicOn,
  handRaised,
  isSpeaking = false,
  isLocal = false,
  color,
  // A small tile, in the strip beside a shared screen.
  compact = false,
}) {
  const videoElement = useRef(null)
  const showVideo = Boolean(stream && isCamOn)
  const palette = color || NEUTRAL_COLOR

  useEffect(() => {
    const video = videoElement.current
    if (!video) return

    video.srcObject = showVideo ? stream : null

    return () => {
      video.srcObject = null
    }
  }, [stream, showVideo])

  return (
    <section
      className={`relative isolate flex min-w-0 flex-col justify-between overflow-hidden text-white ${compact
        ? 'h-full p-2 rounded-xl'
        : 'min-h-[220px] md:min-h-[280px] p-3.5 md:p-[clamp(16px,2vw,30px)] rounded-2xl md:rounded-[20px]'}`}
      style={{
        background: `radial-gradient(ellipse at 50% 34%, rgba(255,255,255,0.13), transparent 45%), linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.72) 100%), ${palette.background}`,
      }}
      aria-label={`${name}${isLocal ? ', you' : ''}`}
    >
      {/* Speaking: an outline in the person's color, drawn over the video. */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 rounded-[inherit] transition-opacity duration-200 ${isSpeaking ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: `inset 0 0 0 ${compact ? 2 : 3}px ${palette.text}` }}
        aria-hidden="true"
      />
      {showVideo && (
        <video
          ref={videoElement}
          autoPlay
          playsInline
          muted={isLocal}
          className="absolute inset-0 w-full h-full -z-20 object-cover bg-neutral-900"
        />
      )}

      <div className="absolute inset-0 w-full h-full -z-10 pointer-events-none bg-[linear-gradient(180deg,rgba(0,0,0,0.22)_0%,transparent_28%,transparent_55%,rgba(0,0,0,0.82)_100%)]" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-block overflow-hidden rounded-full backdrop-blur-[12px] font-montserrat font-semibold text-ellipsis whitespace-nowrap ${compact
            ? 'max-w-full px-2 py-0.5 text-[11px]'
            : 'min-h-8 md:min-h-[38px] max-w-[min(70%,320px)] px-3 md:px-[18px] py-[7px] md:py-[9px] text-xs md:text-sm'}`}
          style={{ background: 'rgba(0,0,0,0.32)' }}
        >
          {name.replace(/\s*\(You\)\s*/gi, '').trim() || (isLocal ? 'You' : 'Guest')}
          {isLocal && ' (You)'}
        </span>
      </div>

      {!showVideo && (
        <div className={`flex flex-1 flex-col items-center justify-center min-h-0 text-center ${compact ? 'gap-0' : 'gap-4'}`}>
          <div className="relative">
            {/* Ripples behind the avatar while this person speaks (index.css, .speaking-rings). */}
            <div
              className={`speaking-rings ${isSpeaking ? 'is-speaking' : ''}`}
              style={{ '--ring-color': palette.text }}
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </div>
            <div
              className={`relative grid aspect-square place-items-center rounded-full shadow-[0_18px_60px_rgba(0,0,0,0.2),inset_0_0_30px_rgba(255,255,255,0.08)] text-white font-montserrat font-semibold leading-none ${compact
                ? 'w-11 text-base'
                : 'w-[82px] md:w-[clamp(112px,14vw,190px)] text-[30px] md:text-[clamp(34px,5vw,58px)]'}`}
              style={{
                border: `1px solid ${palette.text}`,
                background: `radial-gradient(circle at 35% 25%, color-mix(in srgb, ${palette.text} 30%, transparent), color-mix(in srgb, ${palette.text} 8%, transparent) 54%, rgba(0,0,0,0.18))`,
              }}
            >
              {initials(name)}
            </div>
          </div>
        </div>
      )}

      {/* Always one icon tall, even when empty: otherwise muting or unmuting (or a raised
          hand) changes this row's height and the avatar above moves up or down. */}
      <div className={`flex items-center justify-end gap-3 text-white/75 font-inter text-[10px] sm:text-xs leading-none font-medium ${compact ? 'min-h-5' : 'min-h-12'}`}>
        <div className="flex items-center gap-2">
          {handRaised && (
            <span className={`inline-flex items-center justify-center text-center rounded-full ${compact ? 'p-0.5' : 'p-2'} text-base`} title="Hand raised">
              <BiSolidHand size={compact ? 16 : 32} />
            </span>
          )}

          {!isMicOn && (
            <span className={`inline-flex items-center justify-center text-center rounded-full ${compact ? 'p-0.5' : 'p-2'}`} title="Microphone muted">
              <BiSolidMicrophoneOff size={compact ? 16 : 32} />
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
