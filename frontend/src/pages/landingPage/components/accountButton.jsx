import { useState, useEffect, useRef } from 'react'
import { ApiError, auth, errorMessage } from '../../../services/api'
import { useAuth } from '../../../hooks/useAuth'

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

const browser_language = () => (navigator.language || 'en').split('-')[0]

const validate_register = (form) => {
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

const button_class = 'w-full border border-[#FFFFFF4D] bg-primary-white hover:bg-primary-white/80 hover:scale-105 cursor-pointer px-5 sm:px-8 py-3 rounded-full flex justify-center items-center gap-2 sm:gap-[11px] transition-all duration-200'
const input_class = 'w-full h-[48px] rounded-[12px] border border-primary-white/70 bg-transparent px-4 text-primary-white font-montserrat text-sm sm:text-base tracking-wider outline-none placeholder:text-primary-white/40 focus:border-primary-blue_accent transition-colors aria-[invalid=true]:border-red-400'
const primary_button_class = 'w-full h-[48px] rounded-full bg-primary-blue_accent hover:bg-primary-blue_accent/80 text-primary-white font-montserrat font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer disabled:bg-secondary-dark_gray disabled:text-[#A4A4A4] disabled:cursor-not-allowed'
const link_button_class = 'font-inter text-xs text-primary-white/70 hover:text-primary-white underline-offset-4 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:no-underline disabled:text-primary-white/30'
const tab_class = (active) => `flex-1 h-[36px] rounded-full font-montserrat font-semibold text-xs transition-colors cursor-pointer ${active ? 'bg-primary-white text-primary-black' : 'text-primary-white/70 hover:text-primary-white'}`

function Field({ label, error, ...props }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-primary-white/80 font-inter text-xs'>{label}</span>
      <input aria-invalid={Boolean(error)} className={input_class} {...props} />
      {error && <span className='text-red-400 text-xs font-inter'>{error}</span>}
    </label>
  )
}

