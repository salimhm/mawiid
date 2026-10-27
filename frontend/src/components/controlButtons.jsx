export default function ControlsButtons({
    buttons = [],
    containerClassName = '',
    buttonClassName = '',
}) {
    return (
        <div className={`flex items-center gap-3 sm:gap-6 px-2 py-1 rounded-3xl border border-white/15 bg-white/20 backdrop-blur-xl ${containerClassName}`}>
            {buttons.map(({ icon, onClick, label }, i) => (
                <button
                    key={i}
                    onClick={onClick}
                    aria-label={label}
                    title={label}
                    className={`text-white text-xl sm:text-2xl hover:scale-110 transition p-1.5 sm:p-2 rounded-3xl cursor-pointer ${buttonClassName}`}
                >
                    {icon}
                </button>
            ))}
        </div>
    )
}
