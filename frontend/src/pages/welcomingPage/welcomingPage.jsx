import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, errorMessage } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import * as icons from '../../assets/icons'
import ControlsButtons from '../../components/controlButtons'
import DeviceSelect from './components/DeviceSelect'
import { useMediaDevices } from './hooks/useMediaDevices'

export default function WelcomingPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const [mediaError, setMediaError] = useState('')
    const [actionError, setActionError] = useState('')
    const [creating, setCreating] = useState(false)
    const { user } = useAuth()
    const isCreator = useMemo(() => location.state?.isCreator === true, [location.state])

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
        requestMediaPermissions,
    } = useMediaDevices()

    const hasPermissions = micPermission && camPermission
    const meetingMediaState = useMemo(() => ({
        micPermission,
        camPermission,
        isMicActive,
        isCamActive,
        selectedDevices,
    }), [micPermission, camPermission, isMicActive, isCamActive, selectedDevices])

    const ensureMediaPermissions = async () => {
        if (hasPermissions)
            return true

        try {
            await requestMediaPermissions()
            return false
        } catch {
            setMediaError('Camera and microphone permission is required before joining the meeting')
            return false
        }
    }

    const handleJoinMeet = async () => {
        setMediaError('')
        setActionError('')

        const canContinue = await ensureMediaPermissions()
        if (!canContinue)
            return

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

    return (
        <div className='relative min-h-screen w-full flex flex-col bg-black items-center justify-center px-4 sm:px-6 py-12 gap-8 overflow-x-hidden'>
            <h1 className='absolute top-2 sm:top-6 lg:top-8 w-full text-center text-5xl sm:text-7xl md:text-[110px] lg:text-[160px] xl:text-[200px] font-bold text-white/20 select-none pointer-events-none leading-none tracking-wider'>
                MAWIID
            </h1>
            <div className='relative z-10 flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-14 w-full max-w-6xl mt-12 sm:mt-16 lg:mt-24'>
                <div className='flex flex-col items-center w-full max-w-[680px]'>
                    <div className='relative w-full aspect-video rounded-2xl bg-gray-900 border border-white/20 overflow-hidden shadow-2xl flex items-center justify-center'>
                        <video ref={videoRef} autoPlay muted playsInline className='w-full h-full object-cover' />
                        <div className='absolute bottom-4 left-0 right-0 flex justify-center'>
                            <ControlsButtons
                                buttons={[
                                    { icon: isMicActive ? icons.micOnIcon() : icons.micOffIcon(), onClick: handleMicClick },
                                    { icon: isCamActive ? icons.camOnIcon() : icons.camOffIcon(), onClick: handleCamClick },
                                ]}
                            />
                        </div>
                    </div>
                    <div className='mt-6 flex flex-wrap justify-center gap-3 w-full'>
                        <DeviceSelect icon={icons.micOnIcon(20, 20)} placeholder='Audio Devices' value={selectedDevices.audio} onChange={handleAudioChange} disabled={!micPermission} deviceList={devices.audio} />
                        <DeviceSelect icon={icons.speakerIcon(26, 20)} placeholder='Speaker Devices' value={selectedDevices.speaker} onChange={handleSpeakerChange} disabled={!micPermission} deviceList={devices.speakers} />
                        <DeviceSelect icon={icons.camOnIcon(26, 20)} placeholder='Video Devices' value={selectedDevices.video} onChange={handleVideoChange} disabled={!camPermission} deviceList={devices.video} />
                    </div>
                </div>
                <div className='flex flex-col items-center lg:items-start text-center lg:text-left max-w-md w-full px-2'>
                    <p className='text-white text-base sm:text-lg lg:text-[20px] tracking-wide inter my-4 lg:my-6 leading-relaxed'>
                        Welcome to your meeting in Mawiid! Let&apos;s get started and make this session productive.
                    </p>
                    <button className='montserrat-500 border border-[#FFFFFF4D] bg-[#2346FA] hover:bg-blue-500 cursor-pointer px-8 rounded-full w-full sm:w-[250px] h-[55px] sm:h-[60px] flex justify-center items-center transition-all duration-200 mt-4 sm:mt-6 lg:mt-10 text-white text-base sm:text-[19px] font-semibold shadow-lg hover:shadow-blue-500/25 disabled:opacity-60 disabled:cursor-not-allowed' onClick={handleJoinMeet} disabled={creating}>
                        {creating ? 'Creating…' : isCreator ? 'Create the mawiid' : 'Join the mawiid'}
                    </button>
                    {mediaError && <p className='mt-4 text-red-400 text-sm'>{mediaError}</p>}
                    {actionError && <p className='mt-2 text-red-400 text-sm'>{actionError}</p>}
                </div>
            </div>
        </div>
    )
}