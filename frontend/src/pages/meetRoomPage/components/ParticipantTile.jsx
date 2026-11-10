import { useEffect, useRef } from 'react'
import * as icons from '../../../assets/icons'
import { NEUTRAL_COLOR } from '../../../lib/participantColor'
import './meet-room-refresh.css'

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
  color,
}) {
  const videoElement = useRef(null)
  const showVideo = Boolean(stream && isCamOn)

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
      style={{ backgroundImage: (color || NEUTRAL_COLOR).background }}
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
