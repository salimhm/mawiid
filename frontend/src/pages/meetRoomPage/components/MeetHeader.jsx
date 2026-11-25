import { useState, useEffect, useRef, useCallback } from 'react';
import * as icons from '../../../assets/icons';
import dark_logo from '../../../assets/logo/mawiid_logo_dark_header.png';

const ROLE_LABELS = { host: 'Host', moderator: 'Moderator', member: 'Member', viewer: 'Viewer' };

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

const MESSAGE_MAX_LENGTH = 3000;

const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function ChatMessage({ message, name, isOwn, onRetry })
{
  return (
    <div className={isOwn ? 'ml-auto w-fit max-w-[85%] text-right' : 'w-fit max-w-[85%]'}>
      <p className='text-[13px] font-montserrat font-semibold leading-none mb-1.5 text-white/90'>{name}</p>
      <div className={isOwn ? 'flex items-end gap-2 justify-end' : 'flex items-end gap-2'}>
        {isOwn && <span className='shrink-0 text-[10px] text-white/50'>{formatTime(message.createdAt)}</span>}
        <span className={`inline-block text-left whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed font-inter ${isOwn ? 'rounded-br-[32px] bg-primary-blue_accent/80' : 'rounded-bl-[32px] bg-white/[0.08]'} ${message.status === 'sending' ? 'opacity-50' : ''}`}>
          {message.text}
        </span>
        {!isOwn && <span className='shrink-0 text-[10px] text-white/50'>{formatTime(message.createdAt)}</span>}
      </div>
      {message.status === 'failed' && (
        <button className='mt-1 text-[10px] text-red-400 hover:text-red-300 underline-offset-2 hover:underline cursor-pointer' onClick={() => onRetry?.(message)}>
          Not sent. Retry
        </button>
      )}
    </div>
  );
}

function RoomEventLine({ event })
{
  return (
    <p className='text-center text-[11px] text-white/40 font-inter'>
      {event.text} · {formatTime(event.createdAt)}
    </p>
  );
}

function chatTimeline(messages, roomEvents)
{
  const items = [];
  let next = 0;
  for (const message of messages) {
    while (next < roomEvents.length && roomEvents[next].createdAt < message.createdAt)
      items.push({ kind: 'event', key: roomEvents[next].key, event: roomEvents[next++] });
    items.push({ kind: 'message', key: message.key, message });
  }
  for (; next < roomEvents.length; next++)
    items.push({ kind: 'event', key: roomEvents[next].key, event: roomEvents[next] });
  return items;
}

