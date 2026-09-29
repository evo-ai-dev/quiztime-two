'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../game');
const { catalog, handlers } = require('../items');
const blackjack = require('../items/blackjack');
const timing = require('../../shared/timing.json');

function fixture({ count = 4, players = 3, randomInt = () => 0, wrongPenalty = 0 } = {}) {
  let now = 100000, sequence = 0, finishCount = 0;
  const game = new Game({ questions: Array.from({ length: count }, () => ({ prompt: 'Pick one', choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answerIndex: 1 })),
    seconds: 20, wrongPenalty, now: () => now, randomInt, id: () => `id-${++sequence}`, onFinish: () => finishCount++ });
  const racers = Array.from({ length: players }, (_, i) => game.join({ firstName: `Private ${i}`, racerName: `Racer ${String(i).padStart(2, '0')}` }));
  const at = time => { now = time; game.tick(); };
  const command = (p, m) => game.command(p, { gameId: game.idValue, roundId: game.round?.id, requestId: `req-${++sequence}`, ...m });
  const answer = (p, answerIndex = 1) => command(p, { type: 'answer', answerIndex });
  const give = (p, type) => { const slot = { id: `slot-${++sequence}`, type }; p.inventory = [slot]; return slot; };
  const use = (p, type, details = {}) => command(p, { type: 'use-item', itemId: give(p, type).id, ...details });
  const drain = () => {
    for (let i = 0; i < 300; i++) {
      if (game.presentations.busy) { at(game.presentations.active?.endsAt ?? game.presentations.nextAt); continue; }
      if (game.status === 'review' && game.reviewStage === 'answer') { at(game.round.reviewEndsAt); continue; }
      return;
    }
    throw new Error('Queue did not drain');
  };
  const open = () => { at(game.round.opensAt); drain(); if (game.status === 'question') at(game.round.startsAt); };
  const review = (indices = []) => {
    open();
    racers.forEach((p, i) => { if (game.status === 'question' && !['copycat', 'intern', 'personal-skip'].includes(game.round.items.get(p.id)?.type)) answer(p, indices[i] ?? 1); });
    if (game.status === 'question') game.endQuestion();
    drain();
  };
  game.beginQuestion(0);
  return { game, racers, at, command, answer, give, use, drain, open, review, finishCount: () => finishCount };
}

test('23 registered powers, correct names and no Lights Out', () => {
  assert.equal(catalog.length, 23); assert.equal(Object.keys(handlers).length, 23);
  assert.ok(!catalog.some(i => i.id === 'blackout'));
  assert.equal(catalog.find(i => i.id === 'whisper').name, "Walker's Weapon");
  assert.equal(catalog.find(i => i.id === 'copycat').name, 'Trust Them');
  assert.equal(catalog.find(i => i.id === 'clear-streaks').name, 'Water');
});

test('transition gates input, base scoring and correctness stay private until answer review', () => {
  const f = fixture(), { game, racers, at, answer } = f;
  assert.equal(answer(racers[0]).type, 'error');
  at(game.round.startsAt + 5000); answer(racers[0]);
  const state = game.stateFor('player', racers[0]);
  assert.equal(state.question.correctIndex, undefined); assert.equal(state.player.score, 0); assert.equal(state.player.lastAnswerCorrect, null);
  assert.ok(!JSON.stringify(state).includes('Private'));
  answer(racers[1]); answer(racers[2], 0);
  assert.equal(game.reviewStage, 'answer'); assert.equal(racers[0].score, 875);
  assert.throws(() => game.beginQuestion(1), /reveals/);
  f.drain(); assert.equal(game.reviewStage, 'ready'); assert.equal(racers[0].score, 875);
  assert.ok(racers.every(p => p.inventory.length === 3 && new Set(p.inventory.map(i => i.type)).size === 3));
});

test('one five-second announcement per use, not batched; 30 powers consume no answer time', () => {
  const f = fixture({ players: 30 }); f.review();
  f.racers.forEach(p => assert.equal(f.use(p, 'whisper').type, 'ack'));
  f.game.beginQuestion(1);
  assert.equal(f.game.round.answerOpensAt - f.game.round.opensAt, 30 * 5000);
  assert.equal(f.game.round.endsAt - f.game.round.startsAt, 20000);
  f.at(f.game.round.opensAt);
  assert.equal(f.game.presentations.active.endsAt - f.game.presentations.active.startsAt, 5000);
  assert.equal(f.game.stateFor('host').presentation.remaining, 29);
  assert.equal(f.answer(f.racers[0]).type, 'error');
  f.at(f.game.presentations.active.endsAt);
  assert.equal(f.game.stateFor('host').presentation.casterId, f.racers[1].id);
  f.drain(); assert.equal(f.game.presentations.busy, false);
});

