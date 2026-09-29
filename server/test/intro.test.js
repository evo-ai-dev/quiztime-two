'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../game');
const timing = require('../../shared/timing.json');
const { catalog } = require('../items');
const { hostDescription } = require('../items/host-description');

function fixture(itemType) {
  let now = 10000, sequence = 0;
  const game = new Game({ questions: [{ prompt: 'HOST ONLY QUESTION', choices: ['A', 'B', 'C', 'D'], answerIndex: 1 }], seconds: 20,
    now: () => now, id: () => `id-${++sequence}`, randomInt: () => 0 });
  const player = game.join({ firstName: 'Private', racerName: 'Lily' });
  const rival = game.join({ firstName: 'Secret', racerName: 'Moon' });
  game.beginQuestion(0);
  const at = value => { assert.notEqual(value, null); now = Math.max(now, value); game.tick(); };
  const command = (who, data) => game.command(who, { gameId: game.idValue, roundId: game.round.id, requestId: `request-${++sequence}`, ...data });
  const use = (who, type, data = {}) => { who.inventory = [{ id: `card-${++sequence}`, type }]; return command(who, { type: 'use-item', itemId: who.inventory[0].id, ...data }); };
  const ready = () => at(game.round.intro.previewAt + timing.pan);
  const start = () => game.hostAction({ type: 'start-countdown', gameId: game.idValue, roundId: game.round.id });
  if (itemType) { ready(); assert.equal(use(player, itemType).type, 'ack'); }
  return { game, player, rival, at, ready, start, command, use, answer: () => command(player, { type: 'answer', answerIndex: 1 }) };
}

test('preview holds indefinitely; only host Space starts synchronized 3, 2, 1, fade, mask', async () => {
  const { introFrame } = await import('../../src/components/intro-timeline.mjs');
  const f = fixture(), intro = f.game.round.intro;
  assert.equal(introFrame(intro, intro.startAt).cover, 0);
  assert.equal(intro.coveredAt - intro.startAt, timing.cover);
  f.at(intro.previewAt + 60000);
  assert.equal(f.game.status, 'question');
  assert.equal(f.game.round.startsAt, null); assert.equal(f.game.round.endsAt, null);
  assert.equal(f.game.round.autoDone, false); assert.equal(f.game.stateFor('host').canAdvance, false);
  assert.equal(introFrame(intro, f.game.now()).waiting, true);
  assert.equal(f.answer().type, 'error'); assert.throws(() => f.game.endQuestion(), /countdown/);
  assert.equal(f.command(f.player, { type: 'start-countdown' }).type, 'error');
  assert.equal(intro.countdownAt, null);
  f.start();
  assert.deepEqual(f.game.stateFor('host').intro, f.game.stateFor('player', f.player).intro);
  assert.equal(intro.previewEndsAt - intro.countdownAt, 3000);
  assert.equal(intro.revealAt - intro.previewEndsAt, timing.previewFade);
  assert.equal(intro.endsAt - intro.revealAt, timing.reveal);
  assert.equal(introFrame(intro, intro.countdownAt - 1).count, 0);
  for (let i = 0; i < 3; i++) {
    const frame = introFrame(intro, intro.countdownAt + i * 1000);
    assert.equal(frame.phase, 'preview'); assert.equal(frame.count, 3 - i); assert.equal(frame.second, 0);
  }
  assert.equal(introFrame(intro, intro.revealAt).mask, 0);
  assert.equal(introFrame(intro, intro.endsAt).phase, 'done');
  f.at(intro.endsAt - 1); assert.equal(f.answer().type, 'error');
  f.at(intro.endsAt); assert.equal(f.answer().type, 'ack');
  assert.equal(f.game.round.endsAt - f.game.round.startsAt, 20000);
});

test('early/stale Space cannot start; repeated Space cannot restart the timer', () => {
  const f = fixture();
  assert.throws(f.start, /Wait for/);
  f.ready();
  f.game.hostAction({ type: 'start-countdown', gameId: f.game.idValue, roundId: 'old' });
  assert.equal(f.game.round.intro.countdownAt, null);
  f.start(); const original = { ...f.game.round.intro };
  f.at(original.countdownAt + 1100); f.start();
  assert.deepEqual(f.game.round.intro, original);
  assert.equal(f.use(f.player, 'sucker').type, 'error');
});

