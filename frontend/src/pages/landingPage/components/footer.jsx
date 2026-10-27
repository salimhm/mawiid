import {LinkedinIcon, MailIcon, XIcon} from '../utils/icons';

export default function Footer()
{
    return (
        <footer className="flex flex-col justify-between items-center w-full text-white px-6 sm:px-10 lg:px-16 pt-12 pb-8 mt-12 border-t border-white/10">
            <div className="flex flex-col items-start justify-start w-full max-w-7xl gap-4 sm:gap-6 mb-12">
                <h1 className="font-montserrat font-[800] text-4xl sm:text-6xl lg:text-[80px] leading-tight">Mawiid</h1>
                <p className="text-primary-white/90 font-montserrat text-base sm:text-lg lg:text-[21px] font-[400] max-w-[427px]">
                    Amazing experience using our 100% Moroccan meetings software
                </p>
            </div>
            <div className="flex flex-col sm:flex-row justify-between items-center w-full max-w-7xl pt-6 border-t border-primary-white/40 gap-4">
                <p className="font-montserrat font-[400] text-sm sm:text-base lg:text-[19px] text-primary-white/80 text-center sm:text-left">
                    © 2026 Mawiid. All rights reserved.
                </p>
                <div className="flex justify-center sm:justify-end items-center gap-6">
                    {LinkedinIcon()}
                    {MailIcon()}
                    {XIcon()}
                </div>
            </div>    
        </footer>
    )
}