test('silent powers and their targets are absent from public state until AFTER answer review', () => {
  const f = fixture(); f.review();
  const [a, b, c] = f.racers;
  f.use(a, 'prediction', { targetId: b.id }); f.use(b, 'bill', { targetId: c.id }); f.use(c, 'reverse');
  assert.equal(f.game.stateFor('host').presentation, null);
  f.game.beginQuestion(1);
  const during = JSON.stringify(f.game.stateFor('host'));
  assert.ok(!during.includes('Prediction') && !during.includes('bill') && !during.includes('Uno Reverse'));
  f.open(); f.racers.forEach(p => f.answer(p));
  assert.equal(f.game.reviewStage, 'answer'); assert.equal(f.game.stateFor('host').presentation, null);
  f.at(f.game.round.reviewEndsAt);
  assert.equal(f.game.stateFor('host').presentation.name, 'Prediction');
  assert.equal(f.game.stateFor('host').presentation.description, catalog.find(i => i.id === 'prediction').description);
});

test('Cold Feet pauses clock, blocks rivals but allows its user to answer', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  f.use(a, 'freeze'); f.game.beginQuestion(1);
  f.at(f.game.round.answerOpensAt);
  assert.equal(f.game.round.startsAt - f.game.round.answerOpensAt, 3000);
  assert.equal(f.answer(a).type, 'ack'); assert.equal(f.answer(b).type, 'error');
  assert.equal(f.game.round.answers.get(a.id).elapsed, 0);
  f.at(f.game.round.startsAt); assert.equal(f.answer(b).type, 'ack');
});

test('Reverse transfers Cold Feet immunity to the reverser and freezes original caster', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers;
  f.use(a, 'freeze'); f.use(b, 'reverse'); f.game.beginQuestion(1);
  f.at(f.game.round.answerOpensAt);
  assert.equal(f.answer(a).type, 'error'); assert.equal(f.answer(b).type, 'ack'); assert.equal(f.answer(c).type, 'error');
});

test('Think Fast keeps ten answering seconds after every announcement and Cold Feet pause', () => {
  const f = fixture(); f.review();
  f.use(f.racers[0], 'ten-seconds'); f.use(f.racers[1], 'freeze'); f.game.beginQuestion(1);
  assert.equal(f.game.round.answerOpensAt - f.game.round.opensAt, 2 * timing.announcement);
  assert.equal(f.game.round.startsAt - f.game.round.answerOpensAt, timing.freeze);
  assert.equal(f.game.round.endsAt - f.game.round.startsAt, 10000);
  f.open(); f.at(f.game.round.endsAt);
  assert.equal(f.game.status, 'review');
});

test('Trust Them copies answer and server speed, not the target’s multiplied points', () => {
  const f = fixture({ randomInt: n => n - 1 }); f.review(); const [a, b, c] = f.racers; b.score = 5000;
  f.use(a, 'copycat'); f.use(b, 'double'); f.game.beginQuestion(1); f.open();
  f.at(f.game.round.startsAt + 4000); f.answer(b); f.at(f.game.round.startsAt + 10000); f.answer(c); f.drain();
  assert.equal(a.lastQuestionPoints, 900); assert.equal(b.lastQuestionPoints, 1800);
});

test('copy loops never recurse and missing originals refund the card', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers; a.score = 3000; b.score = 2000;
  f.use(a, 'copycat'); f.use(b, 'copycat'); f.game.beginQuestion(1); f.open(); f.answer(c); f.drain();
  assert.equal(a.lastQuestionPoints, 0); assert.ok(a.inventory.some(i => i.type === 'copycat'));
});

