# Notification & Error Handling System Implementation

## Overview
Centralized notification and error handling system using Reapop integrated across the Mawiid frontend. Provides consistent feedback for authentication, meetings, media permissions, WebSockets, LiveKit events, and runtime errors.

## Architecture

- **`notificationConfig.js`**: Reapop setup with top-right position, dismissible defaults, and duration presets (`short`: 3s, `default`: 4.5s, `long`: 8s, `persistent`: 0).
- **`notificationMessages.js`**: Error normalization mapping HTTP codes (400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504), domain error codes, media device errors, and titles.
- **`notificationTheme.js`**: Custom Mawiid glassmorphic theme matching `#121216`, with blur, rounded borders, Montserrat/Inter typography, and status-colored left border accents.
- **`notificationUtils.js`**: Notification ID generator, debounce deduplication cache to prevent toast spam, and payload normalizer.
- **`notificationService.js`**: Unified `notify` object (`success`, `error`, `warning`, `info`, `loading`, `none`, `dismiss`, `dismissAll`, `update`, `promise`) and `useNotify` hook. Supports both React and non-React contexts with action queueing before provider registration.
- **`NotificationProvider.jsx`**: Top-level provider hosting Reapop provider, dispatcher bridge, online/offline state listeners.
- **`NotificationSystem.jsx`**: Renders Reapop's NotificationsSystem with `SlideTransition` and `mawiidTheme`.
- **`NotificationErrorBoundary.jsx`**: React Error Boundary catching render failures, dispatching error notification, and displaying friendly fallback UI with retry/home options.
- **`logger.js`**: Development-safe logging utility with sensitive field masking (passwords, tokens).

## Integrated Modules

1. **Root Application (`frontend.tsx`)**: Wrapped in `NotificationErrorBoundary` and `NotificationProvider`.
2. **API Client (`api.js`)**: Error normalization using `resolveErrorMessage`, network failure logging without credential leakage.
3. **Authentication Flows**:
   - `accountButton.jsx`: Sign-in success, registration verification link prompt, sign-out feedback, password reset email confirmation, verification resend feedback.
   - `verify-email.jsx`: Success notification on verification; error notification on invalid link.
   - `reset-password.jsx`: Success notification on password update; error notification on invalid/expired link.
   - `requireAuth.jsx`: Notification on unauthenticated redirect.
4. **Meetings & Room (`meetRoomPage.jsx`, `useRoom.js`, `MeetControls.jsx`)**:
   - Room ID copy to clipboard feedback.
   - Lobby knocking participant alert.
   - Moderation actions (muted by moderator, asked to unmute, role changes, promote/demote/kick).
   - Participant join and leave announcements.
   - Connection interruption and reconnecting / reconnected state updates.
   - Camera and microphone access warnings.
5. **Pre-meeting (`welcomingPage.jsx`, `landingPage.jsx`)**:
   - `notify.promise` during room creation (loading → success / error).
   - Media permission failure notifications.
   - Missing room code warning.
6. **Network Connectivity**:
   - Offline detection: single persistent warning toast.
   - Online recovery: updates toast to success and auto-dismisses after 3 seconds.

## How to Test

1. Run unit test suite:
   ```bash
   cd frontend && bun test
   ```
2. Run build verification:
   ```bash
   cd frontend && bun run build
   ```
3. Test manual interactions:
   - Copy meeting ID in room controls -> verify green success toast appears.
   - Disconnect network in browser dev tools -> verify single connection warning toast appears; reconnect -> verify update to green "Back online" toast.
   - Create room -> verify loading toast smoothly transitions to success.

