import { useEffect, useRef, useState } from 'react';
import { PowerUpPresentation } from './PowerUpPresentation';
import { QuizContent } from './QuizContent';
import { ItemTray } from './PowerUps';
import { ease, introFrame, powerPan } from './intro-timeline.mjs';
import timing from '../../shared/timing.json';
import './question-transition.css';

export function QuestionTransition({ intro, game, host, onAction, pending, onCover, onDone }) {
  const [now, setNow] = useState(() => Date.now() + (game?.clockOffset || 0));
  const callbacks = useRef({ onCover, onDone });
  callbacks.current = { onCover, onDone };
  const clockOffset = game?.clockOffset || 0;
  useEffect(() => {
    let frame, covered = false;
    const animate = () => {
      const time = Date.now() + clockOffset;
      setNow(time);
      if (!covered && time >= intro.coveredAt) { covered = true; callbacks.current.onCover(); }
      if (intro.endsAt !== null && time >= intro.endsAt) { callbacks.current.onDone(); return; }
      // The preview can wait indefinitely. Stop rendering once its entrance is
      // complete; a new spotlight or countdown timestamp restarts animation.
      if (intro.endsAt === null && time >= intro.previewAt + timing.pan) return;
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [intro.coveredAt, intro.previewAt, intro.endsAt, clockOffset]);
  useEffect(() => {
    if (!host || intro.countdownAt !== null || intro.skipped) return;
    const start = event => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      if (!game.presentationBusy && Date.now() + clockOffset >= intro.previewAt + timing.pan) onAction({ type: 'start-countdown' });
    };
    window.addEventListener('keydown', start);
    return () => window.removeEventListener('keydown', start);
  }, [host, intro.countdownAt, intro.skipped, intro.previewAt, game.presentationBusy, clockOffset, onAction]);
  const state = introFrame(intro, now);
  const radius = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 2;
  if (state.phase === 'done') return null;
  if (state.phase === 'cover') return <div className="question-transition" aria-hidden="true">
    <div className="transition-cover-dot" style={{ transform: `translate(-50%, -50%) scale(${state.cover * radius / 50})` }} />
  </div>;
  if (state.phase === 'reveal') {
    const size = `${state.mask * radius}px`;
    const mask = `radial-gradient(circle at center, transparent 0, transparent ${size}, #000 calc(${size} + 1px))`;
    return <div className="question-transition" aria-hidden="true"><div className="transition-mask" style={{ WebkitMaskImage: mask, maskImage: mask }} /></div>;
  }
  const event = game?.presentation;
  const selecting = !host && game.player && !intro.skipped && intro.countdownAt === null;
  const entrance = state.phase === 'preview' ? ease(Math.min(1, state.elapsed / timing.pan)) : 0;
  const pulse = state.second < .18 ? state.second / .18 : state.second > .75 ? (1 - state.second) / .25 : 1;
  return <section className="question-transition intro-stage" aria-label={state.phase === 'powers' ? 'Power-up intro' : 'Question preview'}>
    <div className="transition-solid-green" />
    {host && state.phase === 'powers' && event?.phase === 'activation' && now < event.endsAt && <div className="intro-motion intro-power" style={powerPan(event, now, timing.pan)}>
      <PowerUpPresentation game={game} host={host} intro />
    </div>}
    {selecting ? <div className="intro-item-window">
      <div className="intro-item-heading"><h2>{event?.phase === 'activation' ? `${event.emoji} ${event.casterName} used ${event.name}` : 'Make your move'}</h2><p>{event?.phase === 'activation' ? event.description : 'Look at the host screen. Use one power-up for this question before the countdown starts.'}</p></div>
      {game.player.spectator ? <p>You’re in for the next question.</p> : <ItemTray game={game} onAction={onAction} pending={pending} />}
    </div> : state.phase === 'preview' && <div className="intro-question intro-motion" style={{ transform: `translateY(${(entrance - 1) * 100}vh)`, opacity: entrance * state.fade }}>
      {host ? <>
        <p className="intro-question-label">Question {game.questionNumber} / {game.totalQuestions}</p>
        <QuizContent className="intro-question-content" text={game.question?.prompt} fit heading />
      </> : <div className="intro-player-ready"><p>Get ready</p><span>Look at the host screen</span></div>}
      <div className="intro-countdown" aria-label={state.waiting ? 'Waiting for the host' : `${state.count} seconds until answers open`}>
        {state.waiting && <p className="intro-start-prompt">Press <kbd>Space</kbd> to start <small>Players can use power-ups now</small></p>}
        {state.count > 0 && <span style={{ opacity: pulse, transform: `scale(${1.12 - state.second * .22})` }}>{state.count}</span>}
      </div>
    </div>}
  </section>;
}