test('coin result remains hidden until owner flips; timeout and replay settle only once', () => {
  const f = fixture({ randomInt: n => n - 1 }); f.review(); const [a, b] = f.racers;
  f.use(a, 'double'); f.game.beginQuestion(1); f.open(); f.racers.forEach(p => f.answer(p));
  assert.equal(a.lastQuestionPoints, 1000);
  f.at(f.game.round.reviewEndsAt);
  const active = f.game.stateFor('host').presentation;
  assert.equal(active.mode, 'coin'); assert.deepEqual(active.data, {});
  assert.equal(f.command(b, { type: 'flip-coin', presentationId: active.id }).type, 'error');
  const message = { type: 'flip-coin', presentationId: active.id, requestId: 'same-flip' };
  assert.equal(f.command(a, message).type, 'ack'); assert.equal(f.command(a, message).type, 'ack');
  assert.equal(f.game.stateFor('host').presentation.data.heads, true);
  f.drain(); assert.equal(a.lastQuestionPoints, 2000); const score = a.score; f.game.tick(); assert.equal(a.score, score);
});

test('tails zeroes positive question points but preserves correct-answer streak', () => {
  const f = fixture(); f.review(); f.use(f.racers[0], 'double'); f.game.beginQuestion(1); f.review();
  assert.equal(f.racers[0].lastQuestionPoints, 0); assert.equal(f.racers[0].streak, 2);
});

test('a delayed tick never silently skips an interactive coin reveal', () => {
  const f = fixture(); f.review(); f.use(f.racers[0], 'double'); f.game.beginQuestion(1); f.open();
  f.racers.forEach(p => f.answer(p));
  f.at(f.game.round.reviewEndsAt + 30000);
  const entry = f.game.stateFor('host').presentation;
  assert.equal(entry.mode, 'coin'); assert.equal(entry.flipped, false);
  assert.equal(entry.endsAt - entry.startsAt, timing.coinWait);
  assert.equal(f.game.reviewStage, 'powers');
  f.drain(); assert.equal(f.game.reviewStage, 'ready');
});

test('siphon chains conserve signed points and show both racers in their reveal', () => {
  const f = fixture({ wrongPenalty: 100 }); f.review(); const [a, b, c] = f.racers;
  f.use(a, 'siphon', { targetId: b.id }); f.use(b, 'siphon', { targetId: c.id }); f.game.beginQuestion(1); f.review([1, 1, 0]);
  assert.deepEqual(f.racers.map(p => p.lastQuestionPoints), [1500, 450, -50]);
  const transfer = f.game.round.reveals.find(r => r.mode === 'transfer');
  assert.equal(transfer.data.sourceName, b.racerName); assert.equal(transfer.data.targetName, a.racerName); assert.equal(transfer.data.amount, 500);
});

test('targeted Siphon Points reflects without infinite reverse chains', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  f.use(a, 'siphon', { targetId: b.id }); f.use(b, 'reverse'); f.game.beginQuestion(1); f.review();
  assert.equal(a.lastQuestionPoints, 500); assert.equal(b.lastQuestionPoints, 1500);
  assert.equal(f.game.round.reversals.length, 1);
});

test("Walker's Weapon streams only to owner, no full answer preloaded", () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  f.use(a, 'whisper'); f.game.beginQuestion(1); f.open();
  f.at(f.game.round.startsAt + 700);
  assert.equal(f.game.stateFor('player', a).player.hint, 'The correct');
  assert.equal(f.game.stateFor('player', b).player.hint, '');
  const messages = []; f.game.onPrivate = (id, msg) => messages.push([id, msg]);
  f.at(f.game.round.startsAt + 1400);
  assert.equal(messages.length, 1); assert.equal(messages[0][0], a.id);
});

test('Hot Streak grants persistent phoenix, cash-in removes it and turns streak into points after five seconds', () => {
  const f = fixture(); f.review(); const [a] = f.racers;
  f.use(a, 'boost'); assert.equal(a.streakMultiplier, 1); f.drain();
  assert.equal(f.game.stateFor('player', a).player.streakIcon, '🐦‍🔥');
  f.game.beginQuestion(1); f.review(); assert.equal(a.streakMultiplier, 5);
  f.use(a, 'cash-out'); assert.equal(f.game.stateFor('host').presentation.data.bonus, 1000); assert.equal(a.streak, 2);
  f.drain(); assert.equal(a.score, 3000); assert.equal(a.streak, 0); assert.equal(a.streakMultiplier, 1);
});

test('a wrong answer kills the phoenix icon and multiplier', () => {
  const f = fixture(); f.review(); f.use(f.racers[0], 'boost'); f.drain(); f.game.beginQuestion(1); f.review([0, 1, 1]);
  assert.equal(f.racers[0].streak, 0); assert.equal(f.game.stateFor('player', f.racers[0]).player.streakIcon, '🔥');
});

