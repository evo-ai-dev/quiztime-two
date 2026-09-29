'use strict';
const { handlers } = require('./items');
const { reflect } = require('./items/attacks');

// Plan all results once. Only base points are visible on answer review;
// adjustments, hidden effects and final streak changes commit after the reveal queue.
function settleRound(game) {
  const round = game.round, outcomes = new Map(), reveals = [];
  const name = id => game.players.get(id)?.racerName || 'Racer';
  const reveal = (id, item, data, mode = 'result') => reveals.push(game.makePresentation(id, item.type, 'result', data, mode));
  for (const id of round.participants) {
    const player = game.players.get(id), item = round.items.get(id);
    let answer = round.answers.get(id);
    const notes = [];
    if (item?.type === 'copycat') {
      answer = handlers.copycat.resolveAnswer(item, round.answers);
      notes.push(answer ? 'Trusted their answer and speed' : 'No answer to copy. Item returned.');
      if (!answer) game.refund(player, item);
    }
    const skipped = item?.type === 'personal-skip';
    const correct = !skipped && !!answer && answer.index === game.questions[game.index].answerIndex;
    const base = skipped ? 0 : correct ? 500 + Math.round(500 * Math.max(0, 1 - answer.elapsed / round.duration)) : answer && game.wrongPenalty ? -game.wrongPenalty : 0;
    outcomes.set(id, { correct, answerIndex: answer?.index ?? null, elapsed: answer?.elapsed, base, points: base, notes, skipped,
      streak: skipped ? player.streak : correct ? player.streak + 1 : 0,
      multiplier: skipped || correct ? player.streakMultiplier : 1 });
  }
  const wrongCount = [...outcomes.values()].filter(o => !o.correct && o.answerIndex !== null && !o.skipped).length;
  for (const [id, item] of round.items) {
    const outcome = outcomes.get(id);
    if (!outcome) continue;
    const before = outcome.points;
    if (item.type === 'double') {
      const heads = game.randomInt(2) === 1;
      outcome.points = before > 0 ? heads ? before * 2 : 0 : before;
      reveal(id, item, { heads, before, after: outcome.points, delta: outcome.points - before }, 'coin');
    } else if (item.type === 'sucker') {
      outcome.points = handlers.sucker.modify(before, wrongCount);
      reveal(id, item, { detail: `${wrongCount} racers answered incorrectly`, before, after: outcome.points });
    } else if (item.type === 'intern') {
      outcome.points = handlers.intern.modify(before);
      reveal(id, item, { detail: outcome.correct ? 'Your intern got it right! ×1.5' : 'Your intern guessed wrong.', before, after: outcome.points });
    } else if (item.type === 'prediction') {
      outcome.points = handlers.prediction.modify(before, item.targetId, round.firstManual);
      reveal(id, item, { detail: `Predicted ${name(item.targetId)} · First: ${round.firstManual ? name(round.firstManual) : 'no manual answer'}`, before, after: outcome.points });
    } else if (item.type === 'wpm') {
      outcome.points = handlers.wpm.modify(before, outcome.elapsed);
      reveal(id, item, { detail: outcome.correct && outcome.elapsed <= 5000 ? 'Correct in five seconds. Double points!' : 'No speed bonus this time.', before, after: outcome.points });
    } else if (item.type === 'personal-skip') {
      outcome.points = handlers['personal-skip'].points;
      reveal(id, item, { detail: 'Question skipped. Streak preserved.', before, after: outcome.points });
    } else if (item.type === 'bill') {
      reveal(id, item, { detail: `“I miss Bill” was sent to ${name(item.effectTargetId || item.targetId)}.` });
    } else if (item.type === 'ribbit') {
      reveal(id, item, { detail: 'The next leaderboard belongs to Frog. Every Frog.' });
    }
    if (outcome.points !== before) outcome.notes.push(`${game.itemName(item.type)}: ${outcome.points - before >= 0 ? '+' : ''}${outcome.points - before}`);
  }

  for (const [id, item] of round.items) {
    if (item.type === 'blue-shell' && round.firstManual) {
      const attack = reflect(game, id, round.firstManual, item.type), victim = outcomes.get(attack.targetId);
      if (victim) {
        const before = victim.points; victim.points = handlers['blue-shell'].modify(before);
        reveal(id, item, { targetName: name(attack.targetId), detail: 'First manual answer caught the shell.', before, after: victim.points });
      }
    } else if (item.type === 'blue-shell') reveal(id, item, { detail: 'No manual answer. The shell missed everyone.' });
    if (item.type === 'potato' && round.potato) {
      const victim = outcomes.get(round.potato.holderId);
      if (victim) {
        const before = victim.points; victim.points = handlers.potato.modify(before);
        reveal(id, item, { targetName: name(round.potato.holderId), detail: 'Caught holding the potato!', before, after: victim.points });
      }
    }
  }

  const snapshot = new Map([...outcomes].map(([id, o]) => [id, o.points]));
  for (const [id, item] of round.items) {
    if (item.type === 'siphon') {
      if (!outcomes.has(item.targetId)) { game.refund(game.players.get(id), item); reveal(id, item, { detail: 'Target missed this round. Item returned.' }); continue; }
      const attack = reflect(game, id, item.targetId, item.type);
      const source = outcomes.get(attack.targetId), receiver = outcomes.get(attack.casterId);
      const amount = handlers.siphon.transfer(snapshot.get(attack.targetId));
      source.points -= amount; receiver.points += amount;
      source.notes.push(`Siphon Points: ${-amount}`); receiver.notes.push(`Siphon Points: ${amount >= 0 ? '+' : ''}${amount}`);
      reveal(id, item, { sourceName: name(attack.targetId), targetName: name(attack.casterId), amount, detail: amount < 0 ? 'Sharing the loss' : 'Points absorbed' }, 'transfer');
    }
    if (item.type === 'taxes') {
      const transfers = [];
      for (const targetId of round.participants) {
        if (round.startRanks.get(targetId) >= round.startRanks.get(id)) continue;
        const attack = reflect(game, id, targetId, item.type);
        outcomes.get(attack.targetId).points -= handlers.taxes.contribution;
        outcomes.get(attack.casterId).points += handlers.taxes.contribution;
        transfers.push({ from: name(attack.targetId), to: name(attack.casterId), amount: handlers.taxes.contribution });
      }
      reveal(id, item, { transfers, detail: transfers.length ? '100 points per racer above you' : 'Nobody was above you. No tax collected.' });
    }
    if (item.type === 'clear-streaks') {
      const targets = new Set();
      for (const targetId of round.participants) {
        if (targetId !== id) targets.add(reflect(game, id, targetId, item.type).targetId);
      }
      for (const targetId of targets) { const o = outcomes.get(targetId); o.streak = 0; o.multiplier = 1; }
      reveal(id, item, { detail: 'Streaks extinguished', names: [...targets].map(name) });
    }
  }
  for (const [id, item] of round.items) {
    if (item.type !== 'reverse') continue;
    const reflected = round.reversals.filter(r => r.to === id);
    reveal(id, item, { detail: reflected.length ? reflected.map(r => `${game.itemName(r.type)} returned to ${name(r.from)}`).join(' · ') : 'No attack to reverse this round.' });
  }

  for (const [id, outcome] of outcomes) {
    const player = game.players.get(id);
    player.score += outcome.base;
    player.lastAnswerCorrect = outcome.correct; player.answerIndex = outcome.answerIndex;
    player.lastQuestionPoints = outcome.base;
    player.streak = outcome.skipped ? player.streak : outcome.correct ? player.streak + 1 : 0;
    if (!player.streak) player.streakMultiplier = 1;
    player.breakdown = { notes: [], skipped: outcome.skipped };
  }
  round.outcomes = outcomes;
  return reveals;
}

function commitRound(game) {
  const round = game.round;
  if (round.committed) return;
  round.committed = true;
  for (const [id, outcome] of round.outcomes || []) {
    const player = game.players.get(id);
    player.score += outcome.points - outcome.base;
    player.lastQuestionPoints = outcome.points;
    player.streak = outcome.streak; player.streakMultiplier = outcome.multiplier;
    player.breakdown = { notes: outcome.notes, skipped: outcome.skipped };
  }
  round.frogLeaderboard = [...round.items.values()].some(item => item.type === 'ribbit');
}
module.exports = { settleRound, commitRound };
