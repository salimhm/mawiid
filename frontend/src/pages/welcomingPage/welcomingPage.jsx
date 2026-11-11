import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BiSolidMicrophoneOff } from 'react-icons/bi'
import { api, ApiError, errorMessage } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import * as icons from '../../assets/icons'
import GlassSurface from '../../components/GlassSurface'
import { colorForSlot } from '../../lib/participantColor'
import dark_logo from '../../assets/logo/mawiid_logo_dark_header.png'
import DeviceSelect from './components/DeviceSelect'
import { useMediaDevices } from './hooks/useMediaDevices'

// The preview tile looks like the user's own tile in the room: same gradient, avatar and badges.
const PREVIEW_COLOR = colorForSlot(0)

function initials(name = '') {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase() || 'M'
}

function ControlButton({ on, onClick, onLabel, offLabel, onIcon, offIcon }) {
    return (
        <button
            type='button'
            onClick={onClick}
            aria-label={on ? onLabel : offLabel}
            title={on ? onLabel : offLabel}
            className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center transition hover:scale-110 active:scale-90 cursor-pointer rounded-full ${
                on ? 'text-white hover:text-white/80' : 'text-red-400'
            }`}
        >
            {on ? onIcon : offIcon}
        </button>
    )
}

export default function WelcomingPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const [actionError, setActionError] = useState('')
    const [creating, setCreating] = useState(false)
    const { user } = useAuth()
    // The state is lost on a page reload; the ?creator=1 in the URL is not.
    const isCreator = useMemo(
        () => location.state?.isCreator === true || new URLSearchParams(location.search).get('creator') === '1',
        [location.state, location.search],
    )
    const displayName = [user?.user_first_name, user?.user_last_name].filter(Boolean).join(' ') || 'You'

    const {
        videoRef,
        isCamActive,
        isMicActive,
        micPermission,
        camPermission,
        devices,
        selectedDevices,
        handleCamClick,
        handleMicClick,
        handleVideoChange,
        handleAudioChange,
        handleSpeakerChange,
        mediaError,
    } = useMediaDevices()

    const meetingMediaState = useMemo(() => ({
        micPermission,
        camPermission,
        isMicActive,
        isCamActive,
        selectedDevices,
    }), [micPermission, camPermission, isMicActive, isCamActive, selectedDevices])

    const handleJoinMeet = async () => {
        setActionError('')

        if (isCreator) {
            setCreating(true)
            try {
                const room = await api.createRoom(user?.user_first_name ? `${user.user_first_name}'s mawiid` : 'New mawiid')
                navigate(`/meet/${room.room_uid}`, { state: { mediaState: meetingMediaState } })
            } catch (err) {
                setActionError(err instanceof ApiError && err.code === 'forbidden'
                    ? 'Your account is not allowed to create a mawiid. Join an existing one with its code.'
                    : errorMessage(err))
                setCreating(false)
            }
            return
        }

        const joinedRoomCode = location.state?.roomCode
        if (!joinedRoomCode) {
            setActionError('Missing room code. Please join from the landing page.')
            return
        }

        navigate(`/meet/${joinedRoomCode}`, { state: { mediaState: meetingMediaState } })
    }

    const roomCode = !isCreator ? location.state?.roomCode : ''

    return (
        <div className='flex flex-col min-h-screen min-h-[100dvh] bg-black overflow-x-hidden select-none'>
            <header className='relative h-14 sm:h-16 px-3 sm:px-5 flex items-center justify-between shrink-0'>
                <button type='button' onClick={() => navigate('/')} className='cursor-pointer' aria-label='Back to home'>
                    <img src={dark_logo} alt='Mawiid' className='h-7 sm:h-8 md:h-10 lg:h-12 w-auto' />
                </button>
                {roomCode && (
                    <span className='truncate max-w-[50%] text-white/70 text-xs sm:text-sm font-montserrat font-medium'>
                        ID : <span className='text-white/90'>{roomCode}</span>
                    </span>
                )}
            </header>

            <main className='flex-1 min-h-0 w-full flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12 px-[clamp(8px,2vw,16px)] md:px-[clamp(12px,2.5vw,40px)] py-4 md:py-8'>
                <div className='flex flex-col items-center gap-4 w-full max-w-[760px]'>
                    <section
                        className='relative isolate w-full aspect-video min-h-[220px] flex flex-col justify-between overflow-hidden p-3.5 md:p-[clamp(16px,2vw,30px)] rounded-2xl md:rounded-[20px] text-white'
                        style={{
                            background: `radial-gradient(ellipse at 50% 34%, rgba(255,255,255,0.13), transparent 45%), linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.72) 100%), ${PREVIEW_COLOR.background}`,
                        }}
                        aria-label='Your camera preview'
                    >
                        <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className={`absolute inset-0 w-full h-full -z-20 object-cover bg-neutral-900 ${isCamActive ? '' : 'hidden'}`}
                        />
                        <div className='absolute inset-0 -z-10 pointer-events-none bg-[linear-gradient(180deg,rgba(0,0,0,0.22)_0%,transparent_28%,transparent_55%,rgba(0,0,0,0.82)_100%)]' aria-hidden='true' />

                        <div className='flex items-center justify-between gap-3'>
                            <span className='inline-flex items-center min-h-8 md:min-h-[38px] max-w-[min(70%,320px)] px-3 md:px-[18px] py-[7px] md:py-[9px] overflow-hidden rounded-full backdrop-blur-[12px] font-montserrat text-xs md:text-sm font-semibold text-ellipsis whitespace-nowrap bg-black/30'>
                                {displayName} (You)
                            </span>
                        </div>

                        {!isCamActive && (
                            <div className='flex flex-1 flex-col items-center justify-center min-h-0 text-center'>
                                <div
                                    className='grid w-[82px] md:w-[clamp(112px,14vw,170px)] aspect-square place-items-center rounded-full shadow-[0_18px_60px_rgba(0,0,0,0.2),inset_0_0_30px_rgba(255,255,255,0.08)] text-white font-montserrat font-semibold text-[30px] md:text-[clamp(34px,5vw,54px)] leading-none'
                                    style={{
                                        border: `1px solid ${PREVIEW_COLOR.text}`,
                                        background: `radial-gradient(circle at 35% 25%, color-mix(in srgb, ${PREVIEW_COLOR.text} 30%, transparent), color-mix(in srgb, ${PREVIEW_COLOR.text} 8%, transparent) 54%, rgba(0,0,0,0.18))`,
                                    }}
                                >
                                    {initials(displayName)}
                                </div>
                            </div>
                        )}

                        <div className='flex items-end justify-between gap-3'>
                            <GlassSurface
                                width='auto'
                                height='auto'
                                borderRadius={999}
                                backgroundOpacity={0.16}
                                blur={14}
                                brightness={45}
                                className='shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]'
                            >
                                <div className='h-11 sm:h-12 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 m-0.5 sm:m-1 rounded-full bg-[#444446]/90'>
                                    <ControlButton
                                        on={isMicActive}
                                        onClick={handleMicClick}
                                        onLabel='Mute microphone'
                                        offLabel='Unmute microphone'
                                        onIcon={icons.micOnIcon(22, 22, 2)}
                                        offIcon={icons.micOffIcon(22, 22, 2)}
                                    />
                                    <ControlButton
                                        on={isCamActive}
                                        onClick={handleCamClick}
                                        onLabel='Turn off camera'
                                        offLabel='Turn on camera'
                                        onIcon={icons.camOnIcon(22, 22, 2)}
                                        offIcon={icons.camOffIcon(22, 22, 2)}
                                    />
                                </div>
                            </GlassSurface>
                            {!isMicActive && (
                                <span className='inline-flex items-center justify-center p-2 rounded-full text-white/75' title='Microphone muted'>
                                    <BiSolidMicrophoneOff size={28} />
                                </span>
                            )}
                        </div>
                    </section>

                    <div className='flex flex-wrap justify-center gap-2 sm:gap-3 w-full'>
                        <DeviceSelect icon={icons.micOnIcon(20, 20)} placeholder='Audio Devices' value={selectedDevices.audio} onChange={handleAudioChange} disabled={!micPermission} deviceList={devices.audio} />
                        <DeviceSelect icon={icons.speakerIcon(26, 20)} placeholder='Speaker Devices' value={selectedDevices.speaker} onChange={handleSpeakerChange} disabled={!micPermission} deviceList={devices.speakers} />
                        <DeviceSelect icon={icons.camOnIcon(26, 20)} placeholder='Video Devices' value={selectedDevices.video} onChange={handleVideoChange} disabled={!camPermission} deviceList={devices.video} />
                    </div>
                </div>

                <div className='flex flex-col items-center lg:items-start text-center lg:text-left w-full max-w-sm gap-4 pb-[env(safe-area-inset-bottom,0px)]'>
                    <h1 className='text-white font-montserrat font-semibold text-2xl sm:text-3xl'>
                        {isCreator ? 'Ready to start?' : 'Ready to join?'}
                    </h1>
                    <p className='text-white/70 font-inter text-sm sm:text-base leading-relaxed'>
                        Check your camera and microphone, then {isCreator ? 'create your mawiid and invite people with its ID' : 'join the mawiid'}.
                    </p>
                    <button
                        type='button'
                        className='mt-2 h-12 sm:h-14 w-full sm:w-[260px] flex items-center justify-center gap-2 px-6 rounded-full bg-[#2346FA] hover:bg-blue-500 text-white font-montserrat font-semibold text-base sm:text-lg transition hover:scale-[1.03] active:scale-95 cursor-pointer shadow-md disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100'
                        onClick={handleJoinMeet}
                        disabled={creating}
                    >
                        {creating ? 'Creating…' : isCreator ? 'Create the mawiid' : 'Join the mawiid'}
                    </button>
                    {mediaError && <p className='text-red-400 text-sm'>{mediaError}</p>}
                    {actionError && <p className='text-red-400 text-sm'>{actionError}</p>}
                </div>
            </main>
        </div>
    )
}