test('Water preserves its caster’s streak; Reverse preserves reverser and extinguishes caster', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers;
  f.use(a, 'clear-streaks'); f.use(b, 'reverse'); f.game.beginQuestion(1); f.review();
  assert.equal(a.streak, 0); assert.equal(b.streak, 2); assert.equal(c.streak, 0);
  const g = fixture(); g.review(); g.use(g.racers[0], 'clear-streaks'); g.game.beginQuestion(1); g.review();
  assert.equal(g.racers[0].streak, 2);
});

test('200WPM doubles a correct answer at five seconds, not after or when wrong', () => {
  for (const [elapsed, index, expected] of [[5000, 1, 1750], [5001, 1, 875], [1000, 0, 0]]) {
    const f = fixture(); f.review(); f.use(f.racers[0], 'wpm'); f.game.beginQuestion(1); f.open();
    f.at(f.game.round.startsAt + elapsed); f.racers.forEach(p => f.answer(p, index)); f.drain();
    assert.equal(f.racers[0].lastQuestionPoints, expected);
  }
});

test('Sucker requires six wrong answers, not five; unanswered racers do not count', () => {
  for (const [wrong, expected] of [[5, 1000], [6, 2000]]) {
    const f = fixture({ players: 8 }); f.review(); f.use(f.racers[0], 'sucker'); f.game.beginQuestion(1);
    f.review([1, ...Array(wrong).fill(0), ...Array(7 - wrong).fill(1)]);
    assert.equal(f.racers[0].lastQuestionPoints, expected);
  }
  const f = fixture({ players: 8 }); f.review(); f.use(f.racers[0], 'sucker'); f.game.beginQuestion(1); f.open();
  f.answer(f.racers[0]); f.at(f.game.round.endsAt); f.drain(); assert.equal(f.racers[0].lastQuestionPoints, 1000);
});

test('Intern has exactly two equally likely branches; correct pays 1.5x and is not first manual answer', () => {
  for (const [randomInt, expected] of [[() => 0, 0], [n => n - 1, 1500]]) {
    const f = fixture({ randomInt }); f.review(); const [a, b] = f.racers;
    f.use(a, 'intern'); f.game.beginQuestion(1); f.review();
    assert.equal(a.lastQuestionPoints, expected); assert.equal(f.game.round.firstManual, b.id);
  }
});

test('personal Skip gives exactly 500, preserves streak, does not skip anyone else', () => {
  const f = fixture(); f.review(); const [a] = f.racers;
  f.use(a, 'personal-skip'); f.game.beginQuestion(1); f.open();
  assert.equal(f.game.status, 'question'); assert.equal(f.game.round.skipped, false);
  f.racers.slice(1).forEach(p => f.answer(p)); f.drain();
  assert.equal(a.lastQuestionPoints, 500); assert.equal(a.streak, 1); assert.equal(f.racers[1].streak, 2);
});

test('Hot Potato announces once at start, not every pass; final holder gets half question points', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  f.use(a, 'potato'); f.game.beginQuestion(1); f.open();
  assert.equal(f.game.round.potato.holderId, b.id);
  assert.equal(f.game.stateFor('host').potato, undefined);
  const message = { type: 'pass-potato', version: 0, requestId: 'same-pass' };
  assert.equal(f.command(b, message).type, 'ack'); assert.equal(f.command(b, message).type, 'ack');
  assert.equal(f.game.round.potato.version, 1); assert.equal(f.game.round.potato.holderId, a.id);
  assert.equal(f.game.stateFor('host').presentation, null);
  assert.equal(f.command(a, { type: 'pass-potato', version: 1 }).type, 'error');
  f.racers.forEach(p => f.answer(p)); f.drain();
  assert.equal(a.lastQuestionPoints, 500); assert.equal(b.lastQuestionPoints, 1000);
  assert.equal(f.game.round.reveals.filter(r => r.type === 'potato').length, 1);
});

test('Prediction doubles only its owner’s question points when correct', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers;
  f.use(a, 'prediction', { targetId: b.id }); f.game.beginQuestion(1); f.open();
  f.answer(b); f.answer(c); f.answer(a); f.drain();
  assert.equal(a.lastQuestionPoints, 2000); assert.equal(a.score, 3000);
});

