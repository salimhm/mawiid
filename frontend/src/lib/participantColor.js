// One color per participant, picked from their LiveKit identity, so the same person has the
// same color everywhere: their video tile's gradient and their name in the captions.
// Full class names (not built from parts) so Tailwind keeps them in the build.
const COLORS = [
    { gradient: 'from-amber-400 via-amber-600 to-amber-900', text: 'text-amber-300' },
    { gradient: 'from-rose-400 via-rose-600 to-rose-900', text: 'text-rose-300' },
    { gradient: 'from-teal-400 via-teal-600 to-teal-900', text: 'text-teal-300' },
    { gradient: 'from-lime-400 via-lime-600 to-lime-900', text: 'text-lime-300' },
    { gradient: 'from-violet-400 via-violet-600 to-violet-900', text: 'text-violet-300' },
    { gradient: 'from-sky-400 via-sky-600 to-sky-900', text: 'text-sky-300' },
]

export function participantColor(id = 'default')
{
    let hash = 0
    for (let i = 0; i < id.length; i++)
        hash = id.charCodeAt(i) + ((hash << 5) - hash)
    return COLORS[Math.abs(hash) % COLORS.length]
}
