import { useEffect, useRef } from 'react'
import * as icons from '../../../assets/icons'

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
  isLocal = false,
  isWaiting = false,
}) {
  const video_element = useRef(null)
  const show_video = Boolean(stream && isCamOn && !isWaiting)

  useEffect(() => {
    const video = video_element.current
    if (!video) return
    video.srcObject = show_video ? stream : null
  }, [stream, show_video])

  return (
    <section
      className={[
        'meet-person',
        isLocal ? 'meet-person--host' : 'meet-person--guest',
        isWaiting ? 'meet-person--waiting' : '',
        show_video ? 'meet-person--video' : '',
      ].join(' ')}
      aria-label={`${name}${isLocal ? ', you' : ''}`}
    >
      {show_video && (
        <video
          ref={video_element}
          autoPlay
          playsInline
          muted={isLocal}
          className="meet-person__video"
        />
      )}

      <div className="meet-person__shade" aria-hidden="true" />

      <div className="meet-person__top">
        <span className="meet-person__name">{name}</span>
        <span className="meet-person__live">
          <span className="meet-person__live-dot" />
          {isWaiting ? 'INVITE SENT' : isLocal ? 'YOU' : 'CONNECTED'}
        </span>
      </div>

      {!show_video && (
        <div className="meet-person__identity">
          {isWaiting ? (
            <div className="meet-person__waiting-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div className="meet-person__avatar" aria-hidden="true">
              {initials(name)}
            </div>
          )}
          <p className="meet-person__identity-label">
            {isWaiting ? 'Your guest will appear here' : isLocal ? 'Camera is off' : 'Camera unavailable'}
          </p>
        </div>
      )}

      <div className="meet-person__footer">
        <div className="meet-person__speaking">
          <span className={`meet-person__audio-dot ${isMicOn ? 'is-on' : ''}`} />
          <span>{isMicOn ? 'Microphone on' : 'Microphone off'}</span>
        </div>
        <div className="meet-person__indicators">
          {handRaised && <span className="meet-person__hand" title="Hand raised">✋</span>}
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
