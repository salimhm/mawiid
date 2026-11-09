
import ParticipantTile from './ParticipantTile'
import './meet-room-refresh.css'

export default function MeetMain({
  localUser = {},
  participants = [],
  fullScreen = false,
}) {
  const users = [
    { ...localUser, isLocal: true },
    ...participants.map((participant) => ({
      ...participant,
      isLocal: false,
    })),
  ].filter((person) => person.id || person.userId || person.name)

  const count = users.length

  const layoutClass =
    count === 1
      ? 'meet-stage__single'
      : count === 2
        ? 'meet-stage__featured'
        : 'meet-stage__grid'

  return (
    <main
      className={`meet-stage ${fullScreen ? 'meet-stage--fullscreen' : ''}`}
    >
      <div className={layoutClass}>
        {users.map((user, index) => (
          <ParticipantTile
            key={user.id || user.userId || index}
            id={user.id || user.userId || `participant-${index}`}
            name={user.name || (user.isLocal ? 'You' : 'Guest')}
            stream={user.stream || null}
            isCamOn={Boolean(user.isCamOn)}
            isMicOn={Boolean(user.isMicOn)}
            handRaised={Boolean(user.handRaised)}
            language={user.language}
            isLocal={Boolean(user.isLocal)}
            colorIndex={index}
          />
        ))}
      </div>
    </main>
  )
}
