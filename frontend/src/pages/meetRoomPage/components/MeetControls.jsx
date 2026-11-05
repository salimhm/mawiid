import {useEffect, useState} from 'react';
import { useNavigate } from 'react-router-dom';
import ControlsButtons from '../../../components/controlButtons';
import { copyText } from '../../../lib/utils';
import * as icons from '../../../assets/icons';

// The languages the AI translation worker handles (services/ai/README.md).
const LANGUAGE_CODES = {
    English: 'en',
    Arabic: 'ar',
    'Darija (Moroccan Arabic)': 'ar-MA',
    French: 'fr',
    'Chinese (Simplified)': 'zh-CN',
    'Chinese (Traditional)': 'zh-TW',
};
const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮'];

export default function MeetControls({ fullScreen, setFullScreen, micOn = false, camOn = false, handRaised = false, language = '', spokenLanguage = '', onMicToggle, onCamToggle, onScreenShareToggle, onHandToggle, translationEnabled = false, onTranslationToggle, onLanguageChange, onSpokenLanguageChange, onReaction, onLeave, roomCode = '' })
{
    const [translating, setTranslating] = useState(false);
    const [reacting, setReacting] = useState(false);
    const [reactionPos, setReactionPos] = useState({ x: 0, y: 0 });
    const [copied, setCopied] = useState(false);
    const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
    const [pickedLanguage, setPickedLanguage] = useState('');
    const [pickedSpokenLanguage, setPickedSpokenLanguage] = useState('');

    const navigate = useNavigate();
    const languages = Object.keys(LANGUAGE_CODES);
    const languageName = (code) => languages.find((name) => LANGUAGE_CODES[name] === code)
        || languages.find((name) => LANGUAGE_CODES[name] === code.split('-')[0])
        || 'English';
    const currLanguage = pickedLanguage || languageName(language);
    const currSpokenLanguage = pickedSpokenLanguage || languageName(spokenLanguage || language);
    const roomID = roomCode;

    useEffect(() => {
        if (!translating)
            return;

        const handleScreenClick = () => {
            setTranslating(false);
        };

        window.addEventListener('click', handleScreenClick);
        return () => window.removeEventListener('click', handleScreenClick);
    }, [translating]);

    useEffect(() => {
        if (!reacting)
            return;

        const handleScreenClick = () => {
            setReacting(false);
        };

        window.addEventListener('click', handleScreenClick);
        return () => window.removeEventListener('click', handleScreenClick);
    }, [reacting]);

    const handleReactionClick = (e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setReactionPos({
            x: rect.left + rect.width / 2,
            y: rect.top,
        });
        setTranslating(false);
        setReacting((prev) => !prev);
    };

    const handleTranslateClick = (e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setMenuPos({
            x: rect.left + rect.width / 2,
            y: rect.top,
        });
        setReacting(false);
        setTranslating((prev) => !prev);
    };

    const handleLanguageChange = (name) => {
        setPickedLanguage(name);
        onLanguageChange?.(LANGUAGE_CODES[name]);
    };

    const handleSpokenLanguageChange = (name) => {
        setPickedSpokenLanguage(name);
        onSpokenLanguageChange?.(LANGUAGE_CODES[name]);
    };

    const languageSection = (title, current, onPick) => (
        <>
            <div className='px-4 py-2 border-b border-white/24 text-sm sm:text-base text-white bg-white/20 flex items-center gap-2 font-medium'>
                {icons.translateIcon(24, 24, 1)} {title}
            </div>
            {languages.map((name) => (
                <button key={name} className={name === current ? 'w-full py-2 hover:bg-white/40 border-white/20 border-b text-white font-semibold text-sm sm:text-base bg-blue-600/50 cursor-default' : 'w-full py-2 hover:bg-white/10 border-white/20 border-b text-sm sm:text-base cursor-pointer'} onClick={() => {onPick(name)}}>
                    {name}
                </button>
            ))}
        </>
    );

    const handleCopyClick = async () => {
        try {
            await copyText(roomID);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (error) {
            console.error('Failed to copy Room ID:', error);
        }
    };

    const popupX = typeof window !== 'undefined' ? Math.min(Math.max(menuPos.x, 125), window.innerWidth - 125) : menuPos.x;

    return (
        <>
            <footer className={fullScreen ? 'fixed bottom-0 left-0 right-0 z-24 h-16 sm:h-20 flex items-center justify-between px-2 sm:px-5 pb-6 sm:pb-12 bg-gradient-to-t from-black/80 to-transparent' : 'h-16 sm:h-20 flex items-center justify-between px-2 sm:px-5 mb-2 sm:mb-6'}>
                <div className='min-w-0'>
                    {!fullScreen && (
                        <span className='text-white text-xs sm:text-base md:text-[19px] font-Montserrat-500 flex items-center gap-1 sm:gap-2 truncate'>
                            <span className='hidden sm:inline'>ID :</span> {roomID}
                            <button className='hover:scale-110 transition cursor-pointer p-1 shrink-0' onClick={handleCopyClick} title="Copy ID">
                                {icons.copyIcon(20, 20)}
                            </button>
                        </span>
                    )}
                </div>
                <div className={fullScreen ? "flex items-center bg-black/80 backdrop-blur-md px-2 sm:px-5 py-2 sm:py-3 rounded-2xl sm:rounded-3xl gap-1 sm:gap-2 shadow-2xl" : "flex items-center gap-1 sm:gap-2"}>
                    <ControlsButtons buttons={[
                        { icon: micOn ? icons.micOnIcon(20, 20) : icons.micOffIcon(20, 20), onClick: onMicToggle || (() => {}) },
                        { icon: camOn ? icons.camOnIcon(20, 20) : icons.camOffIcon(20, 20), onClick: onCamToggle || (() => {}) },
                        { icon: icons.translateIcon(20, 20), onClick: handleTranslateClick },
                        { icon: icons.emojiIcon(20, 20, 1.8), onClick: handleReactionClick, label: 'Reactions' },
                    ]} containerClassName='gap-1 sm:gap-4 px-1 py-1' buttonClassName='text-base sm:text-xl p-1 sm:p-1.5 cursor-pointer' />
                    <div className='hidden xs:block'>
                        <ControlsButtons buttons={[
                            { icon: icons.shareScreenIcon(20, 20), onClick: onScreenShareToggle || (() => {}) },
                            { icon: handRaised ? <span className='text-yellow-300'>{icons.raiseHandIcon(20, 20)}</span> : icons.raiseHandIcon(20, 20), onClick: onHandToggle || (() => {}) }
                        ]} containerClassName='gap-1 sm:gap-4 px-1 py-1' buttonClassName='text-base sm:text-xl p-1 sm:p-1.5 cursor-pointer' />
                    </div>
                    <button className='text-white text-base sm:text-xl bg-red-500 hover:scale-105 active:scale-95 transition px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-2xl sm:rounded-3xl cursor-pointer shrink-0 ml-1' onClick={onLeave || (() => navigate('/'))} title="Leave Call">
                        {icons.phoneIcon(22, 22)}
                    </button>
                </div>
                <div>
                    <button className='text-white text-sm sm:text-xl border border-white/15 bg-overlay-white_10 backdrop-blur-xs hover:scale-105 active:scale-95 transition p-2 rounded-xl sm:rounded-[22px] cursor-pointer shrink-0' onClick={() => {setFullScreen(!fullScreen)}} title={fullScreen ? "Exit Fullscreen" : "Fullscreen"}>
                        { fullScreen ? icons.minimizeIcon(20, 20) : icons.maximizeIcon(20, 20) }
                    </button>
                </div>
            </footer>

            {translating && (
                <div
                    className='fixed w-56 sm:w-60 max-h-[70vh] overflow-y-auto rounded-3xl bg-black/60 backdrop-blur-xl border border-white/24 text-white font-inter z-50 shadow-2xl'
                    style={{
                        left: popupX,
                        top: menuPos.y - 12,
                        transform: 'translate(-50%, -100%)',
                    }}
                >
                    <button aria-pressed={translationEnabled} className='w-full flex items-center justify-between px-4 py-2.5 border-b border-white/24 text-sm sm:text-base font-medium hover:bg-white/10 cursor-pointer' onClick={() => onTranslationToggle?.()}>
                        Live translation
                        <span className={translationEnabled ? 'rounded-full bg-blue-600 px-2.5 py-0.5 text-xs' : 'rounded-full bg-white/20 px-2.5 py-0.5 text-xs'}>{translationEnabled ? 'On' : 'Off'}</span>
                    </button>
                    {languageSection('I speak', currSpokenLanguage, handleSpokenLanguageChange)}
                    {languageSection('Show captions in', currLanguage, handleLanguageChange)}
                </div>
            )}

            {reacting && (
                <div
                    className='fixed rounded-full bg-black/60 backdrop-blur-xl border border-white/24 z-50 shadow-2xl flex items-center gap-1 px-2 py-1.5'
                    style={{
                        left: typeof window !== 'undefined' ? Math.min(Math.max(reactionPos.x, 140), window.innerWidth - 140) : reactionPos.x,
                        top: reactionPos.y - 12,
                        transform: 'translate(-50%, -100%)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {REACTIONS.map((reaction) => (
                        <button key={reaction} className='text-2xl leading-none p-1.5 rounded-full hover:bg-white/15 hover:scale-125 transition cursor-pointer' onClick={() => onReaction?.(reaction)} title={`React ${reaction}`}>
                            {reaction}
                        </button>
                    ))}
                </div>
            )}

            {copied && (
                <div className='fixed bottom-20 left-1/12 z-[60] -translate-x-1/2 rounded-xl border px-4 py-2 text-white backdrop-blur-xl'>
                    Room ID copied
                </div>
            )}
        </>
    )
}