test('Blue Shell penalizes first manual answer only, not first correct or automated answer', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers;
  f.use(a, 'blue-shell'); f.use(b, 'intern'); f.game.beginQuestion(1); f.open(); f.answer(c); f.answer(a); f.drain();
  assert.equal(c.lastQuestionPoints, 500); assert.equal(a.lastQuestionPoints, 1000);
});

test('Blue Shell can be reflected to its original user', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers;
  f.use(a, 'blue-shell'); f.use(b, 'reverse'); f.game.beginQuestion(1); f.open(); f.answer(b); f.answer(a); f.answer(c); f.drain();
  assert.equal(a.lastQuestionPoints, 500); assert.equal(b.lastQuestionPoints, 1000);
});

test('Bill actually removes answer text from targeted payload for five playable seconds, and can reverse', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  f.use(a, 'bill', { targetId: b.id }); f.use(b, 'reverse'); f.game.beginQuestion(1); f.open();
  assert.deepEqual(f.game.stateFor('player', a).question.choices, Array(4).fill('I miss Bill'));
  assert.equal(f.game.stateFor('player', b).question.choices[1], 'Beta');
  assert.equal(f.game.stateFor('host').presentation, null);
  f.at(f.game.round.answerOpensAt + 5000);
  assert.equal(f.game.stateFor('player', a).question.choices[1], 'Beta');
  f.racers.forEach(p => f.answer(p));
  assert.match(f.game.round.reveals.find(r => r.type === 'bill').data.detail, /Racer 00/);
});

test('Taxes transfers 100 per racer above caster, and reverse redirects an affected contribution', () => {
  const f = fixture(); f.review(); const [a, b, c] = f.racers; a.score = 100; b.score = 200; c.score = 300;
  f.use(a, 'taxes'); f.use(b, 'reverse'); f.game.beginQuestion(1); f.review();
  assert.equal(a.lastQuestionPoints, 1000); assert.equal(b.lastQuestionPoints, 1100); assert.equal(c.lastQuestionPoints, 900);
  assert.equal(f.racers.reduce((sum, p) => sum + p.lastQuestionPoints, 0), 3000);
});

test('Ribbit masks only the next leaderboard, preserves identity and ends on the following question', () => {
  const f = fixture(); f.review(); f.use(f.racers[0], 'ribbit'); f.game.beginQuestion(1); f.review();
  assert.equal(f.game.stateFor('host').frogLeaderboard, true);
  assert.equal(f.game.stateFor('host').players[0].racerName, 'Racer 00');
  f.game.beginQuestion(2); assert.equal(f.game.stateFor('host').frogLeaderboard, false);
});

test('Participation Trophy changes podium ordering, not points, official standings or exported rank', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers; a.score = 5; b.score = 4000;
  f.use(a, 'trophy'); assert.equal(f.game.podiumOwner, null); f.drain(); f.game.finish();
  const state = f.game.stateFor('host'); assert.equal(state.podiumPlayers[0].id, a.id); assert.equal(state.players[0].id, b.id);
  assert.equal(state.podiumPlayers[0].score, 5); assert.ok(f.game.results.split('\n')[0].includes(b.racerName));
});

test('blackjack is owner-controlled, publicly visible with hidden dealer hole; blocks Next and auto-stands', () => {
  const f = fixture({ randomInt: n => n - 1 }); f.review(); const [a, b] = f.racers;
  assert.equal(f.use(a, 'blackjack', { amount: 100 }).type, 'ack');
  const host = f.game.stateFor('host');
  assert.equal(host.presentation.mode, 'casino'); assert.equal(host.presentation.hand.dealer[1], null); assert.equal(a.score, 900);
  assert.equal(host.canAdvance, false); assert.throws(() => f.game.beginQuestion(1), /reveals/);
  assert.equal(f.command(b, { type: 'blackjack', handId: a.hand.id, move: 'stand' }).type, 'error');
  a.connected = false; f.at(a.hand.expiresAt); assert.notEqual(a.hand.status, 'playing'); f.drain();
  assert.equal(f.game.reviewStage, 'ready');
});

