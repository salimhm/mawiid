import { Component } from 'react'
import { notify, logger } from '../../services/notifications'

export default class NotificationErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { has_error: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { has_error: true, error }
  }

  componentDidCatch(error, error_info) {
    logger.error('ErrorBoundary', 'Caught unhandled component error', error, error_info)
    notify.error('An unexpected interface error occurred. You can reload or return home.', {
      title: 'Application error',
      dedupKey: 'error-boundary-caught',
    })
  }

  handle_retry = () => {
    this.setState({ has_error: false, error: null })
  }

  handle_home = () => {
    window.location.href = '/'
  }

  render() {
    if (this.state.has_error) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className='min-h-screen w-full flex flex-col items-center justify-center bg-primary-black px-4 text-center'>
          <div className='w-full max-w-[460px] flex flex-col items-center gap-5 rounded-[24px] bg-overlay-white_10 border border-white/10 p-8 shadow-2xl backdrop-blur-xl'>
            <div className='w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center text-red-400'>
              <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'>
                <circle cx='12' cy='12' r='10' />
                <line x1='12' y1='8' x2='12' y2='12' />
                <line x1='12' y1='16' x2='12.01' y2='16' />
              </svg>
            </div>
            <h2 className='text-primary-white font-montserrat font-bold text-2xl'>Something went wrong</h2>
            <p className='text-primary-white/70 font-inter text-sm leading-relaxed'>
              An unexpected error occurred while loading this view. You can try refreshing the section or return to the main page.
            </p>
            <div className='flex flex-col sm:flex-row gap-3 w-full mt-2'>
              <button
                type='button'
                onClick={this.handle_retry}
                className='flex-1 h-[46px] rounded-full border border-white/20 bg-transparent hover:bg-white/10 text-primary-white font-montserrat font-semibold text-sm transition-all duration-200 cursor-pointer'
              >
                Try again
              </button>
              <button
                type='button'
                onClick={this.handle_home}
                className='flex-1 h-[46px] rounded-full bg-primary-blue_accent hover:bg-primary-blue_accent/80 text-primary-white font-montserrat font-semibold text-sm transition-all duration-200 cursor-pointer shadow-lg'
              >
                Go to home
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

