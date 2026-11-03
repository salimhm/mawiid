import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ApiError, auth, errorMessage } from '../../services/api'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

const input_class = 'w-full h-[48px] rounded-[12px] border border-primary-white/70 bg-transparent px-4 text-primary-white font-montserrat text-sm sm:text-base tracking-wider outline-none placeholder:text-primary-white/40 focus:border-primary-blue_accent transition-colors aria-[invalid=true]:border-red-400'
const primary_button_class = 'w-full h-[48px] rounded-full bg-primary-blue_accent hover:bg-primary-blue_accent/80 text-primary-white font-montserrat font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer disabled:bg-secondary-dark_gray disabled:text-[#A4A4A4] disabled:cursor-not-allowed'

function Field({ label, error, ...props }) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-primary-white/80 font-inter text-xs'>{label}</span>
      <input aria-invalid={Boolean(error)} className={input_class} {...props} />
      {error && <span className='text-red-400 text-xs font-inter'>{error}</span>}
    </label>
  )
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : '') || ''
  const [password, set_password] = useState('')
  const [confirm, set_confirm] = useState('')
  const [busy, set_busy] = useState(false)
  const [status, set_status] = useState(token ? 'form' : 'error')
  const [error, set_error] = useState(token ? '' : 'This reset link is invalid.')
  const [field_errors, set_field_errors] = useState({})

  const handle_submit = async (e) => {
    e.preventDefault()
    const errors = {}
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
      errors.password = `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`
    if (confirm !== password)
      errors.confirm = 'The passwords do not match.'
    set_field_errors(errors)
    if (Object.keys(errors).length) return

    set_busy(true)
    set_error('')
    try {
      await auth.resetPassword(token, password)
      set_status('success')
    } catch (err) {
      set_error(errorMessage(err))
      if (err instanceof ApiError && err.status === 401)
        set_status('error')
    } finally {
      set_busy(false)
    }
  }

  return (
    <div className='min-h-screen w-full flex flex-col items-center justify-center bg-primary-black px-4'>
      <div className='w-full max-w-[420px] flex flex-col gap-5 rounded-[20px] bg-overlay-white_10 border border-white/10 p-6 sm:p-8'>
        {status === 'form' && (
          <>
            <div className='flex flex-col gap-1'>
              <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl'>New password</h2>
              <p className='text-primary-white/70 font-inter text-xs sm:text-sm leading-relaxed'>Choose a new password for your account.</p>
            </div>
            <form className='flex flex-col gap-3' onSubmit={handle_submit} noValidate>
              <Field
                label='New password'
                type='password'
                autoComplete='new-password'
                autoFocus
                maxLength={PASSWORD_MAX}
                value={password}
                onChange={(e) => {
                  set_password(e.target.value)
                  set_field_errors((prev) => ({ ...prev, password: undefined }))
                  set_error('')
                }}
                error={field_errors.password}
              />
              <Field
                label='Confirm password'
                type='password'
                autoComplete='new-password'
                maxLength={PASSWORD_MAX}
                value={confirm}
                onChange={(e) => {
                  set_confirm(e.target.value)
                  set_field_errors((prev) => ({ ...prev, confirm: undefined }))
                  set_error('')
                }}
                error={field_errors.confirm}
              />
              <button type='submit' disabled={busy || !password || !confirm} className={primary_button_class}>
                {busy ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
            {error && <p role='alert' className='text-red-400 text-xs font-inter'>{error}</p>}
          </>
        )}

        {status === 'success' && (
          <div className='flex flex-col items-center gap-4'>
            <div className='w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center'>
              <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='#22c55e' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
                <polyline points='20 6 9 17 4 12' />
              </svg>
            </div>
            <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl text-center'>Password reset</h2>
            <p className='text-primary-white/70 font-inter text-sm text-center'>Your password has been updated. You can now sign in.</p>
            <button
              type='button'
              onClick={() => navigate('/', { replace: true })}
              className={primary_button_class}
            >
              Go to home
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className='flex flex-col items-center gap-4'>
            <div className='w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center'>
              <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='#ef4444' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
                <line x1='18' y1='6' x2='6' y2='18' />
                <line x1='6' y1='6' x2='18' y2='18' />
              </svg>
            </div>
            <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl text-center'>Link expired</h2>
            <p className='text-red-400 font-inter text-sm text-center'>{error}</p>
            <button
              type='button'
              onClick={() => navigate('/', { replace: true })}
              className={primary_button_class}
            >
              Go to home
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

