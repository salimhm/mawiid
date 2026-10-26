import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket() {
	const socketRef = useRef(null);
	const roomCodeRef = useRef('');

	const [isConnected, setIsConnected] = useState(false);
	const [isValidated, setIsValidated] = useState(false);
	const [error, setError] = useState('');
	const [createdRoomCode, setCreatedRoomCode] = useState('');
	const [peers, setPeers] = useState([]);
	const [messages, setMessages] = useState([]);

	const send = useCallback((payload) => {
		if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
			setError('Socket not connected');
			return;
		}
		socketRef.current.send(JSON.stringify(payload));
	}, []);

	const disconnect = useCallback(() => {
		if (socketRef.current) {
			if (socketRef.current.readyState === WebSocket.OPEN) {
				socketRef.current.send(JSON.stringify({ close: true, code: roomCodeRef.current }));
			}
			socketRef.current.close();
			socketRef.current = null;
			setIsConnected(false);
			setIsValidated(false);
			setPeers([]);
		}
	}, []);

	const connect = useCallback((roomCode, target_lang = 'en') => {
		if (!roomCode) {
			setError('roomCode is required');
			return;
		}

		const safeCode = String(roomCode).replace(/[^a-zA-Z0-9]/g, '');
		if (!safeCode) {
			setError('Invalid room code');
			return;
		}
		roomCodeRef.current = safeCode;
		setIsValidated(false);

		if (socketRef.current) {
			socketRef.current.close();
		}

		setError('');

		const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const wsUrl = `${protocol}://${window.location.host}/livetranslation_ws/${safeCode}`;

		const socket = new WebSocket(wsUrl);
		socketRef.current = socket;

		socket.onopen = () => {
			setIsConnected(true);
			socket.send(JSON.stringify({ type: 'set-target-lang', target_lang }));
		};

		socket.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				switch (data.type) {
					case 'your-id':
						console.log('My ID:', data.peerId);
						break;

					case 'room-created':
						setCreatedRoomCode(data.code);
						setIsValidated(true);
						break;

					case 'existing-peers':
						setPeers(data.peers || []);
						setIsValidated(true);
						break;

					case 'user-joined':
						setPeers(prev => [...prev, data.peerId]);
						break;

					case 'user-left':
						setPeers(prev => prev.filter(p => p !== data.peerId));
						break;

					case 'message':
						if (data.translated != null || data.original != null) {
							setMessages(prev => [...prev, data.translated ?? data.original]);
						}
						break;

					case 'ping':
						if (socket.readyState === WebSocket.OPEN) {
							socket.send(JSON.stringify({ type: 'pong' }));
						}
						break;

					case 'error':
						setError(data.message || 'Unknown error');
						setIsValidated(false);
						break;

					default:
						console.log('Unknown event:', data);
				}

			} catch (err) {
				setError('Failed to parse server message');
			}
		};

		socket.onerror = () => {
			setError('WebSocket connection failed');
			setIsValidated(false);
		};

		socket.onclose = () => {
			setIsConnected(false);
			setIsValidated(false);
		};
	}, []);

	const sendOffer     = useCallback((sdp)       => send({ type: 'offer',      sdp, code: roomCodeRef.current }),       [send]);
	const sendAnswer    = useCallback((sdp)       => send({ type: 'answer',     sdp, code: roomCodeRef.current }),       [send]);
	const sendCandidate = useCallback((candidate) => send({ type: 'candidate', candidate, code: roomCodeRef.current }), [send]);

	const sendTranscript = useCallback((text, source_lang = 'auto') => {
		send({
			type: 'transcript',
			message: text,
			sourceLang: source_lang,
			code: roomCodeRef.current,
			room_code: roomCodeRef.current,
		});
	}, [send]);

	useEffect(() => {
		return () => disconnect();
	}, [disconnect]);

	return {
		connect,
		disconnect,
		isConnected,
		isValidated,
		error,
		createdRoomCode,
		peers,
		messages,
		sendTranscript,
		sendOffer,
		sendAnswer,
		sendCandidate,
	};
}