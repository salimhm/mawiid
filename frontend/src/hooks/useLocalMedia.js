import { useEffect, useRef, useState, useCallback } from 'react'

export function useLocalMedia({
    initialCamOn = false,
    initialMicOn = false,
    videoDeviceId = '',
    audioDeviceId = '',
} = {}) {
    const [isCamOn, setIsCamOn] = useState(initialCamOn)
    const [isMicOn, setIsMicOn] = useState(initialMicOn)
    const [error, setError] = useState('')
    const [localStream, setLocalStream] = useState(null)

    const streamRef = useRef(null)
    const videoRef = useRef(null)

    const attachStream = useCallback(() => {
        if (videoRef.current && streamRef.current)
            videoRef.current.srcObject = streamRef.current
    }, [])

    const stopTracks = useCallback((kind) => {
        if (!streamRef.current)
            return
        streamRef.current.getTracks().filter((t) => t.kind === kind).forEach((t) => {
                t.stop()
                streamRef.current.removeTrack(t)
            })
    }, [])

    const stopAllMedia = useCallback(() => {
        if (!streamRef.current)
            return

        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setLocalStream(null)

        if (videoRef.current)
            videoRef.current.srcObject = null

        setIsCamOn(false)
        setIsMicOn(false)
    }, [])

    const toggleCam = useCallback(async () => {
        setError('')

        if (isCamOn)
        {
            stopTracks('video')
            if (videoRef.current)
                videoRef.current.srcObject = null
            setIsCamOn(false)
            return
        }

        if (!navigator.mediaDevices?.getUserMedia)
        {
            setError('Camera is not supported in this browser')
            return
        }

        try
        {
            const videoConstraint = videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true

            const newStream = await navigator.mediaDevices.getUserMedia({video: videoConstraint})

            if (!streamRef.current) {
                streamRef.current = newStream
                setLocalStream(newStream)
            }
            else
                newStream.getVideoTracks().forEach((track) => {streamRef.current.addTrack(track)})

            attachStream()
            setIsCamOn(true)
        }
        catch
        {
            setError('Unable to access camera')
        }
    }, [isCamOn, videoDeviceId, stopTracks, attachStream])

    const toggleMic = useCallback(async () => {
        setError('')

        if (isMicOn)
        {
            stopTracks('audio')
            setIsMicOn(false)
            return
        }

        if (!navigator.mediaDevices?.getUserMedia)
        {
            setError('Microphone is not supported in this browser')
            return
        }

        try
        {
            const audioConstraint = audioDeviceId ? {deviceId: { exact: audioDeviceId }} : true

            const newStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraint})

            if (!streamRef.current)
                streamRef.current = newStream
            else
                newStream.getAudioTracks().forEach((track) => {streamRef.current.addTrack(track)})
            setIsMicOn(true)
        }
        catch
        {
            setError('Unable to access microphone')
        }
    }, [isMicOn, audioDeviceId, stopTracks])

    useEffect(() => {
        const init = async () => {
            if (initialCamOn)
            {
                try
                {
                    const videoConstraint = videoDeviceId ? {deviceId: { exact: videoDeviceId }} : true

                    const stream = await navigator.mediaDevices.getUserMedia({video: videoConstraint})
                    streamRef.current = stream
                    setLocalStream(stream)
                    attachStream()
                }
                catch
                {
                    setError('Unable to access camera')
                    setIsCamOn(false)
                }
            }

            if (initialMicOn)
            {
                try
                {
                    const audioConstraint = audioDeviceId ? {deviceId: { exact: audioDeviceId }} : true

                    const micStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraint})

                    if (streamRef.current)
                        micStream.getAudioTracks().forEach((t) => {streamRef.current.addTrack(t)})
                    else {
                        streamRef.current = micStream
                        setLocalStream(micStream)
                    }
                }
                catch
                {
                    setError('Unable to access microphone')
                    setIsMicOn(false)
                }
            }
        }

        init()

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
    }, [stopAllMedia])

    return {
        videoRef,
        localStream,
        isCamOn,
        isMicOn,
        toggleCam,
        toggleMic,
        error,
    }
}
