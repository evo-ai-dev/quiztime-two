import { useEffect, useState } from 'react';
import catalog from '../../shared/items.json';

const byId = Object.fromEntries(catalog.map(item => [item.id, item]));
const signed = value => `${value >= 0 ? '+' : ''}${value.toLocaleString()}`;

export function useGameNow(game) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
  return now + (game?.clockOffset || 0);
}

function unavailable(item, game) {
  if (game.reviewStage !== 'ready' || game.presentationBusy) return 'Wait for the reveals';
  if (item.maxUsesPerGame && (game.itemUses?.[item.id] || 0) >= item.maxUsesPerGame) return 'Already used this game';
  if (game.player.usedItemRound === game.roundId) return 'One per round — yours is locked in.';
  if (item.kind === 'next' && game.questionNumber === game.totalQuestions) return 'No next question';
  if (['boost', 'cash-out'].includes(item.id) && !game.player.streak) return 'Needs a streak';
  if (item.id === 'boost' && game.player.streakMultiplier >= 25) return 'Already at ×25';
  if (item.id === 'blackjack' && game.player.score < 1) return 'Needs points to bet';
  if ((item.id === 'copycat' || item.target) && !game.players.some(p => p.id !== game.player.id && p.connected)) return 'Needs another racer';
  return '';
}

export function ItemTray({ game, onAction, pending }) {
  const [selectedId, setSelectedId] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('100');
  const [showRules, setShowRules] = useState(false);
  const player = game.player;
  const slot = player.inventory.find(item => item.id === selectedId);
  const selected = slot && byId[slot.type];
  const used = player.usedItemRound === game.roundId;
  useEffect(() => { setSelectedId(null); setTargetId(''); }, [game.roundId, used]);
  const activate = () => onAction({ type: 'use-item', itemId: slot.id, targetId, amount: Number(amount), roundId: game.roundId });
  const armed = player.armed && byId[player.armed.type];

  return <section className="item-tray" aria-label="Power-ups">
    <div className="item-tray-heading"><div><p className="eyebrow">A little pond chaos</p><h3>Your power-ups</h3></div><button className="item-help" onClick={() => setShowRules(!showRules)} aria-expanded={showRules}>How to play</button></div>
    <p className="item-caption">{used ? 'Locked in. Nice move.' : 'Pick one during review. Unused items stay in your backpack.'}</p>
    {showRules && <div className="item-rules">Three slots. One use per review. Loud powers get five seconds EACH on screen; the answering clock waits. Silent powers reveal after the answer. Cold Feet and Water spare their user unless reversed. Multipliers affect question points. Blackjack uses quiz points, never money. Boosts multiply streak cash-out value.</div>}
    {armed && <div className="item-armed" role="status"><span>{armed.emoji}</span><div><strong>{armed.name} armed</strong><small>Ready for the next question</small></div><b>✓</b></div>}
    <div className="item-grid">
      {player.inventory.map(slot => {
        const item = byId[slot.type]; const reason = unavailable(item, game);
        return <button key={slot.id} className={`item-card rarity-${item.rarity}${slot.id === selectedId ? ' item-selected' : ''}`} disabled={!!reason || pending} onClick={() => { setSelectedId(slot.id); setTargetId(''); setAmount(String(Math.min(100, player.score))); }} aria-pressed={slot.id === selectedId}>
          <span className="item-rarity">{item.visibility === 'silent' ? '🤫 Silent' : '📣 Loud'} · {item.rarity}</span><span className="item-emoji" aria-hidden="true">{item.emoji}</span><strong>{item.name}</strong><small>{reason || (item.kind === 'next' ? 'Next question' : 'After answer')}</small>
        </button>;
      })}
      {Array.from({ length: 3 - player.inventory.length }, (_, i) => <div className="item-empty-slot" key={`empty-${i}`}><span>✦</span><small>Refills next round</small></div>)}
    </div>
    {selected && !used && <div className="item-detail">
      <strong>{selected.emoji} {selected.name}</strong><p>{selected.description}</p>
      {selected.target && <label>Choose a racer<select value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Pick your target…</option>{game.players.filter(p => p.id !== player.id && p.connected).map(p => <option key={p.id} value={p.id}>{p.racerName} · {p.score} pts</option>)}</select></label>}
      {selected.wager && <label>Points to bet (1–{Math.min(1000, player.score)})<input type="number" min="1" max={Math.min(1000, player.score)} step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></label>}
      <button className="primary item-confirm" disabled={pending || !!unavailable(selected, game) || (selected.target && !targetId) || (selected.wager && (!Number.isInteger(Number(amount)) || Number(amount) < 1 || Number(amount) > Math.min(1000, player.score)))} onClick={activate}>{pending ? 'Locking in…' : selected.kind === 'next' ? 'Arm for next question' : 'Let’s do it'} <span>→</span></button>
    </div>}
    {player.hand && !game.presentation && <Blackjack game={game} hand={player.hand} owner={false} onAction={onAction} pending={pending} />}
    {!!player.reviewAdjustment && <p className="item-caption">Power-up adjustments this review: <strong>{signed(player.reviewAdjustment)}</strong> points</p>}
  </section>;
}

