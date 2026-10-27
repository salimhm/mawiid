import { useState, useEffect, useRef, useCallback } from 'react';
import ControlsButtons from '../../../components/controlButtons';
import * as icons from '../../../assets/icons';

const ROLE_LABELS = { host: 'Host', moderator: 'Moderator', member: 'Member', viewer: 'Viewer' };

// Which actions the local user may take on a participant. The backend enforces
// the same rules; this only hides actions that would be refused.
function moderationActions(participant, localRole, moderation)
{
    const isStaff = localRole === 'host' || localRole === 'moderator';
    if (!isStaff || participant.isLocal || !participant.userId || participant.role === 'host')
        return [];
    if (localRole === 'moderator' && participant.role === 'moderator')
        return [];

    const actions = [];
    if (participant.isMicOn)
        actions.push({ label: 'Mute microphone', run: () => moderation.mute(participant, 'microphone') });
    else
        actions.push({ label: 'Ask to unmute', run: () => moderation.askToUnmute(participant, 'microphone') });
    if (participant.isCamPublished)
        actions.push({ label: 'Turn off camera', run: () => moderation.mute(participant, 'camera') });
    if (participant.role === 'viewer')
        actions.push({ label: 'Promote to member', run: () => moderation.promote(participant) });
    if (localRole === 'host' && participant.role === 'member')
        actions.push({ label: 'Make moderator', run: () => moderation.makeModerator(participant) });
    if (participant.role === 'member' || participant.role === 'moderator')
        actions.push({ label: 'Demote to viewer', run: () => moderation.demote(participant) });
    actions.push({ label: 'Remove', run: () => moderation.remove(participant) });
    actions.push({ label: 'Remove for 10 minutes', run: () => moderation.remove(participant, 10) });
    actions.push({
        label: 'Ban from this mawiid',
        danger: true,
        run: () => window.confirm(`Ban ${participant.name}? They will not be able to rejoin.`) && moderation.ban(participant),
    });
    return actions;
}

function typingLabel(typing)
{
    if (typing.length === 1)
        return `${typing[0].name} is typing…`;
    if (typing.length === 2)
        return `${typing[0].name} and ${typing[1].name} are typing…`;
    return `${typing.length} people are typing…`;
}

function SettingToggle({ label, description, checked, onChange })
{
    return (
        <label className='flex items-center justify-between gap-3 rounded-2xl bg-overlay-black_30 px-4 py-2.5 cursor-pointer'>
            <span className='min-w-0'>
                <span className='block text-sm font-montserrat'>{label}</span>
                <span className='block text-xs text-primary-white/60'>{description}</span>
            </span>
            <input type='checkbox' role='switch' className='h-5 w-9 shrink-0 accent-[#2346FA] cursor-pointer' checked={checked} onChange={(e) => onChange(e.target.checked)} />
        </label>
    );
}

