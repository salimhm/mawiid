# Meet Room Stage Implementation

## Implemented

- Refreshed meeting stage layout matching the Figma two-person call design (`meet-room-refresh.css`, `MeetMain.jsx`, `ParticipantTile.jsx`).
- When a single user is in the room, displays the host panel alongside a styled waiting panel ("Waiting for guest" with pulsing dots animation and "INVITE SENT" badge).
- When two users are connected, displays the host panel (`#878c25` olive gradient with user name badge and live indicator) and guest panel (`#43170f` mahogany gradient) side by side on desktop, stacked vertically on mobile.
- When three or more participants join, switches to a responsive auto-fit grid.
- Video streams attach to the tile `<video>` tag when the camera is active. When camera is off, displays initialed radial avatar circle with camera status label.
- Participant tile footer displays live microphone status dot, speaking indicator, muted icon badge, and hand raised badge.
- Re-architected `MeetControls.jsx` into three equal-width sections:
  1. Left section: Meeting ID with copy icon, truncating long UUIDs/identifiers with ellipsis (`...`) responsive to available space (`max-w-[55px]` on small mobile up to full length on desktop), with fallback clipboard copying (`document.execCommand`) for non-HTTPS/insecure contexts.
  2. Center section: Frosted-glass dock container powered by `GlassSurface` (`backgroundOpacity={0.16}`, `blur={14}`, `brightness={45}`) housing three grouped components with adaptive scaling across breakpoints:
     - Left pill (`bg-[#444446]/90`): Microphone, camera, and translation language buttons (scaled from 17px icons on mobile to 22px on desktop).
     - Center pill (`bg-[#444446]/90`): Screen share and raise hand buttons (scaled from 17px icons on mobile to 22px on desktop).
     - Right pill (`bg-[#ea2d24]`): Red end-call button with rotated hangup receiver.
  3. Right section: Fullscreen toggle button wrapped in a matching circular `GlassSurface` component aligned consistently on the far right.
  4. Responsive grid: Uses `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]` on mobile/tablet to center the dock without clipping or horizontal overflow, and `md:grid-cols-3` on desktop.
  5. Mobile optimizations: Added iOS safe-area bottom insets (`env(safe-area-inset-bottom)`), dedicated touch target bounds (minimum 28px–32px buttons), centered mobile copy toast, and constrained dropdown menus (`max-h-[50vh]`) to prevent offscreen overflow on small devices.
- Maintained all existing room hooks, LiveKit event handlers, header, control footer, translations, captions, moderation actions, and chat integration without breaking changes.

## How to Test

1. Navigate to an active meeting room `/meet/:roomCode` with one user.
2. Verify the host card is rendered on the left and the dashed "Waiting for guest" card on the right with the pulsing loader animation.
3. Join with a second participant from another browser window or tab.
4. Verify both participants appear side by side with the updated color palette, name badges, and connection indicators.
5. Toggle camera and microphone on each participant to verify live video streams and audio indicators toggle accurately.
6. Verify layout responsiveness on mobile viewports (< 760px).

