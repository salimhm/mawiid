import ParticipantTile from './ParticipantTile'
import './meetRoomRefresh.css'

export default function MeetMain({ localUser = {}, participants = [], fullScreen = false }) {
    const people = [
        { ...localUser, isLocal: true },
        ...participants.map((participant) => ({ ...participant, isLocal: false })),
    ].filter((person) => person.id || person.name)

    // Keep the two-person composition from the Figma frame even before a
    // second participant joins. Additional participants use a responsive grid.
    const waitingForGuest = people.length === 1
    const users = waitingForGuest
        ? [...people, { id: 'mawiid-waiting-guest', name: 'Waiting for guest', isWaiting: true }]
        : people

    const isFeaturedCall = users.length <= 2

    return (
        <main className={`meet-stage ${fullScreen ? 'meet-stage--fullscreen' : ''}`}>
            <div className={isFeaturedCall ? 'meet-stage__featured' : 'meet-stage__grid'}>
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