function Cards({ cards }) {
  return <div className="playing-cards">{cards.map((card, index) => <span key={index} className={`playing-card${card && ['♥', '♦'].includes(card.suit) ? ' red-card' : ''}${card ? '' : ' card-back'}`}>{card ? <>{card.rank}<small>{card.suit}</small></> : '🐸'}</span>)}</div>;
}

export function Blackjack({ game, hand, owner, onAction, pending }) {
  const now = useGameNow(game), active = hand.status === 'playing';
  return <section className="blackjack-table" aria-label="Blackjack">
    <p className="eyebrow">Pond casino · {hand.wager} points</p>
    <div className="card-row"><span>Dealer {hand.dealerValue ?? '?'}</span><Cards cards={hand.dealer} /></div>
    <div className="card-row"><span>{owner ? 'You' : 'Racer'} · {hand.playerValue}</span><Cards cards={hand.player} /></div>
    {active ? <>{owner ? <div className="blackjack-actions"><button className="secondary" disabled={pending} onClick={() => onAction({ type: 'blackjack', handId: hand.id, move: 'hit' })}>Hit</button><button className="primary" disabled={pending} onClick={() => onAction({ type: 'blackjack', handId: hand.id, move: 'stand' })}>Stand</button></div> : <p className="casino-spectating">The racer is playing on their device.</p>}<small>Auto-stand in {Math.max(0, Math.ceil((hand.expiresAt - now) / 1000))}s · Dealer stands on 17 · Wins pay 1:1</small></> : <strong className="blackjack-result">{hand.status === 'won' ? 'Winner! 🃏' : hand.status === 'push' ? 'Push. Bet returned.' : 'The pond wins this one.'} {signed(hand.payout - hand.wager)} points</strong>}
  </section>;
}

export function getRoundEffect(game, now) {
  if (game.status !== 'question' || now < game.answerOpensAt) return null;
  if (game.player?.frozenUntil > now) return { type: 'freeze', emoji: '🧊', text: 'Frozen!', endsAt: game.player.frozenUntil };
  return null;
}

export function RoundEffects({ game, effect, now, onAction, pending }) {
  const item = byId[game.player?.activeItem];
  return <>
    {effect && <div className={`round-effect effect-${effect.type}`} role="status"><span>{effect.emoji}</span><strong>{effect.text}</strong><small>{Math.max(0, Math.ceil((effect.endsAt - now) / 1000))}s</small></div>}
    {game.player?.activeItem === 'whisper' && <div className="whisper-bubble" role="status"><span>🤖 Walker's Weapon <small>(definitely not AI)</small></span><p>{game.player.hint || 'Thinking really, really hard…'}<b className="typing-cursor">▍</b></p></div>}
    {item && game.player.activeItem !== 'whisper' && !effect && <div className="active-item-chip">{item.emoji} {item.name}{item.id === 'copycat' ? ' is answering for you' : ' active'}</div>}
    {game.player?.spectator && <div className="active-item-chip">You’re in for the next question!</div>}
    {game.player?.potato && <button className="hot-potato" aria-label="Pass the hot potato" disabled={pending || game.presentationBusy || now < game.questionStartedAt || now < game.player.potato.nextPassAt || now >= game.questionEndsAt} onClick={() => onAction({ type: 'pass-potato', version: game.player.potato.version })}><span>🥔</span><strong>HOT POTATO!</strong><small>Tap to pass · don’t finish holding it</small></button>}
  </>;
}
