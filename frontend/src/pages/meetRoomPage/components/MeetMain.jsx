import { useState, useEffect, useRef, useCallback } from 'react'
import ParticipantTile from './ParticipantTile'
import ScreenShareStage from './ScreenShareStage'
import { participantColor } from '../../../lib/participantColor'

function compute_grid(count, container_w, container_h, gap) {
  if (count === 0) return { cols: 1, rows: 1 }
  if (count === 1) return { cols: 1, rows: 1 }

  let best = { cols: 1, rows: count, area: 0 }

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const tile_w = (container_w - gap * (cols - 1)) / cols
    const tile_h = (container_h - gap * (rows - 1)) / rows
    const scale = Math.min(tile_w, tile_h * (16 / 9))
    const area = scale * (scale * 9 / 16)
    if (area > best.area) {
      best = { cols, rows, area }
    }
  }

  return best
}

function useContainerSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((prev) =>
        prev.width === Math.round(width) && prev.height === Math.round(height)
          ? prev
          : { width: Math.round(width), height: Math.round(height) }
      )
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return size
}

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
  const gridRef = useRef(null)
  const container_size = useContainerSize(gridRef)

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
    return spotlight(
      <div className='flex-1 min-h-0 min-w-0 grid [&>section]:min-h-0'>
        {tile(featuredSpeaker, featuredSpeaker.id)}
      </div>,
      stripTiles(users.filter((user) => user !== featuredSpeaker)),
    )
  }

  const count = users.length
  const gap = container_size.width >= 768 ? 12 : 8
  const { cols, rows } = compute_grid(count, container_size.width, container_size.height, gap)

  const grid_style = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap: `${gap}px`,
    width: '100%',
    height: '100%',
    minHeight: 0,
  }

  const last_row_count = count % cols || cols
  const last_row_start = count - last_row_count
  const center_last_row = last_row_count < cols

  return (
    <main className={stage_class}>
      <div ref={gridRef} style={grid_style}>
        {users.map((user, index) => {
          const is_last_row = index >= last_row_start
          const style = is_last_row && center_last_row
            ? {
              gridColumn: index === last_row_start
                ? `${Math.floor((cols - last_row_count) / 2) + 1} / span 1`
                : undefined,
            }
            : undefined
          return (
            <div key={user.id || user.userId || index} className='min-h-0 min-w-0' style={style}>
              {tile(user, index)}
            </div>
          )
        })}
      </div>
    </main>
  )
}
