import { useState , useEffect } from 'react'
import ParticipantTile from './ParticipantTile'
import ScreenShareStage from './ScreenShareStage'
import { participantColor } from '../../../lib/participantColor'

// Three layouts:
// - grid: everyone in equal tiles;
// - speaker (picked with `layout`): the person talking fills the stage, everyone else is
//   in a strip beside it;
// - screen, whenever someone shares their screen (whatever `layout` is): the shared screen
//   fills the stage and everyone's tiles are in the strip.
// The strip is a column on the right on wide screens and a row below the stage on narrow
// ones; it scrolls when there are many people.
// With several screens shared, one is on the stage (someone else's before your own) and
// the others wait in the strip; clicking one puts it on the stage.
export default function MeetMain({
  localUser = {},
  participants = [],
  fullScreen = false,
  colorOf = participantColor,
  layout = 'grid',
  spotlightId = null,
  onStopScreenShare,
}) {
  const [pinnedScreenId, setPinnedScreenId] = useState(null)

  const users = [
    { ...localUser, isLocal: true },
    ...participants.map((participant) => ({
      ...participant,
      isLocal: false,
    })),
  ].filter((person) => person.id || person.userId || person.name)

  const displayName = (user) => user.name?.replace(/\s*\(You\)\s*/gi, '').trim() || (user.isLocal ? 'You' : 'Guest')

  const screens = users
    .filter((user) => user.isScreenSharing && (user.screenStream || user.isLocal))
    .map((user) => ({ id: user.id, name: displayName(user), stream: user.screenStream, isLocal: user.isLocal }))
  const featuredScreen =
    screens.find((screen) => screen.id === pinnedScreenId) ||
    screens.find((screen) => !screen.isLocal) ||
    screens[0] ||
    null

  // The last other person who spoke; before anyone has, the first other person; alone, you.
  const others = users.filter((user) => !user.isLocal)
  const featuredSpeaker = layout === 'speaker' && !featuredScreen
    ? others.find((user) => user.id === spotlightId) || others[0] || users[0] || null
    : null

  const stage_class = [
    'flex-1 min-h-0 w-full flex',
    'px-[clamp(8px,2vw,16px)] md:px-[clamp(12px,2.5vw,40px)]',
    fullScreen
      ? 'pt-[66px] pb-[82px] md:pt-[76px] md:pb-[92px]'
      : 'pt-[6px] pb-[12px] md:pt-[10px] md:pb-[18px]',
  ].join(' ')

  useEffect(() => {
    console.log('-----  users: ', users)
  }, [users])

  const tile = (user, index, compact = false) => (
    <ParticipantTile
      key={user.id || user.userId || index}
      color={colorOf(user.id)}
      name={user.name || (user.isLocal ? 'You' : 'Guest')}
      stream={user.stream || null}
      isCamOn={Boolean(user.isCamOn)}
      isMicOn={Boolean(user.isMicOn)}
      handRaised={Boolean(user.handRaised)}
      isSpeaking={Boolean(user.isSpeaking)}
      isLocal={Boolean(user.isLocal)}
      compact={compact}
      language={user.language}
    />
  )

  // Each strip item: 16:9, sized by the strip's height in a row or its width in a column.
  const item_class = 'shrink-0 h-full aspect-video lg:h-auto lg:w-full'

  const spotlight = (stage, strip) => (
    <main className={stage_class}>
      <div className='w-full min-h-0 flex flex-col lg:flex-row gap-2.5 md:gap-4'>
        <div className='flex-1 min-h-0 min-w-0 flex'>{stage}</div>
        {strip.length > 0 && (
          <aside
            className='shrink-0 flex flex-row lg:flex-col gap-2 md:gap-3 h-24 sm:h-28 md:h-32 lg:h-auto lg:w-[clamp(180px,18vw,260px)] overflow-x-auto overflow-y-hidden lg:overflow-x-hidden lg:overflow-y-auto overscroll-contain'
            aria-label='Participants'
          >
            {strip}
          </aside>
        )}
      </div>
    </main>
  )

  const stripTiles = (list) => list.map((user, index) => (
    <div key={user.id || user.userId || index} className={item_class}>
      {tile(user, index, true)}
    </div>
  ))

  if (featuredScreen) {
    const waiting = screens
      .filter((screen) => screen !== featuredScreen)
      .map((screen) => (
        <div key={`screen:${screen.id}`} className={item_class}>
          <ScreenShareStage
            thumbnail
            name={screen.name}
            stream={screen.stream}
            isLocal={screen.isLocal}
            onSelect={() => setPinnedScreenId(screen.id)}
          />
        </div>
      ))
    return spotlight(
      <ScreenShareStage
        key={featuredScreen.id}
        name={featuredScreen.name}
        stream={featuredScreen.stream}
        isLocal={featuredScreen.isLocal}
        onStopSharing={featuredScreen.isLocal ? onStopScreenShare : undefined}
      />,
      [...waiting, ...stripTiles(users)],
    )
  }

  if (featuredSpeaker) {
    // The stage tile is keyed by person: a new speaker gets a fresh tile (no stale video).
    return spotlight(
      <div className='flex-1 min-h-0 min-w-0 grid [&>section]:min-h-0'>
        {tile(featuredSpeaker, featuredSpeaker.id)}
      </div>,
      stripTiles(users.filter((user) => user !== featuredSpeaker)),
    )
  }

  const count = users.length

  const layout_class =
    count === 1
      ? 'w-full min-h-0 grid grid-cols-1 grid-rows-1'
      : count === 2
        ? 'w-full min-h-0 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1 gap-2.5 md:gap-5'
        : 'w-full min-h-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] auto-rows-[minmax(220px,1fr)] md:auto-rows-[minmax(280px,1fr)] gap-2.5 md:gap-4'

  return (
    <main className={stage_class}>
      <div className={layout_class}>
        {users.map((user, index) => tile(user, index))}
      </div>
    </main>
  )
}
