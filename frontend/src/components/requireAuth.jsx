import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { notify } from '../services/notifications';

export function AuthLoading() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-primary-black">
      <p role="status" className="text-primary-white/60 font-inter text-sm">
        Loading…
      </p>
    </div>
  );
}

export default function RequireAuth({ children }) {
  const location = useLocation();
  const { isLoading, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoading && !isSignedIn) {
      notify.warning('Please sign in to continue to your meeting.', {
        dedupKey: 'require-auth-redirect',
      });
    }
  }, [isLoading, isSignedIn]);

  if (isLoading) return <AuthLoading />;
  if (!isSignedIn)
    return (
      <Navigate
        to="/"
        replace
        state={{
          from: {
            pathname: location.pathname,
            search: location.search,
            state: location.state,
          },
        }}
      />
    );
  return children;
}
