import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, auth, errorMessage } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { AuthLoading } from '../../components/requireAuth'

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

const browserLanguage = () => (navigator.language || 'en').split('-')[0]

// Mirrors the backend rules (src/module/main/auth/auth.dto.ts) so most mistakes
// are caught before a request; the backend still validates everything.
const validateRegister = (form) => {
    const errors = {}
    if (!form.firstName.trim())
        errors.firstName = 'Enter your first name.'
    if (!form.lastName.trim())
        errors.lastName = 'Enter your last name.'
    if (!USERNAME_PATTERN.test(form.username))
        errors.username = '3 to 32 characters: letters, numbers and underscores.'
    if (!EMAIL_PATTERN.test(form.email.trim()) || form.email.trim().length > 254)
        errors.email = 'Enter a valid email address.'
    if (form.password.length < PASSWORD_MIN || form.password.length > PASSWORD_MAX)
        errors.password = `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`
    if (form.confirm !== form.password)
        errors.confirm = 'The passwords do not match.'
    return errors
}

const FIELD_FOR_ERROR = {
    'user-username-exist': 'username',
    'user-email-exist': 'email',
}

const EMPTY_REGISTER = { firstName: '', lastName: '', username: '', email: '', password: '', confirm: '' }

const inputClass = 'w-full h-[55px] rounded-[15px] border border-primary-white/70 bg-transparent px-5 text-primary-white font-montserrat text-base sm:text-[17px] tracking-wider outline-none placeholder:text-primary-white/40 focus:border-primary-blue_accent transition-colors aria-[invalid=true]:border-red-400'
const primaryButtonClass = 'w-full h-[55px] rounded-full bg-primary-blue_accent hover:bg-primary-blue_accent/80 text-primary-white font-montserrat font-bold text-base sm:text-lg transition-all duration-200 cursor-pointer disabled:bg-secondary-dark_gray disabled:text-[#A4A4A4] disabled:cursor-not-allowed'
const linkButtonClass = 'font-inter text-sm text-primary-white/70 hover:text-primary-white underline-offset-4 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:no-underline disabled:text-primary-white/30'
const tabClass = (active) => `flex-1 h-[40px] rounded-full font-montserrat font-semibold text-sm transition-colors cursor-pointer ${active ? 'bg-primary-white text-primary-black' : 'text-primary-white/70 hover:text-primary-white'}`

function Field({ label, error, ...props }) {
    return (
        <label className='flex flex-col gap-2'>
            <span className='text-primary-white/80 font-inter text-sm'>{label}</span>
            <input aria-invalid={Boolean(error)} className={inputClass} {...props} />
            {error && <span className='text-red-400 text-xs font-inter'>{error}</span>}
        </label>
    )
}

