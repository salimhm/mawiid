
import { useEffect, useRef } from 'react'
import * as icons from '../../../assets/icons'
import './meet-room-refresh.css'

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

function getPalette(id, colorIndex = 0) {
  const value = String(id || colorIndex)

  let hash = 0

  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }

  return palettes[hash % palettes.length]
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

function LanguageDisplay({ language }) {
  const languageName = languageCodes[language] || language || 'Unknown'

  return (
    <span className="meet-person__language">
      {languageName}
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
  colorIndex = 0,
}) {
  const videoElement = useRef(null)
  const showVideo = Boolean(stream && isCamOn)

  const palette = getPalette(id, colorIndex)

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
      className={[
        'meet-person',
        showVideo ? 'meet-person--video' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--participant-bg': palette.background,
        '--participant-accent': palette.accent,
        '--participant-badge': palette.badge,
      }}
      aria-label={`${name}${isLocal ? ', you' : ''}`}
    >
      {showVideo && (
        <video
          ref={videoElement}
          autoPlay
          playsInline
          muted={isLocal}
          className="meet-person__video"
        />
      )}

      <div className="meet-person__shade" aria-hidden="true" />

      <div className="meet-person__top">
        <span className="meet-person__name">
          {name.replace(/\s*\(You\)\s*/gi, '').trim() || (isLocal ? 'You' : 'Guest')}
          {isLocal && ' (You)'}
        </span>

        <LanguageDisplay language={language} />
      </div>

      {!showVideo && (
        <div className="meet-person__identity">
          <div className="meet-person__avatar">
            {initials(name)}
          </div>
        </div>
      )}

      <div className="meet-person__footer">
        <div className="meet-person__speaking">
          <span
            className={`meet-person__audio-dot ${isMicOn ? 'is-on' : ''}`}
          />
          <span>
            {isMicOn ? 'Microphone on' : 'Microphone off'}
          </span>
        </div>

        <div className="meet-person__indicators">
          {handRaised && (
            <span className="meet-person__hand" title="Hand raised">
              ✋
            </span>
          )}

          {!isMicOn && (
            <span className="meet-person__muted" title="Microphone muted">
              {icons.micOffIcon(16, 16)}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
