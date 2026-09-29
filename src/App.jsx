import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameSocket } from './useGameSocket';
import { ItemTray, RoundEffects, getRoundEffect, useGameNow } from './components/PowerUps';
import { PowerUpPresentation, Podium } from './components/PowerUpPresentation';
import timing from '../shared/timing.json';

function App() {
  const [toast, setToast] = useState('');
  const [attentionAlert, setAttentionAlert] = useState('');
  const [displayGame, setDisplayGame] = useState(null);
  const [transition, setTransition] = useState(null);
  const previous = useRef(null), latest = useRef(null), active = useRef(false);
  const toastTimer = useRef(null), attentionTimer = useRef(null);
  const showToast = useCallback(message => {
    setToast(message); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  const showAttention = useCallback(message => {
    setAttentionAlert(message); clearTimeout(attentionTimer.current);
    attentionTimer.current = setTimeout(() => setAttentionAlert(''), 3500);
  }, []);
  const { screen, game, connection, needsPin, connect, send, pending, answerError } = useGameSocket(showToast, showAttention);
  latest.current = game;
  const showQuestion = useCallback(() => setDisplayGame(latest.current), []);
  const finishTransition = useCallback(() => { active.current = false; setDisplayGame(latest.current); setTransition(null); }, []);

  useEffect(() => {
    const old = previous.current;
    if (!game || (old && old.gameId !== game.gameId) || game.status === 'lobby') {
      active.current = false; setTransition(null); setDisplayGame(game);
    } else {
      const newQuestion = game.status === 'question' && game.roundId !== old?.roundId;
      const final = game.status === 'finished' && old?.status !== 'finished';
      const startAt = game.transitionAt - (game.clockOffset || 0);
      const duration = timing.cover + timing.reveal + (newQuestion ? timing.countdown : 0);
      if ((newQuestion || final) && startAt + duration > Date.now()) {
        active.current = true;
        setTransition({ key: game.roundId + game.status, startAt, countdown: newQuestion });
      } else if (!active.current) setDisplayGame(game);
    }
    previous.current = game;
  }, [game]);

  useEffect(() => {
    if (screen !== 'player') return;
    const attention = kind => { if (latest.current?.status === 'question') send({ type: 'attention', kind }); };
    const key = event => { if (event.key === 'Escape') attention('escape-key'); if (event.key === 'Control') attention('control-key'); };
    const visibility = () => { if (document.visibilityState === 'hidden') attention('left-tab'); };
    const blur = () => attention('window-blur');
    document.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur); };
  }, [screen, send]);

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(attentionTimer.current); }, []);
  const join = event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    document.documentElement.requestFullscreen?.().catch(() => {});
    connect('player', { firstName: String(data.get('firstName')).trim(), racerName: String(data.get('racerName')).trim() });
  };
  const fullScreen = ['question', 'review'].includes(displayGame?.status) || screen === 'host';

  return <div className={`app${fullScreen ? ' question-app' : ''}`}>
    {screen === 'join' && <Join onSubmit={join} />}
    {screen === 'host' && (needsPin ? <HostAccess onSubmit={pin => connect('host', { pin })} /> : <Host game={displayGame} onAction={send} transitioning={!!transition} />)}
    {screen === 'player' && <Player game={displayGame} onAnswer={answerIndex => send({ type: 'answer', answerIndex })} onAction={send} pending={pending} answerError={answerError} />}
    {transition && <QuestionTransition key={transition.key} startAt={transition.startAt} showCountdown={transition.countdown} onCover={showQuestion} onDone={finishTransition} />}
    {screen === 'player' && game?.presentation && <PowerUpPresentation game={game} onAction={send} pending={pending} overlay />}
    {attentionAlert && <div className="attention-alert" role="alert">{attentionAlert}</div>}
    {connection && <div className="connection-banner" role="status">{connection}</div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function HostAccess({ onSubmit }) {
  return <main className="page narrow-page join-screen"><div className="join-content"><p className="eyebrow">RibBit · Host access</p><h2>Your pond. Your rules.</h2><form className="join-form" onSubmit={event => { event.preventDefault(); onSubmit(String(new FormData(event.currentTarget).get('pin'))); }}><label>Host PIN<input type="password" name="pin" autoComplete="current-password" required /></label><button className="primary join-submit">Open the game →</button></form><p className="hint">Use the HOST_PIN from your server settings.</p></div></main>;
}

function Join({ onSubmit }) {
  return (
    <main className="page narrow-page join-screen">
      <div className="join-content">
        <p className="eyebrow">Ready, set, ribbit</p>
        <h2>Who is racing?</h2>
        <form className="join-form" onSubmit={onSubmit}>
          <label>First name<input name="firstName" maxLength="28" placeholder="e.g. Sam" required /></label>
          <label>Racer name<input name="racerName" maxLength="28" placeholder="e.g. Green Lightning" required /></label>
          <button className="primary join-submit" type="submit">Join the lobby <span>→</span></button>
        </form>
        <p className="hint">Results and names are recorded.</p>
      </div>
    </main>
  );
}

function Player({ game, onAnswer, onAction, pending, answerError }) {
  if (!game || !game.player) return <main className="page centered player-loading-screen"><div className="player-loading-message"><span className="loader" />Connecting to the lobby…</div></main>;
  if (game.status === 'lobby') {
    return <main className="page centered lobby-screen"><div className="lobby-content"><h2>You’re in.</h2><div className="name-card"><span>Your racer name</span><strong>{game.player.racerName}</strong></div><p className="hint">Stay on this tab while you play. Everyone will be notified about attempts to exit.</p></div></main>;
  }
  if (game.status === 'question') return <QuestionScreen game={game} onAnswer={onAnswer} answerError={answerError} onAction={onAction} pending={pending} />;
  if (game.status === 'review') return <Review game={game} onAction={onAction} pending={pending} />;
  return <Finished game={game} />;
}

function QuestionPrompt({ text, className }) {
  const segments = [];
  let textLines = [];
  let codeLines = null;

  const flushText = () => {
    if (textLines.length > 0) {
      segments.push({ type: 'text', value: textLines.join('\n') });
      textLines = [];
    }
  };

  for (const line of String(text || '').split('\n')) {
    if (line.trim().startsWith('```')) {
      if (codeLines) {
        segments.push({ type: 'code', value: codeLines.join('\n') });
        codeLines = null;
      } else {
        flushText();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) codeLines.push(line);
    else textLines.push(line);
  }

  if (codeLines) segments.push({ type: 'code', value: codeLines.join('\n') });
  flushText();

  return (
    <div className={className} role="heading" aria-level="1">
      {segments.map((segment, index) => segment.type === 'code'
        ? <pre className="question-prompt-code" key={`code-${index}`}><code>{segment.value}</code></pre>
        : <span className="question-prompt-text" key={`text-${index}`}>{segment.value}</span>)}
    </div>
  );
}

function QuestionScreen({ game, onAnswer, answerError, onAction, pending }) {
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const now = useGameNow(game);
  const effect = getRoundEffect(game, now);
  useEffect(() => {
    setSelected(null);
    setSubmitted(false);
  }, [game.roundId, answerError]);
  const answered = game.player.answered || selected !== null;
  const locked = answered || game.presentationBusy || now < game.player.answerOpensAt || now >= game.questionEndsAt || game.player.spectator || ['copycat', 'intern', 'personal-skip'].includes(game.player.activeItem);
  const submitAnswer = (index) => {
    if (locked) return;
    if (!onAnswer(index)) return;
    setSelected(index);
    setSubmitted(true);
  };

  return (
    <main className={`question-screen quadrant-question-screen client-answer-screen${submitted || game.player.answered ? ' answer-submitted' : ''}${effect ? ` is-${effect.type === 'freeze' ? 'frozen' : effect.type}` : ''}`}>
      <div className="client-answer-grid-frame">
        <div className="answer-quadrants">
          {game.question.choices.map((choice, index) => (
            <button key={index} className={`quadrant-answer quadrant-${index + 1}${selected === index ? ' selected' : ''}`} disabled={locked} onClick={() => submitAnswer(index)}>
              <span className="quadrant-text">{choice}</span>
            </button>
          ))}
        </div>
      </div>
      <RoundEffects game={game} effect={effect} now={now} onAction={onAction} pending={pending} />
    </main>
  );
}

function Review({ game, onAction, pending }) {
  const correct = game.player.lastAnswerCorrect === true;
  const personalSkip = game.player.breakdown?.skipped;
  return (
    <main className="page centered review-screen">
      <div className="review-content">
        <div className={`result-icon ${correct || game.skipped || personalSkip ? '' : 'wrong'}`}>{game.skipped ? '🦘' : personalSkip ? '⏭️' : correct ? '✓' : '×'}</div>
        <p className="eyebrow">Question {game.questionNumber} complete</p>
        <h2>{game.skipped ? 'Nope. Next one!' : personalSkip ? 'Taking the shortcut.' : correct ? 'Great answer.' : 'Not this time.'}</h2>
        <p className="lede">{game.skipped ? 'Question skipped. Streaks safe. Queued items returned.' : personalSkip ? 'You skipped this one. Your streak is safe.' : correct ? `You earned ${game.player.lastQuestionPoints} ${game.scoresPending ? 'base ' : ''}points.` : `The correct answer was ${game.question.choices[game.question.correctIndex]}.`}</p>
        <div className="score-box"><span>Your score</span><strong>{game.player.score}</strong><small>{game.player.lastQuestionPoints >= 0 ? '+' : ''}{game.player.lastQuestionPoints} this question</small></div>
        {game.player.streak > 0 && <p className="streak-summary">{game.player.streakIcon} {game.player.streak} in a row{game.player.streakMultiplier > 1 ? ` · ×${game.player.streakMultiplier} cash-out boost` : ''}</p>}
        <div className="review-notes">{game.player.breakdown?.notes.map((note, i) => <span key={i}>{note}</span>)}</div>
        {game.reviewStage === 'ready' ? <ItemTray game={game} onAction={onAction} pending={pending} /> : <p className="reveal-waiting">{game.reviewStage === 'answer' ? 'Power-up results are up next…' : 'Let the powers do their thing…'}</p>}
      </div>
    </main>
  );
}

function Finished({ game }) {
  return (
    <main className="page centered">
      <div className="result-icon trophy">★</div>
      <p className="eyebrow">That’s a wrap</p>
      <h2>Quiz complete.</h2>
      <p className="lede">Your final score is in.</p>
      <div className="score-box"><span>Final score</span><strong>{game.player.score}</strong></div>
      <Podium players={game.podiumPlayers} frog={game.frogLeaderboard} />
      <Scoreboard players={game.players} currentId={game.player.id} />
    </main>
  );
}

function Host({ game, onAction, transitioning }) {
  const now = useGameNow(game);
  const effect = game ? getRoundEffect(game, now) : null;
  const status = game?.status || 'lobby';
  const players = game?.players || [];
  const lobby = status === 'lobby';
  const finished = status === 'finished';
  const review = status === 'review';
  const nextAction = lobby ? 'start' : finished ? 'reset' : review ? 'next' : 'end-question';
  const resetLobby = () => onAction({ type: 'reset' });
  const footerText = lobby
    ? `${players.length} racer${players.length === 1 ? '' : 's'} joined`
    : finished ? 'Quiz complete' : game.presentationBusy ? 'Power-up in the spotlight…' : review && game.reviewStage !== 'ready' ? 'Correct answer · Power-up reveals next' : review ? 'Choose your power-ups · Swipe for standings →' : `${game.answeredCount} of ${game.connectedCount} answered`;

  return (
    <main className={`question-screen host-share-screen${lobby ? ' host-lobby-screen' : ''}`}>
      {!lobby && (
        <header className="host-share-header">
          <span>{finished ? 'Quiz complete' : `Question ${game.questionNumber} / ${game.totalQuestions}`}</span>
          {status === 'question'
            ? <TimeLeft seconds={Math.min(game.questionSeconds, Math.max(0, Math.ceil((game.questionEndsAt - now) / 1000)))} onReset={resetLobby} disabled={transitioning} />
            : <TimeLeft seconds={0} onReset={resetLobby} disabled={transitioning} />}
        </header>
      )}
      {lobby
        ? <HostLobbyDisplay players={players} title={game?.questionFile?.replace(/\.txt$/i, '')} />
        : game.presentation ? <PowerUpPresentation game={game} onAction={onAction} /> : finished ? (
          <div className="host-final-body final-results">
            <Podium players={game.podiumPlayers} frog={game.frogLeaderboard} />
            <div className="final-standings"><LeaderboardRows players={players} revealNames frog={game.frogLeaderboard} /></div>
          </div>
        ) : <HostQuestionDisplay key={game.questionNumber} game={game} review={review} />}
      <footer className="host-share-footer">
        <div className="host-footer-left"><span>{footerText}</span>{finished && <button className="secondary" onClick={() => onAction({ type: 'download-results' })}>Download results</button>}</div>
        <button className="primary" type="button" disabled={!game || transitioning || !game.canAdvance} onClick={() => onAction({ type: nextAction })}>Next</button>
      </footer>
      {game && <RoundEffects game={game} effect={effect} now={now} />}
    </main>
  );
}

function HostLobbyDisplay({ players, title }) {
  return (
    <div className="host-lobby-body">
      <section className="host-lobby-copy">
        <div className="host-card">
          <p className="question-label">{title || 'RibBit'}</p>
          <h3>{players.length ? 'Everyone is in. Start when you’re ready.' : 'Waiting for players to join…'}</h3>
          <p className="hint">Join at {window.location.origin}</p>
        </div>
      </section>
      <HostRoster players={players} />
    </div>
  );
}

function HostRoster({ players }) {
  return (
    <aside className="roster-card">
      <div className="roster-head"><strong>Racers</strong><b>{players.length}</b></div>
      {players.length === 0
        ? <p className="empty">No one has joined yet.</p>
        : players.map((player) => (
          <div className="roster-row" key={player.id}>
            <span className="avatar">{player.racerName?.[0]}</span>
            <div>
              <strong>{player.racerName}</strong>
            </div>
            <b>{player.score}</b>
          </div>
        ))}
    </aside>
  );
}

function HostQuestionDisplay({ game, review }) {
  return (
    <div className="host-share-scroll" aria-label="Question and leaderboard">
      <div className="host-share-panel host-share-middle">
        {game.skipped ? <div className="skipped-message"><span>🦘</span><h2>Nope. Next one!</h2><p>Question skipped. Everyone keeps their streak.</p></div> : <>
        <QuestionPrompt className="host-question-prompt" text={game.question.prompt} />
        <div className="answer-quadrants host-answer-quadrants">
          {game.question.choices.map((choice, index) => (
            <div className={`quadrant-answer quadrant-${index + 1}${review && game.question.correctIndex !== index ? ' incorrect' : ''}`} key={index}>
              <span className="quadrant-text">{choice}</span>
            </div>
          ))}
        </div>
        </>}
      </div>
      {review && game.reviewStage === 'ready' && <div className="host-share-panel host-leaderboard-panel"><LeaderboardRows players={game.players} frog={game.frogLeaderboard} /></div>}
    </div>
  );
}

function LeaderboardRows({ players, revealNames = false, frog = false }) {
  const leaders = (players || []).slice(0, 10);
  return (
    <ol className="host-leaderboard" aria-label={revealNames ? 'Final leaderboard' : 'Leaderboard'}>
      {leaders.length === 0 ? <li className="empty">No players have joined yet.</li> : leaders.map((player, index) => (
        <li className="leaderboard-entry" key={player.id}>
          <span className="leaderboard-rank" aria-hidden="true">{index + 1}</span>
          <strong>{frog ? 'Frog' : player.racerName}</strong>
          {revealNames && player.firstName && <span className="leaderboard-first-name">{player.firstName}</span>}
          {player.streak > 0 && <span className="leaderboard-streak">{player.streakIcon} {player.streak} in a row{player.streakMultiplier > 1 ? ` · ×${player.streakMultiplier}` : ''}</span>}
          <span className="leaderboard-points">{player.score.toLocaleString()} points</span>
          {player.rankChange > 0 && <span className="leaderboard-movement gained" aria-label={`Gained ${player.rankChange} places`}>+{player.rankChange}</span>}
          {player.rankChange < 0 && <span className="leaderboard-movement dropped" aria-label={`Dropped ${Math.abs(player.rankChange)} places`}>{player.rankChange}</span>}
        </li>
      ))}
    </ol>
  );
}

function Scoreboard({ players, currentId }) {
  return <div className="scoreboard">{players.map((player, index) => <div className={player.id === currentId ? 'score-row current' : 'score-row'} key={player.id}><span>#{index + 1}</span><strong>{player.firstName} · {player.racerName}</strong><b>{player.score}</b></div>)}</div>;
}

function TimeLeft({ seconds, onReset, disabled }) {
  const urgent = seconds <= 5;
  return (
    <div className="time-left host-time">
      <span>Time left</span>
      {urgent && onReset
        ? <button className="time-left-reset" type="button" onClick={onReset} disabled={disabled} aria-label={`${seconds} seconds left. Reset lobby`}>{seconds}s</button>
        : <strong className={urgent ? 'urgent' : ''}>{seconds}s</strong>}
    </div>
  );
}

function QuestionTransition({ onCover, onDone, startAt, showCountdown = false }) {
  const [phase, setPhase] = useState('cover');
  const [coverProgress, setCoverProgress] = useState(0);
  const [maskProgress, setMaskProgress] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const coverScale = Math.hypot(window.innerWidth, window.innerHeight) / 100 + 1;
  const maskRadius = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 1;

  useEffect(() => {
    let frame;
    let hasSwappedComponent = false;
    let hasStartedMask = !showCountdown;
    let hasFinished = false;
    const transitionStart = Number.isFinite(startAt) ? startAt : Date.now();
    const coverDuration = timing.cover;
    const countdownDuration = showCountdown ? timing.countdown : 0;
    const maskDuration = timing.reveal;
    const maskStart = coverDuration + countdownDuration;

    const ease = (value) => value < 0.5
      ? 2 * value * value
      : 1 - Math.pow(-2 * value + 2, 2) / 2;
    const animate = (timestamp) => {
      const elapsed = Date.now() - transitionStart;

      if (elapsed < 0) {
        setCoverProgress(0);
        frame = window.requestAnimationFrame(animate);
        return;
      }

      if (elapsed < coverDuration) {
        setCoverProgress(ease(elapsed / coverDuration));
        frame = window.requestAnimationFrame(animate);
        return;
      }

      if (!hasSwappedComponent) {
        hasSwappedComponent = true;
        setCoverProgress(1);
        onCover();
        if (showCountdown) {
          setCountdown(3);
          setPhase('countdown');
        } else {
          setPhase('reveal');
        }
      }

      if (showCountdown && elapsed < maskStart) {
        const countdownElapsed = elapsed - coverDuration;
        const nextCountdown = 3 - Math.floor(countdownElapsed / 1000);
        setCountdown(nextCountdown > 0 ? nextCountdown : null);
        frame = window.requestAnimationFrame(animate);
        return;
      }

      if (!hasStartedMask) {
        hasStartedMask = true;
        setCountdown(null);
        setMaskProgress(0);
        setPhase('reveal');
      }

      const maskElapsed = Math.min(maskDuration, Math.max(0, elapsed - maskStart));
      setMaskProgress(ease(maskElapsed / maskDuration));

      if (maskElapsed < maskDuration) {
        frame = window.requestAnimationFrame(animate);
        return;
      }

      if (!hasFinished) {
        hasFinished = true;
        onDone();
      }
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [onCover, onDone, showCountdown, startAt]);

  if (phase === 'cover') {
    return (
      <div className="question-transition" aria-hidden="true">
        <div className="transition-cover-dot" style={{ transform: `translate(-50%, -50%) scale(${coverProgress * coverScale})` }} />
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="question-transition" aria-hidden="true">
        <div className="transition-solid-green" />
        {countdown && <div className="transition-countdown"><span className="transition-countdown-number" key={countdown}>{countdown}</span></div>}
      </div>
    );
  }

  const radius = `${maskProgress * maskRadius}px`;
  const mask = `radial-gradient(circle at center, transparent 0, transparent ${radius}, #000 calc(${radius} + 1px))`;
  return (
    <div className="question-transition transition-reveal" aria-hidden="true">
      <div className="transition-mask" style={{ WebkitMaskImage: mask, maskImage: mask }} />
    </div>
  );
}

export default App;
