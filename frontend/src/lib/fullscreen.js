// The Fullscreen API with the prefixed versions older Safari (webkit) and old Edge (ms) use.
// iPhone Safari cannot put an element in full screen, only a <video> through its own player:
// requestElementFullscreen falls back to that when it is given the video inside the element.

export function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null
}

export function canFullscreenElements() {
    return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled)
}

// Full screen is possible here: for an element, or at least for a video (iPhone).
export function canFullscreen(video) {
    return canFullscreenElements() || typeof video?.webkitEnterFullscreen === 'function'
}

export async function requestElementFullscreen(element, video) {
    if (canFullscreenElements()) {
        if (element.requestFullscreen)
            return element.requestFullscreen({ navigationUI: 'hide' })
        if (element.webkitRequestFullscreen)
            return element.webkitRequestFullscreen()
        if (element.msRequestFullscreen)
            return element.msRequestFullscreen()
    }
    if (video?.webkitEnterFullscreen)
        return video.webkitEnterFullscreen()
    throw new Error('Fullscreen is not supported')
}

export async function exitFullscreen() {
    if (!fullscreenElement())
        return
    if (document.exitFullscreen)
        return document.exitFullscreen()
    if (document.webkitExitFullscreen)
        return document.webkitExitFullscreen()
    if (document.msExitFullscreen)
        return document.msExitFullscreen()
}

const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange']

// Calls listener on every full screen change; returns the cleanup that removes it.
export function onFullscreenChange(listener) {
    CHANGE_EVENTS.forEach((name) => document.addEventListener(name, listener))
    return () => CHANGE_EVENTS.forEach((name) => document.removeEventListener(name, listener))
}