function VerifyEmailStep({ email, on_back, on_signin }) {
  const [busy, set_busy] = useState(false)
  const [message, set_message] = useState('')
  const [error, set_error] = useState('')

  const handle_resend = async () => {
    set_busy(true)
    set_error('')
    set_message('')
    try {
      const result = await auth.resendEmail(email)
      set_message(result?.message || 'Verification email sent. Check your inbox.')
    } catch (err) {
      set_error(errorMessage(err))
    } finally {
      set_busy(false)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl'>Check your email</h2>
        <p className='text-primary-white/70 font-inter text-xs sm:text-sm leading-relaxed'>
          We sent a verification link to <span className='text-primary-white font-medium'>{email}</span>. Click the link to activate your account, then sign in.
        </p>
      </div>

      <button type='button' onClick={handle_resend} disabled={busy} className={primary_button_class}>
        {busy ? 'Sending…' : 'Resend verification email'}
      </button>

      <button type='button' onClick={on_signin} className={`${link_button_class} self-start`}>
        Already verified? Sign in
      </button>

      <button type='button' onClick={on_back} className={`${link_button_class} self-start`}>
        ← Back
      </button>

      {message && <p className='text-green-400 text-xs font-inter'>{message}</p>}
      {error && <p role='alert' className='text-red-400 text-xs font-inter'>{error}</p>}
    </div>
  )
}

function ForgotPasswordStep({ on_back }) {
  const [email, set_email] = useState('')
  const [busy, set_busy] = useState(false)
  const [message, set_message] = useState('')
  const [error, set_error] = useState('')

  const handle_submit = async (e) => {
    e.preventDefault()
    if (!EMAIL_PATTERN.test(email.trim())) {
      set_error('Enter a valid email address.')
      return
    }
    set_busy(true)
    set_error('')
    set_message('')
    try {
      const result = await auth.forgotPassword(email.trim())
      set_message(result?.message || 'If your account is eligible, a reset link will arrive shortly.')
    } catch (err) {
      set_error(errorMessage(err))
    } finally {
      set_busy(false)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl'>Reset password</h2>
        <p className='text-primary-white/70 font-inter text-xs sm:text-sm leading-relaxed'>
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      <form className='flex flex-col gap-3' onSubmit={handle_submit} noValidate>
        <Field
          label='Email'
          type='email'
          autoComplete='email'
          autoCapitalize='none'
          spellCheck={false}
          autoFocus
          maxLength={254}
          value={email}
          onChange={(e) => {
            set_email(e.target.value)
            set_error('')
            set_message('')
          }}
        />
        <button type='submit' disabled={busy || !email.trim()} className={primary_button_class}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <button type='button' onClick={on_back} className={`${link_button_class} self-start`}>
        ← Back to sign in
      </button>

      {message && <p className='text-green-400 text-xs font-inter'>{message}</p>}
      {error && <p role='alert' className='text-red-400 text-xs font-inter'>{error}</p>}
    </div>
  )
}

export default function AccountButton() {
  const { isLoading, isSignedIn, user, logout } = useAuth()
  const [open, set_open] = useState(false)
  const [step, set_step] = useState('signin')
  const [identifier, set_identifier] = useState('')
  const [password, set_password] = useState('')
  const [register, set_register] = useState(EMPTY_REGISTER)
  const [field_errors, set_field_errors] = useState({})
  const [error, set_error] = useState('')
  const [busy, set_busy] = useState(false)
  const [verify_email, set_verify_email] = useState('')
  const panel_ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handle_escape = (e) => {
      if (e.key === 'Escape')
        set_open(false)
    }
    document.addEventListener('keydown', handle_escape)
    return () => document.removeEventListener('keydown', handle_escape)
  }, [open])

  useEffect(() => {
    if (isSignedIn && open)
      set_open(false)
  }, [isSignedIn, open])

  if (isLoading)
    return null

  if (isSignedIn)
    return (
      <div className='flex items-center gap-3'>
        {user && (
          <span className='hidden sm:inline text-primary-white/80 font-inter text-sm'>
            {user.user_username ? `@${user.user_username}` : `${user.user_first_name} ${user.user_last_name}`}
          </span>
        )}
        <button type='button' onClick={logout} className={button_class}>
          Sign out
        </button>
      </div>
    )

  const reset = () => {
    set_error('')
    set_field_errors({})
    set_password('')
  }

  const go_to = (next_step) => {
    set_step(next_step)
    reset()
  }

  const toggle_open = () => {
    if (!open) {
      set_step('signin')
      set_identifier('')
      set_password('')
      set_register(EMPTY_REGISTER)
      set_verify_email('')
      reset()
    }
    set_open(!open)
  }

  const run = async (action) => {
    set_busy(true)
    set_error('')
    try {
      await action()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email-not-verified') {
        const email_hint = identifier.includes('@') ? identifier.trim() : ''
        set_verify_email(email_hint)
        set_step('verify')
        return
      }
      const field = err instanceof ApiError && FIELD_FOR_ERROR[err.code]
      if (field)
        set_field_errors((prev) => ({ ...prev, [field]: errorMessage(err) }))
      else
        set_error(errorMessage(err))
    } finally {
      set_busy(false)
    }
  }

  const update_register = (key) => (event) => {
    set_register((form) => ({ ...form, [key]: event.target.value }))
    set_field_errors((prev) => ({ ...prev, [key]: undefined }))
    set_error('')
  }

  const handle_signin_submit = (event) => {
    event.preventDefault()
    if (identifier.trim().length < 3 || password.length < PASSWORD_MIN) {
      set_error(errorMessage(new ApiError('invalid-credentials', 401)))
      return
    }
    run(async () => {
      await auth.login(identifier.trim(), password)
    })
  }

  const handle_register_submit = (event) => {
    event.preventDefault()
    const errors = validate_register(register)
    set_field_errors(errors)
    if (Object.keys(errors).length)
      return
    run(async () => {
      await auth.register({
        user_username: register.username,
        user_email: register.email.trim(),
        user_password: register.password,
        user_first_name: register.firstName.trim(),
        user_last_name: register.lastName.trim(),
        user_language: browser_language(),
      })
      set_verify_email(register.email.trim())
      set_step('verify')
    })
  }

  const titles = {
    signin: ['Sign in', 'Use your username or email.'],
    register: ['Create account', 'Choose a username and password.'],
  }

  return (
    <div className='relative' ref={panel_ref}>
      <button type='button' onClick={toggle_open} className={button_class}>
        <span className='text-primary-black font-montserrat font-bold text-base sm:text-lg lg:text-[20px] whitespace-nowrap flex items-center gap-2'>
          Sign in
        </span>
      </button>

      {open && (
        <>
          <div className='fixed inset-0 bg-black/50 backdrop-blur-sm z-40' onClick={() => set_open(false)} />
          <div className='fixed inset-0 z-50 flex items-center justify-center px-4'>
            <div className='relative w-full max-w-[420px] max-h-[90vh] overflow-y-auto flex flex-col gap-5 rounded-[20px] bg-primary-black border border-white/15 p-6 sm:p-8 shadow-2xl'>
              <button
                type='button'
                onClick={() => set_open(false)}
                className='absolute top-4 right-4 text-primary-white/50 hover:text-primary-white transition-colors cursor-pointer z-10'
              >
                <svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                  <line x1='18' y1='6' x2='6' y2='18' />
                  <line x1='6' y1='6' x2='18' y2='18' />
                </svg>
              </button>

              {step === 'verify' && (
                <VerifyEmailStep
                  email={verify_email}
                  on_back={() => go_to('register')}
                  on_signin={() => go_to('signin')}
                />
              )}

              {step === 'forgot' && (
                <ForgotPasswordStep on_back={() => go_to('signin')} />
              )}

              {(step === 'signin' || step === 'register') && (
                <>
                  <div role='tablist' className='flex gap-1 rounded-full border border-white/10 p-1'>
                    <button type='button' role='tab' aria-selected={step === 'signin'} disabled={busy} onClick={() => go_to('signin')} className={tab_class(step === 'signin')}>
                      Sign in
                    </button>
                    <button type='button' role='tab' aria-selected={step === 'register'} disabled={busy} onClick={() => go_to('register')} className={tab_class(step === 'register')}>
                      Sign up
                    </button>
                  </div>

                  <div className='flex flex-col gap-1'>
                    <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl'>{titles[step][0]}</h2>
                    <p className='text-primary-white/70 font-inter text-xs sm:text-sm leading-relaxed'>{titles[step][1]}</p>
                  </div>

                  {step === 'signin' && (
                    <form className='flex flex-col gap-3' onSubmit={handle_signin_submit} noValidate>
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
                          set_identifier(e.target.value)
                          set_error('')
                        }}
                      />
                      <Field
                        label='Password'
                        type='password'
                        autoComplete='current-password'
                        maxLength={PASSWORD_MAX}
                        value={password}
                        onChange={(e) => {
                          set_password(e.target.value)
                          set_error('')
                        }}
                      />
                      <button type='submit' disabled={busy || !identifier.trim() || !password} className={primary_button_class}>
                        {busy ? 'Signing in…' : 'Sign in'}
                      </button>
                      <div className='flex justify-between'>
                        <button type='button' onClick={() => go_to('register')} disabled={busy} className={link_button_class}>
                          No account yet? Create one
                        </button>
                        <button type='button' onClick={() => go_to('forgot')} disabled={busy} className={link_button_class}>
                          Forgot password?
                        </button>
                      </div>
                    </form>
                  )}

                  {step === 'register' && (
                    <form className='flex flex-col gap-3' onSubmit={handle_register_submit} noValidate>
                      <div className='grid grid-cols-2 gap-3'>
                        <Field label='First name' type='text' autoComplete='given-name' autoFocus maxLength={64} value={register.firstName} onChange={update_register('firstName')} error={field_errors.firstName} />
                        <Field label='Last name' type='text' autoComplete='family-name' maxLength={64} value={register.lastName} onChange={update_register('lastName')} error={field_errors.lastName} />
                      </div>
                      <Field label='Username' type='text' autoComplete='username' autoCapitalize='none' spellCheck={false} maxLength={32} value={register.username} onChange={update_register('username')} error={field_errors.username} />
                      <Field label='Email' type='email' autoComplete='email' autoCapitalize='none' spellCheck={false} maxLength={254} value={register.email} onChange={update_register('email')} error={field_errors.email} />
                      <Field label='Password' type='password' autoComplete='new-password' maxLength={PASSWORD_MAX} value={register.password} onChange={update_register('password')} error={field_errors.password} />
                      <Field label='Confirm password' type='password' autoComplete='new-password' maxLength={PASSWORD_MAX} value={register.confirm} onChange={update_register('confirm')} error={field_errors.confirm} />
                      <button type='submit' disabled={busy} className={primary_button_class}>
                        {busy ? 'Creating…' : 'Create account'}
                      </button>
                      <button type='button' onClick={() => go_to('signin')} disabled={busy} className={`${link_button_class} self-start`}>
                        Already have an account? Sign in
                      </button>
                    </form>
                  )}

                  {error && <p role='alert' className='text-red-400 text-xs font-inter'>{error}</p>}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
