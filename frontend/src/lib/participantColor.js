// One color per participant, the same everywhere: their video tile's gradient and their
// name in the captions. No two people in the room ever share a color.
//
// Colors are made from a hue, so there are as many as there are people. The first twelve
// hues are spread around the color wheel in an order where each new one is as far as
// possible from those already taken, so a small room never gets two look-alike colors.
// Values are CSS strings (inline styles), not Tailwind classes.

const SPREAD_HUES = [210, 30, 120, 300, 0, 170, 270, 60, 330, 150, 240, 90]
const GOLDEN_ANGLE = 137.508

function hueAndLightness(slot)
{
    if (slot < SPREAD_HUES.length)
        return { hue: SPREAD_HUES[slot], lightness: 58 }
    // More people than spread hues: keep stepping round the wheel by the golden angle, with
    // alternating lightness so neighbours still differ. Every slot gives a different color.
    const extra = slot - SPREAD_HUES.length
    return { hue: (15 + extra * GOLDEN_ANGLE) % 360, lightness: extra % 2 ? 48 : 66 }
}

export function colorForSlot(slot)
{
    const { hue, lightness } = hueAndLightness(slot)
    const h = hue.toFixed(1)
    return {
        background: `linear-gradient(to bottom right, hsl(${h} 80% ${lightness + 8}%), hsl(${h} 75% ${lightness - 12}%), hsl(${h} 70% 16%))`,
        // Lightness follows the tile's, so two names never match where two tiles differ.
        text: `hsl(${h} 90% ${lightness + 17}%)`,
    }
}

// Someone not (or no longer) in the room, e.g. a caption from a speaker who left: neutral,
// so they never look like someone who is still here.
export const NEUTRAL_COLOR = {
    background: 'linear-gradient(to bottom right, rgb(148 163 184), rgb(71 85 105), rgb(15 23 42))',
    text: 'rgb(203 213 225)',
}

export function participantColor()
{
    return NEUTRAL_COLOR
}

// Keeps everyone's color while they stay in the room. Call `assign(users)` with the people
// in the room; it returns id -> color.
// - Someone new takes the first free color, newcomers in the order they joined. A room seen
//   from the start therefore gets the same colors on every client.
// - Someone who leaves frees their color for the next newcomer; nobody else's color changes.
export function createColorAllocator()
{
    const slots = new Map() // id -> slot

    function assign(users = [])
    {
        const present = new Set(users.map((user) => user?.id).filter(Boolean))
        for (const id of slots.keys())
        {
            if (!present.has(id))
                slots.delete(id)
        }

        const newcomers = users
            .filter((user) => user?.id && !slots.has(user.id))
            .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const taken = new Set(slots.values())
        let next = 0
        for (const user of newcomers)
        {
            if (slots.has(user.id))
                continue
            while (taken.has(next))
                next++
            slots.set(user.id, next)
            taken.add(next)
        }

        const colors = new Map([...slots].map(([id, slot]) => [id, colorForSlot(slot)]))
        return (id) => colors.get(id) || NEUTRAL_COLOR
    }

    return { assign }
}
