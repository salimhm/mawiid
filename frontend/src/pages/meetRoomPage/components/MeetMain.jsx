import ParticipantTile from './ParticipantTile'
import { participantColor } from '../../../lib/participantColor'

export default function MeetMain({
  localUser = {},
  participants = [],
  fullScreen = false,
  colorOf = participantColor,
}) {
  const users = [
    { ...localUser, isLocal: true },
    ...participants.map((participant) => ({
      ...participant,
      isLocal: false,
    })),
  ].filter((person) => person.id || person.userId || person.name)

  const count = users.length

  const layout_class =
    count === 1
      ? 'w-full min-h-0 grid grid-cols-1 grid-rows-1'
      : count === 2
        ? 'w-full min-h-0 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1 gap-2.5 md:gap-5'
        : 'w-full min-h-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] auto-rows-[minmax(220px,1fr)] md:auto-rows-[minmax(280px,1fr)] gap-2.5 md:gap-4'

  const stage_class = [
    'flex-1 min-h-0 w-full flex',
    'px-[clamp(8px,2vw,16px)] md:px-[clamp(12px,2.5vw,40px)]',
    fullScreen
      ? 'pt-[66px] pb-[82px] md:pt-[76px] md:pb-[92px]'
      : 'pt-[6px] pb-[12px] md:pt-[10px] md:pb-[18px]',
  ].join(' ')

  return (
    <main className={stage_class}>
      <div className={layout_class}>
        {users.map((user, index) => (
          <ParticipantTile
            key={user.id || user.userId || index}
            color={colorOf(user.id)}
            name={user.name || (user.isLocal ? 'You' : 'Guest')}
            stream={user.stream || null}
            isCamOn={Boolean(user.isCamOn)}
            isMicOn={Boolean(user.isMicOn)}
            handRaised={Boolean(user.handRaised)}
            isLocal={Boolean(user.isLocal)}
          />
        ))}
      </div>
    </main>
  )
}
