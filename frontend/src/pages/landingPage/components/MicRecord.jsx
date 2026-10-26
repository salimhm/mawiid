import { MicIcon, VideoIcon, LanguageIcon1 } from "../utils/icons"


export default function MicRecord() {
    return (
    <div className="flex items-center justify-center gap-6 text-white w-[119px] h-[30px] bg-[#FFFFFF1A] rounded-full">
        {MicIcon()}
        {VideoIcon()}
        <span className="w-[17px] h-[17px] rounded-full bg-secondary-red_accent">
        {LanguageIcon1()}
        </span>
    </div>
    )
}