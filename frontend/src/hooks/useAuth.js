import { useSyncExternalStore } from 'react'
import { auth, getSession, subscribeSession } from '../services/api'

export function useAuth() {
    const session = useSyncExternalStore(subscribeSession, getSession)
    return {
        status: session.status,
        isLoading: session.status === 'loading',
        isSignedIn: session.status === 'signed-in',
        user: session.user,
        logout: auth.logout,
    }
}