function UnreadBadge({ count })
{
  if (!count)
    return null;
  return (
    <span className='absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-4 text-center pointer-events-none ring-2 ring-black/40'>
      {count > 99 ? '99+' : count}
    </span>
  );
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
    <label className='flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] border border-white/[0.06] px-3.5 py-2.5 cursor-pointer hover:bg-white/[0.07] transition-colors'>
      <span className='min-w-0'>
        <span className='block text-[13px] font-montserrat font-medium'>{label}</span>
        <span className='block text-[11px] text-white/50 mt-0.5'>{description}</span>
      </span>
      <input type='checkbox' role='switch' className='h-5 w-9 shrink-0 accent-primary-blue_accent cursor-pointer' checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function PanelTab({ active, icon, label, badge, onClick })
{
  return (
    <button
      onClick={onClick}
      className={`relative flex-1 flex items-center justify-center gap-2 py-3 text-[13px] font-montserrat font-medium transition-all cursor-pointer ${active
        ? 'text-white border-b-2 border-primary-blue_accent'
        : 'text-white/50 border-b-2 border-transparent hover:text-white/70'}`}
    >
      <span className='relative inline-flex'>
        {icon}
        {badge > 0 && <UnreadBadge count={badge} />}
      </span>
      {label}
    </button>
  );
}

export default function MeetHeader({ fullScreen, participants = [], localRole = '', isStaff = false, moderation, settings, onUpdateSettings, typing = [], onTyping, messages = [], roomEvents = [], hasOlderMessages = false, joinedAtMessageId = 0, loadingOlderMessages = false, onSendMessage, onRetryMessage, onLoadOlderMessages })
{
  const [actionsFor, setActionsFor] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelPage, setPanelPage] = useState('chat');
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef(null);
  const timeline = chatTimeline(messages, roomEvents);
  const lastMessageKey = timeline.at(-1)?.key;
  const localUserId = participants.find((participant) => participant.isLocal)?.userId;
  const [readUpToId, setReadUpToId] = useState(0);
  const [unreadMarkerKey, setUnreadMarkerKey] = useState(null);
  const unreadMarkerRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const chatVisible = panelOpen && panelPage === 'chat';
  const newestMessageId = messages.reduce((max, message) => Math.max(max, message.id || 0), 0);
  const readCursor = Math.max(readUpToId, joinedAtMessageId);
  const unreadCount = chatVisible ? 0 : messages.filter((message) => message.id > readCursor && message.userId !== localUserId).length;

  useEffect(() => {
    if (chatVisible)
      setReadUpToId((current) => Math.max(current, newestMessageId));
  }, [chatVisible, newestMessageId]);

  const namesById = new Map(participants.filter((participant) => participant.userId).map((participant) => [participant.userId, participant.name]));

  const togglePanel = useCallback((page) => {
    if (panelOpen && panelPage === page) {
      setPanelOpen(false);
    } else {
      setPanelPage(page);
      setPanelOpen(true);
    }
  }, [panelOpen, panelPage]);

  useEffect(() => {
    if (!panelOpen)
      return;
    const handleEscape = (e) => {
      if (e.key === 'Escape')
        setPanelOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [panelOpen]);

  useEffect(() => {
    if (!chatVisible) {
      setUnreadMarkerKey(null);
      return;
    }
    const firstUnread = messages.find((message) => message.id > readCursor && message.userId !== localUserId);
    setUnreadMarkerKey(firstUnread?.key ?? null);
    pendingScrollRef.current = firstUnread ? 'unread' : 'bottom';
  }, [chatVisible]);

  useEffect(() => {
    if (!chatVisible)
      return;
    if (pendingScrollRef.current === 'unread') {
      if (!unreadMarkerRef.current)
        return;
      unreadMarkerRef.current.scrollIntoView({ block: 'start' });
    } else {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }
    pendingScrollRef.current = null;
  }, [chatVisible, unreadMarkerKey, lastMessageKey]);

  const handleSendMessage = () => {
    const text = chatInput.trim();
    if (!text)
      return;
    onSendMessage?.(text);
    setChatInput('');
    onTyping?.(false);
  };

  return (
    <>
      <header className={fullScreen ? 'fixed top-0 left-0 right-0 z-30 h-14 sm:h-16 px-4 sm:px-12 flex items-center justify-between' : 'relative h-14 sm:h-16 px-3 sm:px-5 flex items-center justify-between'}>
        {!fullScreen && (
          <img
            src={dark_logo}
            alt="Mawiid"
            className="h-7 sm:h-8 md:h-10 lg:h-12 w-auto"
          />
        )}

        <div className='ml-auto flex items-center gap-1.5'>
          <button
            onClick={() => togglePanel('chat')}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-montserrat font-medium transition-all cursor-pointer ${panelOpen && panelPage === 'chat'
              ? 'bg-primary-blue_accent text-white shadow-lg shadow-primary-blue_accent/25'
              : 'bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white backdrop-blur-md'}`}
          >
            <span className='relative inline-flex'>
              {icons.chatIcon(18, 18, 1.8)}
              {!panelOpen && <UnreadBadge count={unreadCount} />}
            </span>
            <span className='hidden sm:inline'>Chat</span>
          </button>

          <button
            onClick={() => togglePanel('users')}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-montserrat font-medium transition-all cursor-pointer ${panelOpen && panelPage === 'users'
              ? 'bg-primary-blue_accent text-white shadow-lg shadow-primary-blue_accent/25'
              : 'bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white backdrop-blur-md'}`}
          >
            {icons.usersIcon(18, 18, 1.8)}
            <span className='hidden sm:inline'>{participants.length}</span>
          </button>
        </div>
      </header>

      {panelOpen && (
        <div
          className='fixed inset-0 z-40 bg-black/20'
          onClick={() => setPanelOpen(false)}
        />
      )}

      <aside
        className={`fixed z-50 top-0 right-0 h-full w-[min(100vw,420px)] flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='h-full flex flex-col bg-[#0a0a0f]/95 backdrop-blur-2xl border-l border-white/[0.06]'>
          <div className='shrink-0 flex items-center justify-between px-5 pt-4 pb-2'>
            <h2 className='text-[15px] font-montserrat font-semibold text-white'>
              {panelPage === 'chat' ? 'Chat' : 'Participants'}
            </h2>
            <button
              onClick={() => setPanelOpen(false)}
              className='w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.12] transition-all cursor-pointer'
              aria-label='Close panel'
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
          </div>

          <div className='shrink-0 flex border-b border-white/[0.06] mx-4'>
            <PanelTab
              active={panelPage === 'chat'}
              icon={icons.chatIcon(16, 16, 1.8)}
              label='Messages'
              badge={panelPage !== 'chat' ? unreadCount : 0}
              onClick={() => setPanelPage('chat')}
            />
            <PanelTab
              active={panelPage === 'users'}
              icon={icons.usersIcon(16, 16, 1.8)}
              label={`Participants (${participants.length})`}
              badge={0}
              onClick={() => setPanelPage('users')}
            />
          </div>

          <div className='flex-1 overflow-hidden'>
            {panelPage === 'chat' && (
              <div className='h-full flex flex-col'>
                <div className='meet-scrollbar flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3'>
                  {hasOlderMessages && (
                    <div className='flex justify-center pb-1'>
                      <button className='text-[11px] text-white/40 hover:text-white/70 cursor-pointer transition-colors' disabled={loadingOlderMessages} onClick={onLoadOlderMessages}>
                        {loadingOlderMessages ? 'Loading…' : '↑ Load earlier messages'}
                      </button>
                    </div>
                  )}
                  {messages.length === 0 && (
                    <div className='flex flex-col items-center justify-center py-16 text-center'>
                      <div className='w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3 text-white/20'>
                        {icons.chatIcon(24, 24, 1.5)}
                      </div>
                      <p className='text-[13px] text-white/30 font-inter'>No messages yet</p>
                      <p className='text-[11px] text-white/20 font-inter mt-1'>Be the first to say something</p>
                    </div>
                  )}
                  {timeline.map((item) => {
                    if (item.kind === 'event')
                      return <RoomEventLine key={item.key} event={item.event} />;
                    const { message } = item;
                    const isOwn = message.userId === localUserId;
                    return (
                      <div key={message.key}>
                        {message.key === unreadMarkerKey && (
                          <div ref={unreadMarkerRef} className='flex items-center gap-3 mb-3 text-[10px] text-red-400/80 font-inter'>
                            <span className='h-px flex-1 bg-red-400/30' />
                            New
                            <span className='h-px flex-1 bg-red-400/30' />
                          </div>
                        )}
                        <ChatMessage
                          message={message}
                          isOwn={isOwn}
                          name={isOwn ? 'You' : namesById.get(message.userId) || `User #${message.userId}`}
                          onRetry={onRetryMessage}
                        />
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {typing.length > 0 && (
                  <p className='shrink-0 px-4 py-1.5 text-[11px] text-white/40 italic font-inter'>
                    {typingLabel(typing)}
                  </p>
                )}

                <div className='shrink-0 p-3 border-t border-white/[0.06]'>
                  <div className='flex items-center gap-2 rounded-xl bg-white/[0.05] border border-white/[0.08] px-3 py-2 focus-within:border-primary-blue_accent/40 transition-colors'>
                    <input
                      type='text'
                      placeholder='Type a message…'
                      maxLength={MESSAGE_MAX_LENGTH}
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
                      className='flex-1 bg-transparent text-[13px] text-white placeholder:text-white/30 outline-none font-inter'
                    />
                    <button className='text-white/30 hover:text-white/70 transition-colors cursor-pointer' onClick={() => {}}>
                      {icons.emojiIcon(18, 18, 1.5)}
                    </button>
                    <button
                      className='w-8 h-8 flex items-center justify-center rounded-lg bg-primary-blue_accent text-white hover:bg-primary-blue_accent/80 transition-colors disabled:opacity-30 disabled:cursor-default cursor-pointer'
                      onClick={handleSendMessage}
                      disabled={!chatInput.trim()}
                    >
                      {icons.sendIcon(16, 16, 2)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {panelPage === 'users' && (
              <div className='h-full flex flex-col'>
                <div className='shrink-0 p-4 pb-2'>
                  <button className='w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-montserrat font-medium text-white rounded-xl bg-primary-blue_accent hover:bg-primary-blue_accent/85 transition-colors cursor-pointer'>
                    {icons.addIcon(18, 18, 1.5)}
                    Invite Guests
                  </button>
                </div>

                {isStaff && settings && (
                  <div className='px-4 pb-3 grid grid-cols-2 gap-2'>
                    <SettingToggle label='Lock' description='Only host can join' checked={settings.locked} onChange={(locked) => onUpdateSettings?.({ room_locked: locked })} />
                    <SettingToggle label='Lobby' description='Guests wait for approval' checked={settings.lobby} onChange={(lobby) => onUpdateSettings?.({ room_lobby_enabled: lobby })} />
                  </div>
                )}

                <div className='meet-scrollbar flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-1.5'>
                  {participants.map((participant) => {
                    const actions = moderation ? moderationActions(participant, localRole, moderation) : [];
                    const open = actionsFor === participant.id;
                    const initials = (participant.name || '?')
                      .replace(/\s*\(You\)\s*/i, '')
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0] || '')
                      .join('')
                      .toUpperCase();
                    return (
                      <div key={participant.id} className='rounded-xl overflow-hidden'>
                        <div className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${open ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}>
                          <div className='w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center shrink-0 text-[12px] font-montserrat font-semibold text-white/70'>
                            {initials}
                          </div>
                          <div className='min-w-0 flex-1'>
                            <p className='text-[13px] font-montserrat font-medium leading-tight truncate'>
                              {participant.name}
                              {participant.isLocal && <span className='text-white/40 ml-1'>(You)</span>}
                            </p>
                            <div className='flex items-center gap-1.5 mt-0.5'>
                              <span className={`text-[10px] font-inter px-1.5 py-0.5 rounded-md ${participant.role === 'host'
                                ? 'bg-primary-blue_accent/20 text-primary-blue_accent'
                                : participant.role === 'moderator'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-white/[0.06] text-white/40'}`}>
                                {ROLE_LABELS[participant.role] || 'Guest'}
                              </span>
                              {participant.handRaised && <span className='text-[12px]' title='Hand raised'>✋</span>}
                              {!participant.isMicOn && (
                                <span className='text-white/30' title='Muted'>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"/><path d="M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -.13 .874m-2 2a3 3 0 0 1 -3.87 -2.872v-1"/><path d="M5 10a7 7 0 0 0 10.846 5.85m2 -2a6.967 6.967 0 0 0 1.152 -3.85"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/></svg>
                                </span>
                              )}
                            </div>
                          </div>
                          {actions.length > 0 && (
                            <button
                              className='w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer'
                              aria-expanded={open}
                              aria-label={`Actions for ${participant.name}`}
                              onClick={() => setActionsFor(open ? null : participant.id)}
                            >
                              {icons.dotsVerticalIcon(16, 16, 2)}
                            </button>
                          )}
                        </div>
                        {open && (
                          <div className='px-2 pb-2 grid grid-cols-2 gap-1'>
                            {actions.map((action) => (
                              <button
                                key={action.label}
                                className={`rounded-lg px-3 py-2 text-left text-[12px] font-inter transition-colors cursor-pointer ${action.danger
                                  ? 'text-red-400 hover:bg-red-500/10'
                                  : 'text-white/70 hover:bg-white/[0.06]'}`}
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
      </aside>
    </>
  )
}
