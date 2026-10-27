import MeetHeader from './components/MeetHeader'
import MeetMain from './components/MeetMain'
import MeetControls from './components/MeetControls'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useRoom } from '../../hooks/useRoom'

const STATUS_MESSAGES = {
    connecting: 'Joining the mawiid…',
    reconnecting: 'Connection lost, reconnecting…',
    waiting: 'Waiting for the host to let you in…',
    disconnected: 'You left the mawiid.',
    removed: 'You were removed from the mawiid.',
}

export default function MeetRoomPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const { roomCode: urlRoomCode } = useParams()
    const initialMediaState = location.state?.mediaState || null

    const room = useRoom(urlRoomCode, {
        initialCamOn: initialMediaState?.isCamActive ?? false,
        initialMicOn: initialMediaState?.isMicActive ?? false,
        videoDeviceId: initialMediaState?.selectedDevices?.video || '',
        audioDeviceId: initialMediaState?.selectedDevices?.audio || '',
        speakerDeviceId: initialMediaState?.selectedDevices?.speaker || '',
    })

    const [fullScreen, setFullScreen] = useState(false)
    const { notice, clearNotice } = room

    useEffect(() => {
        if (!notice)
            return
        const timer = setTimeout(clearNotice, 4000)
        return () => clearTimeout(timer)
    }, [notice, clearNotice])

    const handleLeave = () => {
        room.leave()
        navigate('/')
    }

    const overlayMessage = room.status === 'error' ? room.error : STATUS_MESSAGES[room.status]

    return (
        <div className='meet-room flex flex-col h-screen h-[100dvh] bg-black overflow-hidden select-none'>
            <MeetHeader
                fullScreen={fullScreen}
                participants={[room.localUser, ...room.participants]}
                localRole={room.localUser.role}
                isStaff={room.isStaff}
                moderation={room.moderation}
                settings={room.settings}
                onUpdateSettings={room.updateSettings}
                typing={room.typing}
                onTyping={room.sendTyping}
                messages={room.messages}
                hasOlderMessages={room.hasOlderMessages}
                joinedAtMessageId={room.joinedAtMessageId}
                loadingOlderMessages={room.loadingOlderMessages}
                onSendMessage={room.sendMessage}
                onRetryMessage={room.retryMessage}
                onLoadOlderMessages={room.loadOlderMessages}
            />
            <MeetMain
                localUser={room.localUser}
                participants={room.participants}
                fullScreen={fullScreen}
            />
            <MeetControls
                fullScreen={fullScreen}
                setFullScreen={setFullScreen}
                micOn={room.localUser.isMicOn}
                camOn={room.localUser.isCamOn}
                handRaised={room.localUser.handRaised}
                onMicToggle={room.toggleMic}
                onCamToggle={room.toggleCam}
                onScreenShareToggle={room.toggleScreenShare}
                onHandToggle={room.toggleHand}
                onLanguageChange={room.setLanguage}
                onReaction={room.sendReaction}
                onLeave={handleLeave}
                roomCode={room.roomCode}
            />

            {overlayMessage && (
                <div className='fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-black/85 backdrop-blur-sm px-6 text-center'>
                    <p className='text-primary-white font-montserrat text-lg sm:text-2xl'>{overlayMessage}</p>
                    {(room.status === 'error' || room.status === 'disconnected' || room.status === 'removed' || room.status === 'waiting') && (
                        <button className='rounded-full border border-white/30 px-6 py-2 text-white hover:bg-white/10 transition cursor-pointer' onClick={() => navigate('/')}>
                            Back to home
                        </button>
                    )}
                </div>
            )}

            {room.knocks.length > 0 && (
                <div className='fixed top-16 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[calc(100vw-32px)] max-w-sm'>
                    {room.knocks.map(({ userId, userName }) => (
                        <div key={userId} className='flex items-center justify-between gap-3 rounded-2xl border border-white/20 bg-black/80 backdrop-blur-xl px-4 py-3 text-white'>
                            <span className='text-sm'>{userName} wants to join</span>
                            <div className='flex gap-2'>
                                <button className='rounded-full bg-[#2346FA] px-3 py-1 text-sm hover:bg-blue-500 cursor-pointer' onClick={() => room.admit(userId)}>Admit</button>
                                <button className='rounded-full border border-white/30 px-3 py-1 text-sm hover:bg-white/10 cursor-pointer' onClick={() => room.deny(userId)}>Deny</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {room.reactions.length > 0 && (
                <div className='pointer-events-none fixed bottom-28 left-4 sm:left-8 z-[55] flex flex-col-reverse gap-2' aria-live='polite'>
                    {room.reactions.map((entry) => (
                        <div key={entry.id} className='reaction-float flex items-center gap-2 rounded-full bg-black/60 backdrop-blur-md px-3 py-1.5 text-white'>
                            <span className='text-3xl leading-none'>{entry.reaction}</span>
                            <span className='text-sm'>{entry.name}</span>
                        </div>
                    ))}
                </div>
            )}

            {notice && (
                <div className='fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] rounded-xl border border-white/20 bg-black/80 px-4 py-2 text-sm text-white backdrop-blur-xl'>
                    {notice}
                </div>
            )}
        </div>
    )
}
