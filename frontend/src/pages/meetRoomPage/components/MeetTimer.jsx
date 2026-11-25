import { useState, useEffect, useRef } from 'react'

function format_elapsed(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0
    ? `${pad(h)}:${pad(m)}:${pad(s)}`
    : `${pad(m)}:${pad(s)}`
}

export default function MeetTimer({ active = false }) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(null)

  useEffect(() => {
    if (!active) {
      startRef.current = null
      return
    }

    if (!startRef.current)
      startRef.current = Date.now() - elapsed * 1000

    const tick = () => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }

    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  if (!active && elapsed === 0)
    return null

  return (
    <div className='fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none'>
      <span className='inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 px-3.5 py-1 text-white/90 font-montserrat text-xs sm:text-sm font-medium tabular-nums tracking-wider'>
        <span className='w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse' />
        {format_elapsed(elapsed)}
      </span>
    </div>
  )
}
