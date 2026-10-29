export default function JoinButton({children, disabled, onClick}) {
    return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full sm:w-[90px] lg:w-[110px] h-[50px] sm:h-[55px] rounded-full font-montserrat font-bold text-base sm:text-lg lg:text-[20px] 
      ${disabled ? "bg-secondary-dark_gray text-[#A4A4A4] cursor-not-allowed" : "bg-primary-red_accent text-white cursor-pointer hover:bg-primary-red_accent/80 hover:scale-105 duration-300"}`}
    >
      {children}
    </button>
    )
}