test('first and last question has a backpack; items affect current round, never armed for later', () => {
  const f = fixture();
  assert.equal(f.player.inventory.length, 3);
  assert.equal(f.use(f.player, 'sucker').type, 'error');
  f.ready();
  assert.equal(f.use(f.player, 'sucker').type, 'ack');
  assert.equal(f.game.round.items.get(f.player.id).type, 'sucker');
  assert.equal(f.game.stateFor('player', f.player).player.activeItem, 'sucker');
  assert.equal(f.player.armed, undefined);
  assert.equal(f.game.stateFor('host').presentation.name, 'Sucker');
  assert.throws(f.start, /announcements/);
  assert.equal(f.use(f.player, 'double').type, 'error');
  f.ready(); f.start();
  assert.equal(f.use(f.rival, 'reverse').type, 'error');
});

test('concurrent loud uses each get five seconds; item window remains open during spotlights', () => {
  const f = fixture('sucker'), first = f.game.presentations.active;
  assert.equal(f.use(f.rival, 'whisper').type, 'ack');
  assert.equal(f.game.presentations.active.id, first.id);
  assert.equal(f.game.presentations.entries.length, 1);
  assert.equal(f.game.round.intro.previewAt, first.startsAt + 2 * timing.announcement);
  f.at(first.endsAt);
  assert.equal(f.game.stateFor('host').presentation.name, "Walker's Weapon");
  assert.equal(f.game.stateFor('player', f.rival).player.hint, '');
  f.ready();
  assert.equal(f.game.presentations.busy, false); assert.equal(f.game.round.startsAt, null);
  f.start();
});

test('question prompts and host narration never enter player payloads, including reconnect/review', () => {
  const f = fixture('sucker');
  const host = f.game.stateFor('host'), player = f.game.stateFor('player', f.player);
  assert.equal(host.question.prompt, 'HOST ONLY QUESTION');
  assert.match(host.presentation.hostDescription, /If 6 or more people.*Lily.*double question points/);
  assert.equal(player.presentation.hostDescription, undefined);
  assert.ok(!JSON.stringify(player).includes('HOST ONLY QUESTION'));
  const returned = f.game.join({ sessionId: f.player.token, resumeOnly: true });
  assert.equal(f.game.stateFor('player', returned).player.activeItem, 'sucker');
  assert.equal(f.game.stateFor('player', returned).intro.countdownAt, null);
  f.ready(); f.start(); f.at(f.game.round.intro.countdownAt + 1200);
  assert.deepEqual(f.game.stateFor('player', returned).intro, f.game.stateFor('host').intro);
  f.at(f.game.round.endsAt);
  assert.equal(f.game.stateFor('player', f.player).question.prompt, undefined);
});

test('silent powers do not announce or extend the green intro, including trophy', () => {
  for (const type of ['ribbit', 'reverse', 'trophy']) {
    const f = fixture(type);
    assert.equal(f.game.round.intro.previewAt, f.game.round.intro.coveredAt);
    assert.equal(f.game.stateFor('host').presentation, null);
    assert.equal(f.game.podiumOwner, null);
    assert.ok(!JSON.stringify(f.game.stateFor('player', f.rival)).includes(type));
  }
});

test('late participants cannot use or target items; reset clears the waiting phase', () => {
  const f = fixture(); f.ready();
  const late = f.game.join({ firstName: 'Late', racerName: 'Late racer' });
  assert.equal(f.use(late, 'double').type, 'error');
  assert.equal(f.use(f.player, 'siphon', { targetId: late.id }).type, 'error');
  assert.equal(f.use(f.player, 'siphon', { targetId: f.rival.id }).type, 'ack');
  f.game.reset(); f.game.tick();
  assert.equal(f.game.stateFor('host').intro, null); assert.equal(f.game.presentations.busy, false);
});

test('no-power rounds immediately preview; final leaderboard has no preview or countdown', async () => {
  const { introFrame } = await import('../../src/components/intro-timeline.mjs');
  const f = fixture(), intro = f.game.round.intro;
  assert.equal(intro.previewAt, intro.coveredAt);
  assert.equal(introFrame(intro, intro.coveredAt).phase, 'preview');
  const final = { startAt: 0, coveredAt: 1500, previewAt: 1500, previewEndsAt: 1500, revealAt: 1500, endsAt: 2700 };
  assert.equal(introFrame(final, 1500).phase, 'reveal');
});

test('every power has tailored host narration and pans from/below center on server time', async () => {
  const { powerPan } = await import('../../src/components/intro-timeline.mjs');
  for (const item of catalog) assert.ok(hostDescription(item.id, 'Lily', 'Moon').includes('Lily'), item.id);
  const event = { startsAt: 1000, endsAt: 6000 };
  assert.equal(powerPan(event, 1000, 500).transform, 'translateY(100vh)');
  assert.equal(powerPan(event, 1500, 500).transform, 'translateY(0vh)');
  assert.equal(powerPan(event, 6000, 500).transform, 'translateY(100vh)');
});
