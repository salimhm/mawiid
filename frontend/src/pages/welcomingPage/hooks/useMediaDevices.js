import { useEffect, useRef, useState } from 'react'

export function useMediaDevices() {
    const videoRef = useRef(null)
    const videoTrackRef = useRef(null)
    const audioTrackRef = useRef(null)

    const [micPermission, setMicPermission] = useState(false)
    const [camPermission, setCamPermission] = useState(false)
    const [isCamActive, setIsCamActive] = useState(false)
    const [isMicActive, setIsMicActive] = useState(false)
    const [mediaError, setMediaError] = useState('')
    const [devicesLoaded, setDevicesLoaded] = useState(false)
    const [devices, setDevices] = useState({ audio: [], video: [], speakers: [] })
    const [selectedDevices, setSelectedDevices] = useState({ audio: '', video: '', speaker: '' })

    const stopAllMedia = () => {
        videoTrackRef.current?.stop()
        audioTrackRef.current?.stop()
        videoTrackRef.current = null
        audioTrackRef.current = null
        updateVideoPreview(null)
        setIsCamActive(false)
        setIsMicActive(false)
    }

    const syncPermissions = async () => {
        if (!navigator.mediaDevices?.enumerateDevices)
            return

        let micGranted = false
        let camGranted = false

        if (navigator.permissions?.query) {
            try {
                const micStatus = await navigator.permissions.query({ name: 'microphone' })
                micGranted = micStatus.state === 'granted'
            } catch {
                micGranted = false
            }

            try {
                const camStatus = await navigator.permissions.query({ name: 'camera' })
                camGranted = camStatus.state === 'granted'
            } catch {
                camGranted = false
            }
        }

        setMicPermission(micGranted)
        setCamPermission(camGranted)

        if (micGranted || camGranted)
            loadDevices()
    }

    const loadDevices = () => {
        navigator.mediaDevices.enumerateDevices()
            .then((all) => {
                setDevices({
                    audio: all.filter(d => d.kind === 'audioinput'),
                    video: all.filter(d => d.kind === 'videoinput'),
                    speakers: all.filter(d => d.kind === 'audiooutput'),
                })
                setDevicesLoaded(true)
            })
            .catch((error) => console.error('Error enumerating devices: ', error))
    }

    const updateVideoPreview = (track) => {
        if (!videoRef.current)
            return
        videoRef.current.srcObject = track ? new MediaStream([track]) : null
    }

    const handleCamClick = () => {
        setMediaError('')
        if (!navigator.mediaDevices?.getUserMedia)
            return setMediaError('Camera is not supported in this browser')

        if (isCamActive) {
            videoTrackRef.current?.stop()
            videoTrackRef.current = null
            updateVideoPreview(null)
            setIsCamActive(false)
        } else {
            const videoConstraint = selectedDevices.video ? { deviceId: { exact: selectedDevices.video } } : true
            navigator.mediaDevices.getUserMedia({ video: videoConstraint })
                .then((stream) => {
                    const track = stream.getVideoTracks()[0]
                    videoTrackRef.current = track
                    updateVideoPreview(track)
                    setIsCamActive(true)
                    setCamPermission(true)
                    if (!devicesLoaded) loadDevices()
                })
                .catch(() => setMediaError('Unable to access camera. You can still join with it off.'))
        }
    }

    const handleMicClick = () => {
        setMediaError('')
        if (!navigator.mediaDevices?.getUserMedia)
            return setMediaError('Microphone is not supported in this browser')

        if (isMicActive) {
            audioTrackRef.current?.stop()
            audioTrackRef.current = null
            setIsMicActive(false)
        } else {
            const audioConstraint = selectedDevices.audio ? { deviceId: { exact: selectedDevices.audio } } : true
            navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
                .then((stream) => {
                    const track = stream.getAudioTracks()[0]
                    audioTrackRef.current = track
                    setIsMicActive(true)
                    setMicPermission(true)
                    if (!devicesLoaded) loadDevices()
                })
                .catch(() => setMediaError('Unable to access microphone. You can still join with it off.'))
        }
    }

    const handleVideoChange = (e) => {
        const deviceId = e.target.value
        setSelectedDevices(prev => ({ ...prev, video: deviceId }))
        if (!isCamActive || !deviceId) return
        navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
            .then((stream) => {
                const newTrack = stream.getVideoTracks()[0]
                videoTrackRef.current?.stop()
                videoTrackRef.current = newTrack
                updateVideoPreview(newTrack)
            })
            .catch((error) => console.error('Error switching camera: ', error))
    }

    const handleAudioChange = (e) => {
        const deviceId = e.target.value
        setSelectedDevices(prev => ({ ...prev, audio: deviceId }))
        if (!isMicActive || !deviceId) return
        navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } })
            .then((stream) => {
                const newTrack = stream.getAudioTracks()[0]
                audioTrackRef.current?.stop()
                audioTrackRef.current = newTrack
            })
            .catch((error) => console.error('Error switching microphone: ', error))
    }

    const handleSpeakerChange = (e) => {
        const deviceId = e.target.value
        setSelectedDevices(prev => ({ ...prev, speaker: deviceId }))
        if (videoRef.current?.setSinkId && deviceId)
            videoRef.current.setSinkId(deviceId)
                .catch((error) => console.error('Error switching speaker: ', error))
    }

    useEffect(() => {
        syncPermissions()

        if (!navigator.permissions?.query)
            return

        let micStatus
        let camStatus

        const watchPermissions = async () => {
            try {
                micStatus = await navigator.permissions.query({ name: 'microphone' })
                micStatus.onchange = syncPermissions
            } catch {
                micStatus = null
            }

            try {
                camStatus = await navigator.permissions.query({ name: 'camera' })
                camStatus.onchange = syncPermissions
            } catch {
                camStatus = null
            }
        }

        watchPermissions()

        return () => {
            if (micStatus)
                micStatus.onchange = null
            if (camStatus)
                camStatus.onchange = null
        }
    }, [])

    useEffect(() => {
        const handlePageLeave = () => {
            stopAllMedia()
        }

        window.addEventListener('pagehide', handlePageLeave)
        window.addEventListener('beforeunload', handlePageLeave)

        return () => {
            window.removeEventListener('pagehide', handlePageLeave)
            window.removeEventListener('beforeunload', handlePageLeave)
            stopAllMedia()
        }
    }, [])

    return {
        videoRef,
        isCamActive, isMicActive,
        micPermission, camPermission,
        devices, selectedDevices,
        handleCamClick, handleMicClick,
        handleVideoChange, handleAudioChange, handleSpeakerChange,
        mediaError,
    }
}
