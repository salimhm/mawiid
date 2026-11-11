import { useEffect, useRef } from 'react'
import * as icons from '../../../assets/icons'
import { BiSolidHand } from "react-icons/bi";
import { BiSolidMicrophoneOff } from "react-icons/bi";

const palettes = [
  {
    background: '#878C25',
    accent: '#A8AD3B',
    badge: 'rgba(65, 70, 15, 0.78)',
  },
  {
    background: '#8D3221',
    accent: '#C45A42',
    badge: 'rgba(90, 28, 18, 0.82)',
  },
  {
    background: '#245D68',
    accent: '#398A99',
    badge: 'rgba(18, 59, 67, 0.82)',
  },
  {
    background: '#59427D',
    accent: '#8969B7',
    badge: 'rgba(47, 32, 72, 0.82)',
  },
  {
    background: '#9A6429',
    accent: '#D19343',
    badge: 'rgba(92, 55, 17, 0.82)',
  },
  {
    background: '#315D46',
    accent: '#55966E',
    badge: 'rgba(24, 62, 42, 0.82)',
  },
]

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

const languageCodes = {
  en: 'English',
  ar: 'Arabic',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  r: 'Russian',
  'ar-MA': 'Arabic (Moroccan)',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
}

function getPalette(id, colorIndex = 0) {
  const value = String(id || colorIndex)

  let hash = 0

  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }

  return palettes[hash % palettes.length]
}

function LanguageDisplay({ language, palette }) {
  const languageName = languageCodes[language] || language || 'Unknown'
  const badge = palette?.badge

  return (
	<span
		className="inline-flex items-center min-h-8 md:min-h-[38px] max-w-[min(70%,320px)] px-3 md:px-[18px] py-[7px] md:py-[9px] overflow-hidden rounded-full backdrop-blur-[12px] font-montserrat text-xs md:text-sm font-semibold text-ellipsis whitespace-nowrap"
		style={{ background: badge }}
	>
		en : {languageName}
    </span>
  )
}

export default function ParticipantTile({
  id,
  name,
  stream,
  isCamOn,
  isMicOn,
  handRaised,
  language,
  isLocal = false,
  color,
}) {
  const videoElement = useRef(null)
  const showVideo = Boolean(stream && isCamOn)
  const palette = getPalette(id, color)

  
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
      className="relative isolate flex min-w-0 min-h-[220px] md:min-h-[280px] flex-col justify-between overflow-hidden p-3.5 md:p-[clamp(16px,2vw,30px)] rounded-2xl md:rounded-[20px] text-white"
      style={{
        background: `radial-gradient(ellipse at 50% 34%, rgba(255,255,255,0.13), transparent 45%), linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.72) 100%), ${palette.background}`,
      }}
      aria-label={`${name}${isLocal ? ', you' : ''}`}
    >
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
          className="inline-flex items-center min-h-8 md:min-h-[38px] max-w-[min(70%,320px)] px-3 md:px-[18px] py-[7px] md:py-[9px] overflow-hidden rounded-full backdrop-blur-[12px] font-montserrat text-xs md:text-sm font-semibold text-ellipsis whitespace-nowrap"
          style={{ background: palette.badge }}
        >
          {name.replace(/\s*\(You\)\s*/gi, '').trim() || (isLocal ? 'You' : 'Guest')}
          {isLocal && ' (You)'}
        </span>

        <LanguageDisplay language={language} palette={palette} />
      </div>

      {!showVideo && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 min-h-0 text-center">
          <div
            className="grid w-[82px] md:w-[clamp(112px,14vw,190px)] aspect-square place-items-center rounded-full shadow-[0_18px_60px_rgba(0,0,0,0.2),inset_0_0_30px_rgba(255,255,255,0.08)] text-white font-montserrat font-semibold text-[30px] md:text-[clamp(34px,5vw,58px)] leading-none"
            style={{
              border: `1px solid ${palette.accent}`,
              background: `radial-gradient(circle at 35% 25%, ${palette.accent}4D, ${palette.accent}14 54%, rgba(0,0,0,0.18))`,
            }}
          >
            {initials(name)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 text-white/75 font-inter text-[10px] sm:text-xs leading-none font-medium">
        <div className="flex items-center gap-2">
          {handRaised && (
            <span className="inline-flex items-center justify-center text-center p-2 rounded-full text-base" title="Hand raised">
              <BiSolidHand size={32} />
            </span>
          )}

          {!isMicOn && (
            <span className="inline-flex items-center justify-center text-center p-2 rounded-full" title="Microphone muted">
              <BiSolidMicrophoneOff size={32} />
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
