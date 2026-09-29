import { useCallback, useEffect, useRef, useState } from 'react';

const socketUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const read = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* Private browser storage can be disabled. */ } };

export function useGameSocket(notify, attention) {
  const host = location.pathname.replace(/\/+$/, '') === '/host';
  const [screen, setScreen] = useState(host ? 'host' : 'join');
  const [game, setGame] = useState(null);
  const [connection, setConnection] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [pending, setPending] = useState(false);
  const [answerError, setAnswerError] = useState(0);
  const socket = useRef(null), reconnect = useRef(null), config = useRef(null), clock = useRef(0);
  const latest = useRef(null), requests = useRef(new Map()), retry = useRef(0), disposed = useRef(false);
  const openRef = useRef(null);

  const leave = useCallback(() => {
    config.current = null;
    clearTimeout(reconnect.current);
    const previous = socket.current;
    socket.current = null;
    previous?.close();
    requests.current.clear(); setPending(false);
    save('ribbit-session', null);
    setGame(null); latest.current = null; setScreen('join'); setConnection('');
  }, []);

  const open = useCallback(() => {
    if (!config.current || disposed.current) return;
    const current = new WebSocket(socketUrl());
    socket.current = current;
    setConnection(retry.current ? 'Reconnecting… Your game is saved while the server stays running.' : 'Connecting…');
    current.addEventListener('open', () => {
      if (socket.current !== current) return;
      current.send(JSON.stringify({ type: 'time-sync', clientSentAt: Date.now() }));
      current.send(JSON.stringify({ type: 'hello', ...config.current }));
    });
    current.addEventListener('message', event => {
      if (socket.current !== current) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'time-sync') { clock.current = message.serverTime - (message.clientSentAt + Date.now()) / 2; return; }
      if (message.type === 'connected') {
        retry.current = 0; setConnection(''); setNeedsPin(false);
        if (message.playerId) {
          save('ribbit-session', message.playerId);
          config.current = { role: 'player', sessionId: message.playerId, resumeOnly: true };
        }
        for (const request of requests.current.values()) current.send(JSON.stringify(request));
      }
      if (message.type === 'state') {
        latest.current = { ...message.state, clockOffset: clock.current };
        setGame(latest.current);
      }
      if (message.type === 'hint' && latest.current?.roundId === message.roundId && latest.current.player) {
        latest.current = { ...latest.current, player: { ...latest.current.player, hint: message.text } };
        setGame(latest.current);
      }
      if (message.type === 'auth-required') { setNeedsPin(true); setConnection(''); }
      if (['lobby-reset', 'session-expired', 'session-replaced'].includes(message.type)) {
        leave();
        if (message.type !== 'lobby-reset') notify(message.message || 'Your racer is connected in another tab.');
      }
      if (message.type === 'ack' || message.type === 'error') {
        requests.current.delete(message.requestId); setPending(requests.current.size > 0);
        if (message.type === 'error') {
          notify(message.message);
          if (message.action === 'answer') setAnswerError(value => value + 1);
          if (config.current?.role === 'player' && !config.current.resumeOnly && !latest.current) leave();
        }
      }
      if (message.type === 'attention') attention(`${message.player.racerName} is likely cheating!`);
      if (message.type === 'results') {
        const url = URL.createObjectURL(new Blob([message.text], { type: 'text/plain' }));
        const link = document.createElement('a'); link.href = url; link.download = `ribbit-results-${new Date().toISOString().slice(0, 10)}.txt`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    current.addEventListener('error', () => {});
    current.addEventListener('close', () => {
      if (socket.current !== current || disposed.current || !config.current) return;
      retry.current += 1;
      setConnection('Connection lost. Reconnecting…');
      reconnect.current = setTimeout(() => openRef.current(), Math.min(10000, 750 * 2 ** Math.min(4, retry.current)));
    });
  }, [attention, leave, notify]);
  openRef.current = open;

  const connect = useCallback((role, details = {}) => {
    clearTimeout(reconnect.current);
    const previous = socket.current; socket.current = null; previous?.close();
    config.current = { role, ...details }; retry.current = 0; setScreen(role);
    if (role === 'host' && details.pin) save('ribbit-host-pin', details.pin);
    open();
  }, [open]);

  const send = useCallback(message => {
    if (socket.current?.readyState !== WebSocket.OPEN) { notify('Reconnecting — try again when connected.'); return false; }
    const request = { gameId: latest.current?.gameId, roundId: latest.current?.roundId, ...message };
    if (['answer', 'use-item', 'blackjack', 'pass-potato', 'flip-coin'].includes(message.type)) {
      request.requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      requests.current.set(request.requestId, request); setPending(true);
    }
    socket.current.send(JSON.stringify(request));
    return true;
  }, [notify]);

  useEffect(() => {
    disposed.current = false;
    if (host) connect('host', { pin: read('ribbit-host-pin') || '' });
    else if (read('ribbit-session')) connect('player', { sessionId: read('ribbit-session'), resumeOnly: true });
    return () => { disposed.current = true; clearTimeout(reconnect.current); socket.current?.close(); };
  }, [connect, host]);

  return { screen, game, connection, needsPin, connect, send, pending, answerError };
}
