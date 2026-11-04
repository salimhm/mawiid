import ParticipantTile from './ParticipantTile'
import './meet-room-refresh.css'

export default function MeetMain({ localUser = {}, participants = [], fullScreen = false }) {
  const people = [
    { ...localUser, isLocal: true },
    ...participants.map((participant) => ({ ...participant, isLocal: false })),
  ].filter((person) => person.id || person.name)

  const waiting_for_guest = people.length === 1
  const users = waiting_for_guest
    ? [...people, { id: 'mawiid-waiting-guest', name: 'Waiting for guest', isWaiting: true }]
    : people

  const is_featured_call = users.length <= 2

  return (
    <main className={`meet-stage ${fullScreen ? 'meet-stage--fullscreen' : ''}`}>
      <div className={is_featured_call ? 'meet-stage__featured' : 'meet-stage__grid'}>
        {users.map((user, index) => (
          <ParticipantTile
            key={user.id || user.userId || index}
            id={user.id || user.userId || `participant-${index}`}
            name={user.name || (user.isLocal ? 'You' : 'Guest')}
            stream={user.stream || null}
            isCamOn={Boolean(user.isCamOn)}
            isMicOn={Boolean(user.isMicOn)}
            handRaised={Boolean(user.handRaised)}
            isLocal={Boolean(user.isLocal)}
            isWaiting={Boolean(user.isWaiting)}
          />
        ))}
      </div>
    </main>
  )
}
