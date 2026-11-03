import CreateButton from "./components/createButton";
import JoinButton from "./components/joinButton";
import InputCode from "./components/inputCode";
import { useState } from "react";
import WordScroller from "./components/scroll";
import animation1 from "../../assets/french.gif"
import animation2 from "../../assets/english.gif"
import user1 from "../../assets/user1.gif"
import user2 from "../../assets/user2.gif"
import LanguageOptions from "./components/LanguageOptions";
import MicRecord from "./components/MicRecord";
import collection from "../../assets/collection.gif"
import tree from "../../assets/tree.png"
import dashboard from "../../assets/dashboard.png"
import play from "../../assets/play.png"
import JoinnowButton from "./components/joinnowButton";
import CreatemeetButton from "./components/createmeetButton";
import Footer from "./components/footer";
import AccountButton from "./components/accountButton";
import { useNavigate } from "react-router-dom";

import dark_logo from "../../assets/logo/mawiid_logo_dark.png"

export default function Landing_Page() {

    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [joinError, setJoinError] = useState('');
    const [isJoining, setIsJoining] = useState(false);

    // Room codes are the backend room_uid (a UUID).
    const sanitizeRoomCode = (value) => value.replace(/[^a-zA-Z0-9-]/g, '');

    const handleJoinClick = () => {
        const safeCode = sanitizeRoomCode(String(code)).toLowerCase();
        if (!safeCode)
            return;

        setIsJoining(true);
        navigate('/welcome', { state: { isCreator: false, roomCode: safeCode } });
    };
    return (
        <div className="relative flex flex-col justify-center items-center bg-primary-black min-h-screen w-full gap-8 sm:gap-11 overflow-x-hidden pt-8 sm:pt-14">
            <div className="absolute top-4 right-4 sm:top-6 sm:right-8 z-20">
                <AccountButton />
            </div>
            <img src={dark_logo} alt="logo" className="w-[80%] h-[300px] object-cover" />
            <h2 className="font-montserrat text-2xl sm:text-4xl md:text-5xl lg:text-[66px] w-full max-w-5xl px-4 text-center font-extrabold leading-tight lg:leading-none text-primary-white">
                Your future Meets Tool is finally here!
            </h2>
            <p className="font-inter font-[400] tracking-normal sm:tracking-[0.09em] text-base sm:text-lg md:text-xl lg:text-[22.67px] w-full max-w-4xl px-6 text-center leading-relaxed lg:leading-[45px] text-primary-white/90">
                Novexperience offers a friendly Meeting Call Transcriptor to connect with people worldwide in your future meetings!
            </p>
            <div className="flex flex-col items-center mb-6 sm:mb-10 gap-3 w-full px-4">
                <div className="w-full max-w-[815px] flex flex-col sm:flex-row justify-center items-center gap-3">
                    <div className="w-full sm:w-auto flex justify-center">
                        <CreateButton />
                    </div>
                    <div className="w-full sm:w-auto flex flex-col sm:flex-row items-center gap-2 sm:gap-3 flex-1 justify-center">
                        <InputCode 
                            value={code}
                            onChange={(e) => {
                                const cleaned = sanitizeRoomCode(e.target.value);
                                setCode(cleaned);
                                setJoinError('');
                            }}
                        />
                        <div className="w-full sm:w-auto">
                            <JoinButton 
                                disabled={!code.trim() || isJoining}
                                onClick={handleJoinClick}
                            >
                                {isJoining ? '...' : 'Join'}
                            </JoinButton>
                        </div>
                    </div>
                </div>
                {joinError && (
                    <p className="text-red-400 text-sm font-inter text-center px-4">
                        {joinError}
                    </p>
                )}
            </div>
            <div className="w-full min-h-auto lg:h-[1350px] flex flex-col lg:flex-row justify-center items-center gap-6 lg:gap-8 my-8 lg:my-16 px-4">
                <div className="font-montserrat text-3xl sm:text-4xl lg:text-[50px] font-extrabold text-center lg:text-left w-full lg:w-[450px] xl:w-[600px] text-primary-white ml-0 lg:ml-10">
                    Lot of features in our Maweed Meet Software
                </div>
                <WordScroller />
            </div>
            <div className="min-h-auto lg:h-[790px] w-full flex flex-col justify-center items-center gap-8 sm:gap-14 lg:gap-[80px] my-10 lg:my-0 px-4">
                <h2 className="flex items-center justify-center lg:justify-start lg:ml-[20px] w-full text-3xl sm:text-5xl md:text-7xl lg:text-[90px] font-montserrat font-extrabold outline-text tracking-wide leading-tight text-center lg:text-left">
                    Speak Your Language.
                </h2>
                <div className="flex flex-col lg:flex-row justify-center items-center w-full gap-8 lg:gap-16 xl:gap-[140px] max-w-7xl">
                    <div className="w-full max-w-[366px] flex flex-col justify-center gap-4 text-primary-white font-inter text-base sm:text-[18px] font-[400] text-center lg:text-left">
                        <p>During the meeting, Mawiid transcribes everything that’s being said.</p>
                        <p>Each participant reads the conversation in the language they selected.</p>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap justify-center items-center gap-3 sm:gap-4 max-w-full overflow-hidden">
                        <div className="flex flex-col justify-end items-center gap-2">
                            <img src={user1} alt="animation" className="rounded-xl shadow-lg w-[48px] h-[48px] sm:w-[58px] sm:h-[58px] object-cover"/>
                            <LanguageOptions children={"French"} />
                            <MicRecord />
                        </div>
                        <img src={animation1} alt="French animation" className="rounded-xl shadow-lg h-[220px] sm:h-[318px] w-[140px] sm:w-[240px] object-cover"/>
                        <img src={animation2} alt="English animation" className="rounded-xl shadow-lg h-[220px] sm:h-[318px] w-[140px] sm:w-[240px] object-cover"/>
                        <div className="flex flex-col justify-end items-center gap-2">
                            <img src={user2} alt="animation" className="rounded-xl shadow-lg w-[48px] h-[48px] sm:w-[58px] sm:h-[58px] object-cover"/>
                            <LanguageOptions children={"English"} />
                            <MicRecord />
                        </div>
                    </div>
                </div>
                <h2 className="flex items-center justify-center lg:justify-end lg:mr-[20px] w-full text-3xl sm:text-5xl md:text-7xl lg:text-[90px] font-montserrat font-extrabold outline-text tracking-wide leading-tight text-center lg:text-right">
                    Everyone Understands.
                </h2>
            </div>
            <div className="flex flex-col justify-center items-center min-h-auto w-full gap-8 lg:gap-[60px] my-12 lg:my-20 px-4">
                <h2 className="font-montserrat font-[800] text-center text-primary-white text-3xl sm:text-5xl lg:text-[64px]">
                    MAAWED BENEFITS
                </h2>
                <img src={collection} alt="collection" className="w-full max-w-[848px] h-auto object-contain" />
            </div>
            <div className="flex flex-col justify-center items-center min-h-auto w-full gap-8 lg:gap-[50px] my-10 lg:my-16 px-4">
                <h2 className="font-montserrat font-[800] text-center text-primary-white text-3xl sm:text-5xl lg:text-[60px]">
                    Our Security Features
                </h2>
                <div className="flex flex-col lg:flex-row justify-around items-center w-full max-w-[1104px] bg-overlay-white_10 rounded-[20px] p-6 lg:p-8 gap-8 lg:gap-0">
                    <div className="flex flex-col justify-center items-center w-full lg:w-1/3 lg:border-r border-dashed border-primary-white/30 gap-4 pb-6 lg:pb-0">
                        <img src={tree} alt="Tree icon" className="w-[70px] sm:w-[84px] h-auto mb-2"/>
                        <h3 className="font-inter text-xl sm:text-[27px] font-[400] text-primary-white">Feature 1</h3>
                        <p className="font-inter text-xs sm:text-[13px] font-[400] text-primary-white/80 max-w-[260px] text-center leading-relaxed">
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore.
                        </p>
                        <button className="font-inter text-xs sm:text-[13px] border-b-2 border-primary-white/40 text-primary-white font-[400] pb-1 hover:border-primary-white transition">
                            Learn more
                        </button>
                    </div>
                    <div className="flex flex-col justify-center items-center w-full lg:w-1/3 lg:border-r border-dashed border-primary-white/30 gap-4 py-6 lg:py-0 border-t lg:border-t-0 border-dashed border-primary-white/30">
                        <img src={dashboard} alt="Dashboard icon" className="w-[70px] sm:w-[84px] h-auto mb-2"/>
                        <h3 className="font-inter text-xl sm:text-[27px] font-[400] text-primary-white">Feature 2</h3>
                        <p className="font-inter text-xs sm:text-[13px] font-[400] text-primary-white/80 max-w-[260px] text-center leading-relaxed">
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore.
                        </p>
                        <button className="font-inter text-xs sm:text-[13px] border-b-2 border-primary-white/40 text-primary-white font-[400] pb-1 hover:border-primary-white transition">
                            Learn more
                        </button>
                    </div>
                    <div className="flex flex-col justify-center items-center w-full lg:w-1/3 gap-4 pt-6 lg:pt-0 border-t lg:border-t-0 border-dashed border-primary-white/30">
                        <img src={play} alt="Play icon" className="w-[70px] sm:w-[84px] h-auto mb-2"/>
                        <h3 className="font-inter text-xl sm:text-[27px] font-[400] text-primary-white">Feature 3</h3>
                        <p className="font-inter text-xs sm:text-[13px] font-[400] text-primary-white/80 max-w-[260px] text-center leading-relaxed">
                            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore.
                        </p>
                        <button className="font-inter text-xs sm:text-[13px] border-b-2 border-primary-white/40 text-primary-white font-[400] pb-1 hover:border-primary-white transition">
                            Learn more
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex flex-col lg:flex-row justify-center items-center w-full max-w-6xl my-10 lg:my-16 px-4 gap-6 lg:gap-0">
                <div className="flex flex-col items-start justify-end w-full lg:w-1/2 min-h-[300px] lg:h-[550px] bg-primary-black rounded-2xl lg:rounded-r-none lg:rounded-l-[20px] border border-dashed border-[#717171] p-6 sm:p-10">
                    <div className="flex flex-col w-full max-w-[430px] gap-3">
                        <h3 className="text-primary-white font-montserrat font-[600] text-2xl sm:text-3xl lg:text-[36px]">Join a Meet</h3>
                        <p className="text-primary-white/80 font-inter text-sm sm:text-base lg:text-[18px] font-[400]">
                            Create an account and give this software a test drive.
                        </p>
                        <div className="mt-2">
                            <JoinnowButton />
                        </div>
                    </div>
                </div>
                <div className="flex flex-col justify-center items-center w-full lg:w-1/2 min-h-[300px] lg:h-[550px] bg-overlay-white_10 rounded-2xl lg:rounded-l-none lg:rounded-r-[20px] p-6 sm:p-10 gap-4 sm:gap-6 border border-white/10 lg:border-l-0">
                    <h3 className="text-primary-white font-montserrat font-[600] text-3xl sm:text-4xl lg:text-[54px] text-center leading-tight">Create a Meet</h3>
                    <p className="text-primary-white/80 font-inter text-sm sm:text-base lg:text-[18px] font-[400] max-w-[320px] text-center">
                        Get a demo of our platform before you sign up.
                    </p>
                    <div className="mt-2">
                        <CreatemeetButton />
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    )
}

