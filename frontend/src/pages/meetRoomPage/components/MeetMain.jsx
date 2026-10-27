import ParticipantTile from './ParticipantTile'

export default function MeetMain({ localUser = {}, participants = [], fullScreen = false })
{
    const allUsers = [localUser, ...participants]
    const count = Math.max(allUsers.length, 1)
    const columns = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / columns)

    const isSingleUser = count === 1
    const isTwoUsers = count === 2

    return (
        <main className={fullScreen ? 'flex-1 h-screen bg-black py-4 sm:py-8 lg:py-16 px-2 sm:px-6 lg:px-8 mt-0 min-h-0' : 'flex-1 bg-black py-2 sm:py-4 px-2 sm:px-6 md:px-12 lg:px-20 mt-1 sm:mt-4 min-h-0'}>
            <div
                className={`grid h-full w-full gap-2 sm:gap-4 ${
                    isSingleUser
                        ? 'grid-cols-1 grid-rows-1'
                        : isTwoUsers
                        ? 'grid-cols-1 sm:grid-cols-2'
                        : `grid-cols-1 sm:grid-cols-2 lg:grid-cols-${columns}`
                }`}
                style={
                    !isSingleUser && !isTwoUsers
                        ? {
                              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                          }
                        : undefined
                }
            >
                {allUsers.map((user, i) => (
                    <ParticipantTile
                        key={user.id || i}
                        id={user.id || 'local'}
                        name={user.name || 'Guest'}
                        stream={user.stream || null}
                        isCamOn={user.isCamOn || false}
                        isMicOn={user.isMicOn || false}
                        handRaised={user.handRaised || false}
                    />
                ))}
            </div>
        </main>
    )
}
