import { Blackjack, useGameNow } from './PowerUps';
import catalog from '../../shared/items.json';
import './presentations.css';

const meta = Object.fromEntries(catalog.map(item => [item.id, item]));
const signed = n => `${n >= 0 ? '+' : ''}${n.toLocaleString()}`;

export function PowerUpPresentation({ game, onAction, pending, overlay = false }) {
  const now = useGameNow(game), event = game.presentation;
  if (!event) return null;
  const data = event.data || {}, owner = game.player?.id === event.casterId;
  const remaining = Math.max(0, Math.ceil((event.endsAt - now) / 1000));
  const progress = Math.max(0, Math.min(1, (event.endsAt - now) / (event.endsAt - event.startsAt)));
  return <section className={`power-presentation${overlay ? ' power-presentation-overlay' : ''}`} aria-label="Power-up announcement" key={event.id}>
    <div className="power-presentation-content">
      <p className="presentation-kicker">{event.phase === 'activation' ? '📣 Power-up incoming' : meta[event.type]?.visibility === 'silent' ? '🤫 Secret power revealed' : 'The results are in'}</p>
      <span className="presentation-emoji" aria-hidden="true">{event.emoji}</span>
      <p className="presentation-racer">{event.casterName}</p>
      <h2>{event.name}</h2><p className="presentation-description">{event.description}</p>
      {event.mode === 'coin' ? <div className="coin-stage">
        <div className={`big-coin${event.flipped ? ' coin-flipping' : ''}`} key={event.flipped ? 'flipped' : 'ready'}>{event.flipped ? data.heads ? '2×' : '0×' : '?'}</div>
        {event.flipped ? <><h3>{data.heads ? 'Heads!' : 'Tails!'}</h3><p>{data.before} → <strong>{data.after} question points</strong></p></> : <>{owner ? <button className="primary join-submit" disabled={pending} onClick={() => onAction({ type: 'flip-coin', presentationId: event.id })}>Flip my coin 🪙</button> : <p>{event.casterName} is flipping their coin…</p>}<small>Automatically flips in {remaining}s</small></>}
      </div> : event.mode === 'casino' && event.hand ? <Blackjack game={game} hand={event.hand} owner={owner} onAction={onAction} pending={pending} /> : <>
        {event.mode === 'transfer' && data.sourceName && <div className="siphon-stage"><div><span>🧑‍🚀</span><strong>{data.amount < 0 ? data.targetName : data.sourceName}</strong><b className="points-out">−{Math.abs(data.amount)}</b></div><div className="siphon-stream"><i /><i /><i /><span>→</span></div><div><span>🧲</span><strong>{data.amount < 0 ? data.sourceName : data.targetName}</strong><b className="points-in">+{Math.abs(data.amount)}</b></div></div>}
        {event.type === 'cash-out' && data.bonus !== undefined && <div className="cash-in-stage"><div className="streak-cashing"><span>{data.multiplier > 1 ? '🐦‍🔥' : '🔥'}</span><strong>{data.beforeStreak} streak · ×{data.multiplier}</strong></div><b>→</b><div><span>🪙</span><strong className="points-in">+{data.bonus} points</strong></div></div>}
        {event.type === 'boost' && data.multiplier && <div className="phoenix-reveal">🐦‍🔥 <strong>×{data.multiplier}</strong></div>}
        {data.targetName && event.mode !== 'transfer' && <p className="presentation-target">{data.targetName}</p>}
        {data.before !== undefined && data.after !== undefined && event.type !== 'cash-out' && <div className="presentation-points"><span>{data.before}</span><b>→</b><strong>{data.after}</strong><small>{signed(data.after - data.before)} points</small></div>}
        {data.detail && <p className="presentation-detail">{data.detail}</p>}
        {data.names && <p className="presentation-names">{data.names.join(' · ')}</p>}
        {data.transfers && <ul className="tax-transfers">{data.transfers.map((transfer, i) => <li key={i}>{transfer.from} <b>−{transfer.amount} → +{transfer.amount}</b> {transfer.to}</li>)}</ul>}
      </>}
      <div className="presentation-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
      <p className="presentation-footnote">{event.phase === 'activation' ? 'Question clock paused' : 'Scores settle after the reveals'} · {remaining}s{event.remaining ? ` · ${event.remaining} more` : ''}</p>
    </div>
  </section>;
}

export function Podium({ players = [], frog = false }) {
  if (!players.length) return null;
  return <section className="podium" aria-label="Final podium">{players.map((player, i) => <div className={`podium-place podium-place-${i + 1}`} key={player.id}><span>{['🥇', '🥈', '🥉'][i]}</span><strong>{frog ? 'Frog' : player.racerName}</strong><small>{player.score.toLocaleString()} points</small><b>#{i + 1}</b></div>)}</section>;
}
