// Where to go after signing in: the page someone opened while signed out (e.g. a room link).
// Kept in localStorage, not router state, so it survives the email verification step, which
// opens in a new tab.
const RETURN_TO_KEY = 'mawiid.returnTo'

// Only paths inside this app: "//evil.com" would leave the site.
const isAppPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')

export function saveReturnTo(path) {
    if (!isAppPath(path))
        return
    try {
        localStorage.setItem(RETURN_TO_KEY, path)
    } catch {
        // storage blocked: they land on the home page after signing in
    }
}

// The saved path, removed so it is used once.
export function takeReturnTo() {
    try {
        const path = localStorage.getItem(RETURN_TO_KEY)
        localStorage.removeItem(RETURN_TO_KEY)
        return isAppPath(path) ? path : null
    } catch {
        return null
    }
}
