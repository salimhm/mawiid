// One color per participant, the same everywhere: their video tile's gradient and their
// name in the captions.
// Full class names (not built from parts) so Tailwind keeps them in the build.
const COLORS = [
    { gradient: 'from-amber-400 via-amber-600 to-amber-900', text: 'text-amber-300' },
    { gradient: 'from-rose-400 via-rose-600 to-rose-900', text: 'text-rose-300' },
    { gradient: 'from-teal-400 via-teal-600 to-teal-900', text: 'text-teal-300' },
    { gradient: 'from-lime-400 via-lime-600 to-lime-900', text: 'text-lime-300' },
    { gradient: 'from-violet-400 via-violet-600 to-violet-900', text: 'text-violet-300' },
    { gradient: 'from-sky-400 via-sky-600 to-sky-900', text: 'text-sky-300' },
    { gradient: 'from-orange-400 via-orange-600 to-orange-900', text: 'text-orange-300' },
    { gradient: 'from-fuchsia-400 via-fuchsia-600 to-fuchsia-900', text: 'text-fuchsia-300' },
    { gradient: 'from-emerald-400 via-emerald-600 to-emerald-900', text: 'text-emerald-300' },
    { gradient: 'from-indigo-400 via-indigo-600 to-indigo-900', text: 'text-indigo-300' },
    { gradient: 'from-yellow-400 via-yellow-600 to-yellow-900', text: 'text-yellow-300' },
    { gradient: 'from-pink-400 via-pink-600 to-pink-900', text: 'text-pink-300' },
    { gradient: 'from-cyan-400 via-cyan-600 to-cyan-900', text: 'text-cyan-300' },
    { gradient: 'from-red-400 via-red-600 to-red-900', text: 'text-red-300' },
    { gradient: 'from-green-400 via-green-600 to-green-900', text: 'text-green-300' },
    { gradient: 'from-purple-400 via-purple-600 to-purple-900', text: 'text-purple-300' },
]

function preferredIndex(id = 'default')
{
    let hash = 0
    for (let i = 0; i < id.length; i++)
        hash = id.charCodeAt(i) + ((hash << 5) - hash)
    return Math.abs(hash) % COLORS.length
}

// Color of someone not (or no longer) in the room, e.g. a caption from a speaker who left.
export function participantColor(id = 'default')
{
    return COLORS[preferredIndex(id)]
}

// Gives everyone in the room a different color (up to COLORS.length people; after that
// colors repeat as little as possible). People are taken in the order they joined, so a
// newcomer never changes anyone's color, and every client computes the same result.
// Each person keeps the color picked from their identity when it is free, otherwise the
// next free one. Returns a function: id -> color.
export function assignParticipantColors(users = [])
{
    const ordered = [...users]
        .filter((user) => user?.id)
        .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const uses = new Array(COLORS.length).fill(0)
    const byId = new Map()

    for (const user of ordered)
    {
        if (byId.has(user.id))
            continue
        const fewest = Math.min(...uses)
        let index = preferredIndex(user.id)
        while (uses[index] !== fewest)
            index = (index + 1) % COLORS.length
        uses[index]++
        byId.set(user.id, COLORS[index])
    }

    return (id) => byId.get(id) || participantColor(id)
}
