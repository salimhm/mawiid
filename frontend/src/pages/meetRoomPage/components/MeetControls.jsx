import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GlassSurface from '../../../components/GlassSurface'
import * as icons from '../../../assets/icons'

// The languages the AI translation worker handles (services/ai/README.md).
const LANGUAGE_CODES = {
  English: 'en',
  Arabic: 'ar',
  // 'Darija (Moroccan Arabic)': 'ar-MA',
  French: 'fr',
  // 'Chinese (Simplified)': 'zh-CN',
  // 'Chinese (Traditional)': 'zh-TW',
}

const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮']

export default function MeetControls({
  fullScreen,
  setFullScreen,
  micOn = false,
  camOn = false,
  handRaised = false,
  language = '',
  spokenLanguage = '',
  onMicToggle,
  onCamToggle,
  onScreenShareToggle,
  onHandToggle,
  translationEnabled = false,
  onTranslationToggle,
  onLanguageChange,
  onSpokenLanguageChange,
  onReaction,
  onLeave,
  roomCode = '',
}) {
  const [translating, set_translating] = useState(false)
  const [reacting, set_reacting] = useState(false)
  const [reaction_pos, set_reaction_pos] = useState({ x: 0, y: 0 })
  const [copied, set_copied] = useState(false)
  const [menu_pos, set_menu_pos] = useState({ x: 0, y: 0 })
  const [picked_language, set_picked_language] = useState('')
  const [picked_spoken_language, set_picked_spoken_language] = useState('')

  const navigate = useNavigate()
  const languages = Object.keys(LANGUAGE_CODES)
  const language_name = (code) =>
    languages.find((name) => LANGUAGE_CODES[name] === code) ||
    languages.find((name) => LANGUAGE_CODES[name] === code.split('-')[0]) ||
    'English'
  const curr_language = picked_language || language_name(language)
  const curr_spoken_language = picked_spoken_language || language_name(spokenLanguage || language)
  const room_id = roomCode

  useEffect(() => {
    if (!translating) return
    const handle_screen_click = () => set_translating(false)
    window.addEventListener('click', handle_screen_click)
    return () => window.removeEventListener('click', handle_screen_click)
  }, [translating])

  useEffect(() => {
    if (!reacting) return
    const handle_screen_click = () => set_reacting(false)
    window.addEventListener('click', handle_screen_click)
    return () => window.removeEventListener('click', handle_screen_click)
  }, [reacting])

  const handle_reaction_click = (e) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    set_reaction_pos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    })
    set_translating(false)
    set_reacting((prev) => !prev)
  }

  const handle_translate_click = (e) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    set_menu_pos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    })
    set_reacting(false)
    set_translating((prev) => !prev)
  }

  const handle_language_change = (name) => {
    set_picked_language(name)
    onLanguageChange?.(LANGUAGE_CODES[name])
  }

  const handle_spoken_language_change = (name) => {
    set_picked_spoken_language(name)
    onSpokenLanguageChange?.(LANGUAGE_CODES[name])
  }

  const language_section = (title, current, on_pick) => (
    <>
      <div className='px-4 py-2 border-b border-white/24 text-sm sm:text-base text-white bg-white/20 flex items-center gap-2 font-medium'>
        {icons.translateIcon(24, 24, 1)} {title}
      </div>
      {languages.map((name) => (
        <button
          key={name}
          type='button'
          className={
            name === current
              ? 'w-full py-2 hover:bg-white/40 border-white/20 border-b text-white font-semibold text-sm sm:text-base bg-blue-600/50 cursor-default'
              : 'w-full py-2 hover:bg-white/10 border-white/20 border-b text-sm sm:text-base cursor-pointer'
          }
          onClick={() => on_pick(name)}
        >
          {name}
        </button>
      ))}
    </>
  )

  const copy_to_clipboard = async (text) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!success) throw new Error('Copy failed')
  }

  const handle_copy_click = async () => {
    if (!room_id) return
    try {
      await copy_to_clipboard(room_id)
      set_copied(true)
      setTimeout(() => set_copied(false), 1500)
    } catch (error) {
      console.error('Failed to copy Room ID:', error)
    }
  }

  const popup_x =
    typeof window !== 'undefined'
      ? Math.min(Math.max(menu_pos.x, 110), window.innerWidth - 110)
      : menu_pos.x

  return (
    <>
      <footer
        className={
          fullScreen
            ? 'fixed bottom-0 left-0 right-0 z-40 h-16 sm:h-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-2 sm:px-4 md:px-6 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] sm:pb-5 bg-gradient-to-t from-black/85 via-black/50 to-transparent'
            : 'h-16 sm:h-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-2 sm:px-4 md:px-6 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] sm:pb-0 mb-1 sm:mb-3'
        }
      >
        <div className='flex items-center justify-start min-w-0 pr-1'>
          {!fullScreen && (
            <div className='flex items-center gap-1 sm:gap-2 min-w-0 max-w-full text-white text-xs sm:text-sm md:text-base font-montserrat'>
              <span className='hidden md:inline font-medium text-white/70 shrink-0'>ID :</span>
              <span className='truncate text-white/90 font-medium max-w-[55px] sm:max-w-[120px] md:max-w-[180px] lg:max-w-none' title={room_id}>
                {room_id}
              </span>
              <button
                type='button'
                onClick={handle_copy_click}
                className='hover:scale-110 active:scale-95 transition p-0.5 sm:p-1 shrink-0 text-white/80 hover:text-white cursor-pointer'
                title='Copy ID'
                aria-label='Copy ID'
              >
                <span className='hidden sm:inline'>{icons.copyIcon(18, 18)}</span>
                <span className='sm:hidden'>{icons.copyIcon(15, 15)}</span>
              </button>
            </div>
          )}
        </div>

        <div className='flex items-center justify-center min-w-0 px-1 sm:px-2'>
          <GlassSurface
            width='auto'
            height='auto'
            borderRadius={999}
            backgroundOpacity={0.16}
            blur={14}
            brightness={45}
            className='shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]'
          >
            <div className='flex items-center gap-1.5 sm:gap-2 p-0.5 sm:p-1'>
              <div className='h-9 sm:h-11 md:h-12 flex items-center gap-1 sm:gap-3 md:gap-4 px-2 sm:px-3.5 md:px-4 rounded-full bg-[#444446]/90 shrink-0'>
                <button
                  type='button'
                  onClick={onMicToggle || (() => {})}
                  aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  title={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center transition hover:scale-110 active:scale-90 cursor-pointer rounded-full ${
                    !micOn ? 'text-red-400' : 'text-white hover:text-white/80'
                  }`}
                >
                  <span className='hidden sm:inline'>{micOn ? icons.micOnIcon(22, 22, 2) : icons.micOffIcon(22, 22, 2)}</span>
                  <span className='sm:hidden'>{micOn ? icons.micOnIcon(17, 17, 2) : icons.micOffIcon(17, 17, 2)}</span>
                </button>
                <button
                  type='button'
                  onClick={onCamToggle || (() => {})}
                  aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
                  title={camOn ? 'Turn off camera' : 'Turn on camera'}
                  className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center transition hover:scale-110 active:scale-90 cursor-pointer rounded-full ${
                    !camOn ? 'text-red-400' : 'text-white hover:text-white/80'
                  }`}
                >
                  <span className='hidden sm:inline'>{camOn ? icons.camOnIcon(22, 22, 2) : icons.camOffIcon(22, 22, 2)}</span>
                  <span className='sm:hidden'>{camOn ? icons.camOnIcon(17, 17, 2) : icons.camOffIcon(17, 17, 2)}</span>
                </button>
                <button
                  type='button'
                  onClick={handle_translate_click}
                  aria-label='Select language'
                  title='Your language'
                  className='w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-white transition hover:scale-110 active:scale-90 cursor-pointer rounded-full hover:text-white/80'
                >
                  <span className='hidden sm:inline'>{icons.translateIcon(22, 22, 2)}</span>
                  <span className='sm:hidden'>{icons.translateIcon(17, 17, 2)}</span>
                </button>
                <button
                  type='button'
                  onClick={handle_reaction_click}
                  aria-label='Reactions'
                  title='Reactions'
                  className='w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-white transition hover:scale-110 active:scale-90 cursor-pointer rounded-full hover:text-white/80'
                >
                  <span className='hidden sm:inline'>{icons.emojiIcon(22, 22, 1.8)}</span>
                  <span className='sm:hidden'>{icons.emojiIcon(17, 17, 1.8)}</span>
                </button>
              </div>

              <div className='h-9 sm:h-11 md:h-12 flex items-center gap-1 sm:gap-3 md:gap-4 px-2 sm:px-3.5 md:px-4 rounded-full bg-[#444446]/90 shrink-0'>
                <button
                  type='button'
                  onClick={onScreenShareToggle || (() => {})}
                  aria-label='Share screen'
                  title='Share screen'
                  className='w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-white transition hover:scale-110 active:scale-90 cursor-pointer rounded-full hover:text-white/80'
                >
                  <span className='hidden sm:inline'>{icons.shareScreenIcon(22, 22, 2)}</span>
                  <span className='sm:hidden'>{icons.shareScreenIcon(17, 17, 2)}</span>
                </button>
                <button
                  type='button'
                  onClick={onHandToggle || (() => {})}
                  aria-label={handRaised ? 'Lower hand' : 'Raise hand'}
                  title={handRaised ? 'Lower hand' : 'Raise hand'}
                  className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center transition hover:scale-110 active:scale-90 cursor-pointer rounded-full ${
                    handRaised ? 'text-yellow-300' : 'text-white hover:text-white/80'
                  }`}
                >
                  <span className='hidden sm:inline'>{icons.raiseHandIcon(22, 22, 2)}</span>
                  <span className='sm:hidden'>{icons.raiseHandIcon(17, 17, 2)}</span>
                </button>
              </div>

              <button
                type='button'
                onClick={onLeave || (() => navigate('/'))}
                aria-label='Leave call'
                title='Leave call'
                className='h-9 sm:h-11 md:h-12 flex items-center justify-center px-3.5 sm:px-5 md:px-6 rounded-full bg-[#ea2d24] hover:bg-[#d01f17] text-white transition hover:scale-105 active:scale-90 cursor-pointer shrink-0 shadow-md'
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  className='w-[17px] h-[17px] sm:w-[20px] sm:h-[20px] md:w-[22px] md:h-[22px] rotate-[135deg]'
                >
                  <path stroke='none' d='M0 0h24v24H0z' fill='none' />
                  <path d='M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2' />
                </svg>
              </button>
            </div>
          </GlassSurface>
        </div>

        <div className='flex items-center justify-end min-w-0 pl-1'>
          <GlassSurface
            width='auto'
            height='auto'
            borderRadius={999}
            backgroundOpacity={0.12}
            blur={12}
            className='shadow-lg shrink-0'
          >
            <button
              type='button'
              onClick={() => setFullScreen(!fullScreen)}
              title={fullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
              aria-label={fullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
              className='text-white p-1.5 sm:p-2 hover:scale-110 active:scale-90 transition cursor-pointer flex items-center justify-center'
            >
              <span className='hidden sm:inline'>
                {fullScreen ? icons.minimizeIcon(20, 20) : icons.maximizeIcon(20, 20)}
              </span>
              <span className='sm:hidden'>
                {fullScreen ? icons.minimizeIcon(16, 16) : icons.maximizeIcon(16, 16)}
              </span>
            </button>
          </GlassSurface>
        </div>
      </footer>

      {translating && (
        <div
          className='fixed w-56 sm:w-60 max-h-[70vh] overflow-y-auto rounded-3xl bg-black/60 backdrop-blur-xl border border-white/24 text-white font-inter z-[65] shadow-2xl'
          style={{
            left: popup_x,
            top: menu_pos.y - 12,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <button
            type='button'
            aria-pressed={translationEnabled}
            className='w-full flex items-center justify-between px-4 py-2.5 border-b border-white/24 text-sm sm:text-base font-medium hover:bg-white/10 cursor-pointer'
            onClick={() => onTranslationToggle?.()}
          >
            Live translation
            <span className={translationEnabled ? 'rounded-full bg-blue-600 px-2.5 py-0.5 text-xs' : 'rounded-full bg-white/20 px-2.5 py-0.5 text-xs'}>
              {translationEnabled ? 'On' : 'Off'}
            </span>
          </button>
          {language_section('I speak', curr_spoken_language, handle_spoken_language_change)}
          {language_section('Show captions in', curr_language, handle_language_change)}
        </div>
      )}

      {reacting && (
        <div
          className='fixed rounded-full bg-black/60 backdrop-blur-xl border border-white/24 z-[65] shadow-2xl flex items-center gap-1 px-2 py-1.5 max-w-[95vw]'
          style={{
            left:
              typeof window !== 'undefined'
                ? Math.min(Math.max(reaction_pos.x, 140), window.innerWidth - 140)
                : reaction_pos.x,
            top: reaction_pos.y - 12,
            transform: 'translate(-50%, -100%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type='button'
              className='text-2xl leading-none p-1.5 rounded-full hover:bg-white/15 hover:scale-125 transition cursor-pointer'
              onClick={() => onReaction?.(reaction)}
              title={`React ${reaction}`}
            >
              {reaction}
            </button>
          ))}
        </div>
      )}

      {copied && (
        <div className='fixed bottom-20 left-1/2 -translate-x-1/2 sm:left-6 sm:translate-x-0 z-[60] rounded-xl border border-white/20 bg-black/80 px-4 py-2 text-white text-xs sm:text-sm backdrop-blur-xl shadow-xl whitespace-nowrap'>
          Room ID copied
        </div>
      )}
    </>
  )
}