test('blackjack wager validation, duplicate hit protection, ace scoring and soft 17', () => {
  const f = fixture({ randomInt: n => n - 1 }); f.review(); const [a] = f.racers;
  for (const amount of [-1, 0, 1001, 1.5, '100']) assert.equal(f.use(a, 'blackjack', { amount }).type, 'error');
  f.use(a, 'blackjack', { amount: 100 }); a.hand.player = [{ rank: '2', suit: '♠' }, { rank: '2', suit: '♣' }];
  const hit = { type: 'blackjack', handId: a.hand.id, move: 'hit', requestId: 'same-hit' }; f.command(a, hit); f.command(a, hit); assert.equal(a.hand.player.length, 3);
  const cards = ranks => ranks.map(rank => ({ rank, suit: '♣' }));
  assert.equal(blackjack.value(cards(['A', 'A', '9'])), 21);
  const hand = { status: 'playing', player: cards(['10', '7']), dealer: cards(['A', '6']), deck: cards(['10']), wager: 100 };
  assert.equal(blackjack.settle(hand), 100); assert.equal(hand.dealer.length, 2); assert.equal(blackjack.settle(hand), 0);
});

test('Nope! refunds other powers, preserves streaks, announces before skipping final question', () => {
  const f = fixture({ count: 2 }); f.review(); const [a, b] = f.racers;
  f.use(a, 'skip'); f.use(b, 'double'); f.game.beginQuestion(1);
  assert.equal(f.game.status, 'question'); f.at(f.game.round.opensAt); assert.equal(f.game.stateFor('host').presentation.name, 'Nope!');
  f.drain(); assert.equal(f.game.status, 'finished'); assert.equal(a.streak, 1); assert.equal(a.score, 1000);
  assert.ok(b.inventory.some(i => i.type === 'double'));
});

test('round/game IDs, one use per review, and idempotent requests reject stale or forged actions', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  assert.equal(f.use(a, 'prediction', { targetId: a.id }).type, 'error');
  const slot = f.give(a, 'prediction'); const m = { type: 'use-item', itemId: slot.id, targetId: b.id, requestId: 'same-use' };
  assert.equal(f.command(a, m).type, 'ack'); assert.equal(f.command(a, m).type, 'ack');
  assert.equal(f.use(a, 'double').type, 'error');
  assert.equal(f.command(a, { type: 'answer', answerIndex: 1, roundId: 'old' }).type, 'error');
  assert.equal(f.command(a, { type: 'answer', answerIndex: 1, gameId: 'old' }).type, 'error');
});

test('duplicate global effects and shared one-use items cannot stack; exhausted copies replace themselves', () => {
  const f = fixture(); f.review(); const [a, b] = f.racers;
  assert.equal(f.use(a, 'freeze').type, 'ack'); assert.equal(f.use(b, 'freeze').type, 'error');
  const g = fixture(); g.review(); g.give(g.racers[1], 'skip'); g.use(g.racers[0], 'skip');
  assert.ok(!g.racers[1].inventory.some(i => i.type === 'skip'));
  assert.equal(g.use(g.racers[1], 'skip').type, 'error');
});

test('late joins wait for next round, reconnect preserves state and reset clears presentations and secrets', () => {
  const f = fixture(); const [a] = f.racers; a.connected = false;
  assert.equal(f.game.join({ sessionId: a.token, resumeOnly: true }), a);
  assert.throws(() => f.game.join({ sessionId: a.id, resumeOnly: true }), /restarted/);
  const late = f.game.join({ firstName: 'Late', racerName: 'Late' }); f.open();
  assert.equal(f.answer(late).type, 'error');
  f.review(); f.use(a, 'boost'); assert.equal(f.game.presentations.busy, true);
  f.game.reset(); assert.equal(f.game.presentations.busy, false); assert.equal(f.game.players.size, 0);
  assert.throws(() => f.game.join({ sessionId: a.token, resumeOnly: true }), /restarted/);
});

test('final normal question keeps countdown and final review allows instant powers only', () => {
  const f = fixture({ count: 2 }); f.review(); f.game.beginQuestion(1);
  assert.equal(f.game.round.opensAt - f.game.transitionAt, timing.cover + timing.countdown + timing.reveal);
  f.review(); assert.equal(f.use(f.racers[0], 'double').type, 'error'); assert.equal(f.use(f.racers[0], 'cash-out').type, 'ack'); f.drain();
  f.game.beginQuestion(2); f.game.finish(); assert.equal(f.finishCount(), 1);
  assert.ok(f.game.stateFor('host').players.every(p => p.firstName));
});