export default function LoginPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const { isLoading, isSignedIn } = useAuth()
    const from = location.state?.from

    const [step, setStep] = useState('signin')
    const [identifier, setIdentifier] = useState('')
    const [password, setPassword] = useState('')
    const [register, setRegister] = useState(EMPTY_REGISTER)
    const [fieldErrors, setFieldErrors] = useState({})
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    if (isLoading)
        return <AuthLoading />
    if (isSignedIn && !busy)
        return <Navigate to={from ? `${from.pathname}${from.search || ''}` : '/'} replace state={from?.state} />

    const run = async (action) => {
        setBusy(true)
        setError('')
        try {
            await action()
        } catch (err) {
            const field = err instanceof ApiError && FIELD_FOR_ERROR[err.code]
            if (field)
                setFieldErrors((errors) => ({ ...errors, [field]: errorMessage(err) }))
            else
                setError(errorMessage(err))
        } finally {
            setBusy(false)
        }
    }

    const finish = () => {
        navigate(from ? `${from.pathname}${from.search || ''}` : '/', { replace: true, state: from?.state })
    }

    const goTo = (nextStep) => {
        setStep(nextStep)
        setError('')
        setFieldErrors({})
        setPassword('')
    }

    const updateRegister = (key) => (event) => {
        setRegister((form) => ({ ...form, [key]: event.target.value }))
        setFieldErrors((errors) => ({ ...errors, [key]: undefined }))
        setError('')
    }

    const handleSignInSubmit = (event) => {
        event.preventDefault()
        if (identifier.trim().length < 3 || password.length < PASSWORD_MIN) {
            setError(errorMessage(new ApiError('invalid-credentials', 401)))
            return
        }
        run(async () => {
            await auth.login(identifier.trim(), password)
            finish()
        })
    }

    const handleRegisterSubmit = (event) => {
        event.preventDefault()
        const errors = validateRegister(register)
        setFieldErrors(errors)
        if (Object.keys(errors).length)
            return
        run(async () => {
            await auth.register({
                user_username: register.username,
                user_email: register.email.trim(),
                user_password: register.password,
                user_first_name: register.firstName.trim(),
                user_last_name: register.lastName.trim(),
                user_language: browserLanguage(),
            })
            finish()
        })
    }

    const titles = {
        'signin': ['Sign in to Mawiid', 'Use your username or email and your password.'],
        'register': ['Create your account', 'Choose a username and a password to get started.'],
    }
    const [title, subtitle] = titles[step]

    return (
        <div className='relative min-h-screen w-full flex flex-col bg-primary-black items-center justify-center px-4 py-12 overflow-x-hidden'>
            <h1 className='absolute top-2 sm:top-6 lg:top-8 w-full text-center text-5xl sm:text-7xl md:text-[110px] lg:text-[160px] font-bold text-white/20 select-none pointer-events-none leading-none tracking-wider font-montserrat'>
                MAWIID
            </h1>
            <div className='relative z-10 w-full max-w-[440px] mt-16 sm:mt-24 flex flex-col gap-6 rounded-[20px] bg-overlay-white_10 border border-white/10 p-6 sm:p-10'>
                <div role='tablist' className='flex gap-1 rounded-full border border-white/10 p-1'>
                    <button type='button' role='tab' aria-selected={step === 'signin'} disabled={busy} onClick={() => goTo('signin')} className={tabClass(step === 'signin')}>
                        Sign in
                    </button>
                    <button type='button' role='tab' aria-selected={step === 'register'} disabled={busy} onClick={() => goTo('register')} className={tabClass(step === 'register')}>
                        Sign up
                    </button>
                </div>

                <div className='flex flex-col gap-2'>
                    <h2 className='text-primary-white font-montserrat font-bold text-2xl sm:text-3xl'>{title}</h2>
                    <p className='text-primary-white/70 font-inter text-sm sm:text-base leading-relaxed'>{subtitle}</p>
                </div>

                {step === 'signin' && (
                    <form className='flex flex-col gap-4' onSubmit={handleSignInSubmit} noValidate>
                        <Field
                            label='Username or email'
                            type='text'
                            autoComplete='username'
                            autoCapitalize='none'
                            spellCheck={false}
                            autoFocus
                            maxLength={254}
                            value={identifier}
                            onChange={(e) => {
                                setIdentifier(e.target.value)
                                setError('')
                            }}
                        />
                        <Field
                            label='Password'
                            type='password'
                            autoComplete='current-password'
                            maxLength={PASSWORD_MAX}
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value)
                                setError('')
                            }}
                        />
                        <button type='submit' disabled={busy || !identifier.trim() || !password} className={primaryButtonClass}>
                            {busy ? 'Signing in…' : 'Sign in'}
                        </button>
                        <button type='button' onClick={() => goTo('register')} disabled={busy} className={`${linkButtonClass} self-start`}>
                            No account yet? Create one
                        </button>
                    </form>
                )}

                {step === 'register' && (
                    <form className='flex flex-col gap-4' onSubmit={handleRegisterSubmit} noValidate>
                        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                            <Field label='First name' type='text' autoComplete='given-name' autoFocus maxLength={64} value={register.firstName} onChange={updateRegister('firstName')} error={fieldErrors.firstName} />
                            <Field label='Last name' type='text' autoComplete='family-name' maxLength={64} value={register.lastName} onChange={updateRegister('lastName')} error={fieldErrors.lastName} />
                        </div>
                        <Field label='Username' type='text' autoComplete='username' autoCapitalize='none' spellCheck={false} maxLength={32} value={register.username} onChange={updateRegister('username')} error={fieldErrors.username} />
                        <Field label='Email' type='email' autoComplete='email' autoCapitalize='none' spellCheck={false} maxLength={254} value={register.email} onChange={updateRegister('email')} error={fieldErrors.email} />
                        <Field label='Password' type='password' autoComplete='new-password' maxLength={PASSWORD_MAX} value={register.password} onChange={updateRegister('password')} error={fieldErrors.password} />
                        <Field label='Confirm password' type='password' autoComplete='new-password' maxLength={PASSWORD_MAX} value={register.confirm} onChange={updateRegister('confirm')} error={fieldErrors.confirm} />
                        <button type='submit' disabled={busy} className={primaryButtonClass}>
                            {busy ? 'Creating…' : 'Create account'}
                        </button>
                        <button type='button' onClick={() => goTo('signin')} disabled={busy} className={`${linkButtonClass} self-start`}>
                            Already have an account? Sign in
                        </button>
                    </form>
                )}

                {error && <p role='alert' className='text-red-400 text-sm font-inter'>{error}</p>}
            </div>
        </div>
    )
}
