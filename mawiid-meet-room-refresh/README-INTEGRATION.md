# Mawiid Meet Room – Figma refresh

This patch refreshes the existing two-person meeting stage while keeping the
current `MeetRoomPage`, `useRoom()` hook, LiveKit connection, header, footer
controls, chat, moderation, captions, reactions and route unchanged.

## Apply

From the repository root, copy the three files into the matching paths:

- `frontend/src/pages/meetRoomPage/components/MeetMain.jsx`
- `frontend/src/pages/meetRoomPage/components/ParticipantTile.jsx`
- `frontend/src/pages/meetRoomPage/components/meetRoomRefresh.css`

No dependencies or backend changes are required.

## Verify

```bash
cd frontend
bun install
bun dev
```

Open an authenticated `/meet/:roomCode` room. Check:
- one participant: host panel plus waiting-for-guest panel;
- two participants: host and guest panels side by side on desktop;
- mobile: panels stack vertically;
- three or more participants: responsive participant grid;
- camera/microphone states, hand raise, screen sharing and captions still work
  through the existing meeting controls and room hook.
