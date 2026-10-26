import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'

const buttonClass = 'h-[40px] px-5 rounded-full border border-primary-white/40 text-primary-white font-montserrat font-semibold text-sm hover:bg-primary-white hover:text-primary-black transition duration-300 cursor-pointer'

export default function AccountButton() {
    const navigate = useNavigate()
    const { isLoading, isSignedIn, user, logout } = useAuth()

    if (isLoading)
        return null

    if (!isSignedIn)
        return (
            <button type='button' onClick={() => navigate('/login')} className={buttonClass}>
                Sign in
            </button>
        )

    return (
        <div className='flex items-center gap-3'>
            {user && (
                <span className='hidden sm:inline text-primary-white/80 font-inter text-sm'>
                    {user.user_username ? `@${user.user_username}` : `${user.user_first_name} ${user.user_last_name}`}
                </span>
            )}
            <button type='button' onClick={logout} className={buttonClass}>
                Sign out
            </button>
        </div>
    )
}