export default function MeetHeader({ fullScreen, participants = [], localRole = '', isStaff = false, moderation, settings, onUpdateSettings, typing = [], onTyping })
{
    const [actionsFor, setActionsFor] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuPage, setMenuPage] = useState('chat');
    const [chatInput, setChatInput] = useState('');
    const [hostMsgs, setHostMsgs] = useState([]);
    const messagesEndRef = useRef(null);
    const closeMenuTimerRef = useRef(null);

    const closeMenu = useCallback(() => {
        setMenuVisible(false);

        if (closeMenuTimerRef.current)
            clearTimeout(closeMenuTimerRef.current);

        closeMenuTimerRef.current = setTimeout(() => {
            setMenuOpen(false);
        }, 220);
    }, []);

    const openMenu = useCallback((page) => {
        if (closeMenuTimerRef.current)
            clearTimeout(closeMenuTimerRef.current);

        setMenuPage(page);
        setMenuOpen(true);

        requestAnimationFrame(() => {
            setMenuVisible(true);
        });
    }, []);

    useEffect(() => {
        if (!menuOpen)
            return;

        const handleScreenClick = () => closeMenu();

        const handleEscape = (e) => {
            if (e.key === 'Escape')
                closeMenu();
        };

        window.addEventListener('click', handleScreenClick);
        window.addEventListener('keydown', handleEscape);

        return () => {
            window.removeEventListener('click', handleScreenClick);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [menuOpen, closeMenu]);

    useEffect(() => {
        return () => {
            if (closeMenuTimerRef.current)
                clearTimeout(closeMenuTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (menuPage !== 'chat')
            return;

        messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }, [hostMsgs, menuPage, menuOpen]);

    const handleChatClick = (e) => {
        e.stopPropagation();
        openMenu('chat');
    };
    
    const handleUsersClick = (e) => {
        e.stopPropagation();
        openMenu('users');
    };

    const handleSendMessage = () => {
        const text = chatInput.trim();

        if (!text)
            return;

        setHostMsgs((prev) => [...prev, text]);
        setChatInput('');
        onTyping?.(false);
    };

    return (
        <header className={fullScreen ? 'fixed top-0 left-0 right-0 z-30 h-14 sm:h-16 px-4 sm:px-12 flex items-center justify-between' : 'relative h-14 sm:h-16 px-3 sm:px-5 flex items-center justify-between'}>
            {!fullScreen && (
                <span className='text-primary-white font-bold text-2xl sm:text-3xl md:text-[42px] lg:text-[52px] leading-none tracking-tight'>
                    MAWIID
                </span>
            )}

            {!menuOpen && (
                <div className='ml-auto'>
                    <ControlsButtons buttons={[
                        { icon: icons.chatIcon(20, 20), onClick: handleChatClick },
                        { icon: icons.usersIcon(20, 20), onClick: handleUsersClick }
                    ]} containerClassName='gap-2 sm:gap-4 px-1 py-1' buttonClassName='text-base sm:text-xl p-1 cursor-pointer'/>
                </div>
            )}

            {menuOpen && (
                <div
                    className={menuVisible ? 'fixed z-50 right-2 sm:right-5 top-14 sm:top-12 w-[calc(100vw-16px)] sm:w-[min(90vw,500px)] h-[min(75vh,520px)] rounded-[24px] text-primary-white font-inter overflow-hidden border border-overlay-white_40 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-out opacity-100 translate-y-0 scale-100' : 'fixed z-50 right-2 sm:right-5 top-14 sm:top-12 w-[calc(100vw-16px)] sm:w-[min(90vw,500px)] h-[min(75vh,520px)] rounded-[24px] text-primary-white font-inter overflow-hidden border border-overlay-white_40 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-out opacity-0 -translate-y-2 scale-95 pointer-events-none'}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className='h-full w-full flex flex-col bg-overlay-black_30'>
                        <div className='flex items-center border-b border-overlay-white_40 bg-primary-black/45'>
                            <button
                                onClick={() => setMenuPage('chat')}
                                className={menuPage === 'chat' ? 'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm sm:text-base font-montserrat bg-overlay-white_10 text-primary-white border-r border-overlay-white_40' : 'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm sm:text-base font-montserrat text-primary-white/80 border-r border-overlay-white_40'}
                            >
                                {icons.chatIcon(20, 20, 1.8)}
                                Chat
                            </button>
                            <button
                                onClick={() => setMenuPage('users')}
                                className={menuPage === 'users' ? 'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm sm:text-base font-montserrat bg-overlay-white_10 text-primary-white' : 'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm sm:text-base font-montserrat text-primary-white/80'}
                            >
                                {icons.usersIcon(20, 20, 1.8)}
                                Participants
                            </button>
                            <button
                                onClick={closeMenu}
                                className='px-3 py-2 text-primary-white/70 hover:text-white transition text-lg'
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div className='flex-1 overflow-hidden px-4 md:px-5 py-3 md:py-4'>
                            {menuPage === 'chat' && (
                                <div className='h-full min-h-0 flex flex-col'>
                                    <div className='flex items-center gap-3 text-primary-white/80 text-base mb-4'>
                                        <span className='h-px flex-1 bg-overlay-white_40'></span>
                                        <span className='font-montserrat'>Messages</span>
                                        <span className='h-px flex-1 bg-overlay-white_40'></span>
                                    </div>

                                    <div className='meet-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 space-y-4 text-primary-white'>
                                        <div>
                                            <p className='text-base font-montserrat font-semibold leading-none mb-2'>Guest Name</p>
                                            <div className='flex items-center gap-2'>
                                                <span className='inline-flex text-xs items-center rounded-[14px] rounded-bl-[40px] bg-primary-dark-red px-7 py-2.5 text-sm font-montserrat'>Guest Language</span>
                                                <span className='text-xs text-primary-white/80'>20:40</span>
                                            </div>
                                            <div className='mt-2 ml-16 flex items-center text-[8px] text-primary-white/70'>
                                                <button className='cursor-pointer hover:text-primary-white underline-offset-2 hover:underline' onClick={() => {}}>
                                                    Change to original text
                                                </button>
                                                <span className='mx-2'>/</span>
                                                <button className='cursor-pointer hover:text-primary-white underline-offset-2 hover:underline' onClick={() => {}}>
                                                    Translate
                                                </button>
                                            </div>
                                        </div>

                                        {hostMsgs.map((msg, i) => (
                                            <div key={`${msg}-${i}`} className='ml-auto w-fit text-right'>
                                                <p className='text-base font-montserrat font-semibold leading-none mb-2'>Host Name</p>
                                                <div className='flex items-center gap-2 justify-end'>
                                                    <span className='text-xs text-primary-white/80'>20:40</span>
                                                    <span className='inline-flex text-xs items-center rounded-[14px] rounded-br-[40px] bg-secondary-green px-7 py-2.5 text-sm font-montserrat'>
                                                        {msg}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                        <div ref={messagesEndRef}></div>
                                    </div>

                                    <p className='shrink-0 h-5 pt-1 text-xs text-primary-white/70 italic' aria-live='polite'>
                                        {typing.length > 0 ? typingLabel(typing) : ''}
                                    </p>

                                    <div className='shrink-0 pt-3'>
                                        <div className='flex items-center gap-2 rounded-[16px] border border-overlay-white_40 bg-overlay-black_30 px-3 py-1.5'>
                                            <input
                                                type='text'
                                                placeholder='Chat ...'
                                                value={chatInput}
                                                onChange={(e) => {
                                                    setChatInput(e.target.value);
                                                    onTyping?.(e.target.value.trim().length > 0);
                                                }}
                                                onBlur={() => onTyping?.(false)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleSendMessage();
                                                    }
                                                }}
                                                className='flex-1 bg-transparent text-sm text-primary-white placeholder:text-primary-white/80 outline-none'
                                            />
                                            <button className='text-primary-white/90 hover:text-primary-white hover:scale-110 transition' onClick={() => {}}>
                                                {icons.uploadIcon(22, 22, 1.8)}
                                            </button>
                                            <button className='text-primary-white/90 hover:text-primary-white hover:scale-110 transition' onClick={() => {}}>
                                                {icons.emojiIcon(22, 22, 1.8)}
                                            </button>
                                            <button className='text-primary-white/90 hover:text-primary-white hover:scale-110 transition' onClick={handleSendMessage}>
                                                {icons.sendIcon(24, 24, 1.8)}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {menuPage === 'users' && (
                                <div className='h-full flex flex-col'>
                                    <div className='mb-3 flex justify-center'>
                                        <button className='inline-flex items-center gap-2 px-4 py-1.5 text-base text-primary-white/90 rounded-full border border-overlay-white_40 bg-primary-blue_accent hover:bg-primary-blue_accent/85 hover:text-primary-white transition' onClick={() => {}}>
                                            {icons.addIcon(24, 24, 1.2)}
                                            Invite Guests
                                        </button>
                                    </div>
                                    {isStaff && settings && (
                                        <div className='mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2'>
                                            <SettingToggle label='Lock' description='Only the host can join' checked={settings.locked} onChange={(locked) => onUpdateSettings?.({ room_locked: locked })} />
                                            <SettingToggle label='Lobby' description='Guests wait to be admitted' checked={settings.lobby} onChange={(lobby) => onUpdateSettings?.({ room_lobby_enabled: lobby })} />
                                        </div>
                                    )}
                                    <div className='flex items-center gap-3 text-primary-white/80 text-base mb-4'>
                                        <span className='h-px flex-1 bg-overlay-white_40'></span>
                                        <span className='font-montserrat'>Participants</span>
                                        <span className='h-px flex-1 bg-overlay-white_40'></span>
                                    </div>

                                    <div className='space-y-3 overflow-auto pr-2'>
                                        {participants.map((participant) => {
                                            const actions = moderation ? moderationActions(participant, localRole, moderation) : [];
                                            const open = actionsFor === participant.id;
                                            return (
                                                <div key={participant.id} className='rounded-2xl bg-overlay-black_30'>
                                                    <div className='flex items-center justify-between px-4 py-3'>
                                                        <div className='min-w-0'>
                                                            <p className='text-base font-montserrat leading-tight'>{participant.name}</p>
                                                            <p className='text-xs text-primary-white/70 mt-1'>{ROLE_LABELS[participant.role] || 'Guest'}{participant.handRaised ? ' · ✋' : ''}</p>
                                                        </div>
                                                        {actions.length > 0 && (
                                                            <button className='text-primary-white/75 hover:text-primary-white transition p-1 cursor-pointer' aria-expanded={open} aria-label={`Actions for ${participant.name}`} onClick={() => setActionsFor(open ? null : participant.id)}>
                                                                {icons.dotsVerticalIcon(24, 24, 1.8)}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {open && (
                                                        <div className='grid grid-cols-1 sm:grid-cols-2 gap-1 px-3 pb-3'>
                                                            {actions.map((action) => (
                                                                <button
                                                                    key={action.label}
                                                                    className={action.danger ? 'rounded-xl px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/20 transition cursor-pointer' : 'rounded-xl px-3 py-2 text-left text-sm hover:bg-white/10 transition cursor-pointer'}
                                                                    onClick={() => {
                                                                        setActionsFor(null);
                                                                        action.run();
                                                                    }}
                                                                >
                                                                    {action.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </header>
    )
}
