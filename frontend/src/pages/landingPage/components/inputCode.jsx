import { KeyboardIcon } from "../utils/icons"

export default function inputCode( { value, onChange }) {
    return (
        <div className="w-full sm:w-[280px] md:w-[320px] lg:w-[370px] h-[50px] sm:h-[55px] flex justify-center border border-primary-white/70 gap-2 sm:gap-3 rounded-[15px] items-center px-3 sm:px-5 text-white">
            {KeyboardIcon()}
            <input
                type="text"
                value={value}
                onChange={onChange}
                placeholder="Tape the code to join Mawiid"
                className="bg-transparent outline-none w-full h-full text-primary-white font-montserrat font-light text-sm sm:text-base lg:text-[17px] tracking-wider placeholder:text-primary-white/50 focus:placeholder:text-primary-white/0 transition-all duration-500"
            />
         </div>
    )
}