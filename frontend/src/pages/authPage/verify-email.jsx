import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { auth, errorMessage } from '../../services/api'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : '') || ''
  const [status, set_status] = useState('verifying')
  const [error, set_error] = useState('')
  const executed_ref = useRef(false)

  useEffect(() => {
    if (!token) {
      set_status('error')
      set_error('This verification link is invalid.')
      return
    }
    if (executed_ref.current)
      return
    executed_ref.current = true

    auth.verifyEmail(token)
      .then(() => {
        set_status('success')
      })
      .catch((err) => {
        set_status('error')
        set_error(errorMessage(err))
      })
  }, [token])

  return (
    <div className='min-h-screen w-full flex flex-col items-center justify-center bg-primary-black px-4'>
      <div className='w-full max-w-[420px] flex flex-col gap-5 rounded-[20px] bg-overlay-white_10 border border-white/10 p-6 sm:p-8'>
        {status === 'verifying' && (
          <div className='flex flex-col items-center gap-3'>
            <div className='w-8 h-8 border-2 border-primary-white/30 border-t-primary-blue_accent rounded-full animate-spin' />
            <p className='text-primary-white/70 font-inter text-sm'>Verifying your email…</p>
          </div>
        )}

        {status === 'success' && (
          <div className='flex flex-col items-center gap-4'>
            <div className='w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center'>
              <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='#22c55e' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
                <polyline points='20 6 9 17 4 12' />
              </svg>
            </div>
            <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl text-center'>Email verified</h2>
            <p className='text-primary-white/70 font-inter text-sm text-center'>Your account is ready. You can now sign in.</p>
            <button
              type='button'
              onClick={() => navigate('/', { replace: true })}
              className='w-full h-[48px] rounded-full bg-primary-blue_accent hover:bg-primary-blue_accent/80 text-primary-white font-montserrat font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer'
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
            <h2 className='text-primary-white font-montserrat font-bold text-xl sm:text-2xl text-center'>Verification failed</h2>
            <p className='text-red-400 font-inter text-sm text-center'>{error}</p>
            <button
              type='button'
              onClick={() => navigate('/', { replace: true })}
              className='w-full h-[48px] rounded-full bg-primary-blue_accent hover:bg-primary-blue_accent/80 text-primary-white font-montserrat font-bold text-sm sm:text-base transition-all duration-200 cursor-pointer'
            >
              Go to home
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
