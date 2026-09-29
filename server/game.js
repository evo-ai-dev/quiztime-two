'use strict';

const crypto = require('node:crypto');
const timing = require('../shared/timing.json');
const { handlers, byId } = require('./items');
const { fillInventory, validate, applyCommands } = require('./items/engine');
const { prepareAttacks, reflect } = require('./items/attacks');
const { settleRound, commitRound } = require('./settlement');
const { Presentations } = require('./presentations');
const blackjack = require('./items/blackjack');

const cleanName = value => String(value || '').replace(/[|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
const automated = new Set(['copycat', 'intern', 'personal-skip']);

class Game {
  constructor({ questions, seconds = 20, questionFile = 'questions.txt', wrongPenalty = 0, now = Date.now, randomInt = crypto.randomInt, id = crypto.randomUUID, onChange = () => {}, onFinish = () => {}, onPrivate = () => {} }) {
    Object.assign(this, { questions, seconds, questionFile, wrongPenalty, now, randomInt, id, onChange, onFinish, onPrivate });
    this.players = new Map();
    this.presentations = new Presentations();
    this.reset();
  }

  reset() {
    this.players.clear(); this.presentations.clear();
    this.idValue = this.id(); this.status = 'lobby'; this.reviewStage = null;
    this.index = -1; this.round = null; this.transitionAt = null;
    this.itemUses = {}; this.results = ''; this.activationOrder = 0; this.podiumOwner = null;
    this.onChange();
  }

  join({ firstName, racerName, sessionId, resumeOnly }) {
    if (sessionId) {
      const previous = [...this.players.values()].find(player => player.token === sessionId);
      if (previous) { previous.connected = true; return previous; }
    }
    if (resumeOnly) throw new Error('This game restarted. Please join again.');
    if (this.status === 'finished') throw new Error('This race is over. Ask the host to open a new lobby.');
    if (this.players.size >= 100) throw new Error('This lobby is full (100 racers).');
    if (!cleanName(firstName) || !cleanName(racerName)) throw new Error('Enter both names.');
    const player = {
      id: this.id(), token: this.id(), firstName: cleanName(firstName), racerName: cleanName(racerName),
      connected: true, score: 0, streak: 0, streakMultiplier: 1, inventory: [], armed: null,
      usedItemRound: null, answerIndex: null, lastAnswerCorrect: null, lastQuestionPoints: 0,
      reviewAdjustment: 0, requests: new Map(), hand: null, attentionAt: 0, breakdown: null
    };
    this.players.set(player.id, player);
    if (this.status === 'review' && this.reviewStage === 'ready') this.refill(player);
    return player;
  }

  sorted() { return [...this.players.values()].sort((a, b) => b.score - a.score || a.racerName.localeCompare(b.racerName) || a.id.localeCompare(b.id)); }
  itemName(type) { return byId[type].name; }
  refund(player, item) {
    if (player && !player.inventory.some(slot => slot.id === item.id) && player.inventory.length < 3) player.inventory.push({ id: item.id, type: item.type });
  }
  busyHands() { return [...this.players.values()].filter(player => player.hand?.status === 'playing').length; }

  refill(player, size = 3) {
    const excluded = Object.keys(this.itemUses).filter(type => byId[type].maxUsesPerGame && this.itemUses[type] >= byId[type].maxUsesPerGame);
    fillInventory(player, this.randomInt, this.id, { excluded, size });
  }

  makePresentation(casterId, type, phase, data = {}, mode = 'announcement') {
    const meta = byId[type];
    return { id: this.id(), type, name: meta.name, emoji: meta.emoji, description: meta.description,
      casterId, casterName: this.players.get(casterId)?.racerName || 'Racer', phase, mode, data,
      duration: mode === 'coin' ? timing.coinWait : timing.announcement };
  }

  beginQuestion(index) {
    if (this.presentations.busy || this.busyHands() || (this.status === 'review' && this.reviewStage !== 'ready')) throw new Error('Wait for the power-up reveals to finish.');
    if (index >= this.questions.length) return this.finish();
    this.index = index; this.status = 'question'; this.reviewStage = null;
    this.transitionAt = this.now() + timing.lead;
    const opensAt = this.transitionAt + timing.cover + timing.countdown + timing.reveal;
    const participants = new Set([...this.players.values()].filter(p => p.connected || p.armed).map(p => p.id));
    const startRanks = new Map(this.sorted().map((p, i) => [p.id, i + 1]));
    const items = new Map([...this.players.values()].filter(p => p.armed).sort((a, b) => a.armed.order - b.armed.order).map(p => [p.id, { ...p.armed }]));
    for (const player of this.players.values()) {
      player.answerIndex = null; player.lastAnswerCorrect = null; player.lastQuestionPoints = 0;
      player.reviewAdjustment = 0; player.breakdown = null; player.hand = null; player.armed = null;
      if (items.get(player.id)?.type === 'copycat') items.get(player.id).targetId = this.sorted().find(p => p.id !== player.id && participants.has(p.id))?.id;
    }
    const effects = new Set([...items.values()].map(item => handlers[item.type].roundEffect).filter(Boolean));
    const skipped = effects.has('skip');
    const loud = [...items].filter(([, item]) => skipped ? item.type === 'skip' : byId[item.type].visibility === 'loud');
    const announcements = loud.map(([id, item]) => this.makePresentation(id, item.type, 'activation'));
    const answerOpensAt = opensAt + announcements.length * timing.announcement;
    const duration = (effects.has('ten-seconds') ? handlers['ten-seconds'].seconds : this.seconds) * 1000;
    const startsAt = answerOpensAt + (!skipped && effects.has('freeze') ? timing.freeze : 0);
    this.round = { id: this.id(), participants, startRanks, items, answers: new Map(), duration, opensAt, answerOpensAt, startsAt,
      endsAt: startsAt + duration, effects, hintCounts: new Map(), skipped, reverseCharges: new Set([...items].filter(([, item]) => item.type === 'reverse').map(([id]) => id)),
      reversals: [], frozen: new Set(), billTargets: new Set(), potato: null, firstManual: null, autoDone: false, committed: false, frogLeaderboard: false };
    if (!skipped) prepareAttacks(this);
    this.presentations.start(announcements, opensAt, () => {
      if (!skipped) return;
      for (const [id, item] of items) if (item.type !== 'skip') this.refund(this.players.get(id), item);
      this.status = 'review'; this.reviewStage = 'ready'; this.transitionAt = null;
      for (const player of this.players.values()) this.refill(player);
      if (index === this.questions.length - 1) this.finish();
    });
    this.onChange();
  }

  endQuestion() {
    if (this.status !== 'question') return;
    if (this.presentations.busy || this.now() < this.round.answerOpensAt) throw new Error('Let the countdown and announcements finish first.');
    this.runAutomaticAnswers();
    this.round.reveals = settleRound(this);
    this.status = 'review'; this.reviewStage = 'answer';
    this.round.reviewEndsAt = this.now() + timing.answerReview;
    this.transitionAt = null;
    this.onChange();
  }

  finishReview() {
    commitRound(this);
    this.reviewStage = 'ready';
    for (const player of this.players.values()) this.refill(player);
  }

  finish() {
    if (this.status === 'finished') return;
    if (this.presentations.busy || this.busyHands()) throw new Error('Finish the power-up reveals first.');
    this.status = 'finished'; this.reviewStage = 'ready';
    this.transitionAt = this.now() + timing.lead;
    const date = new Date(this.now()).toISOString();
    this.results = this.sorted().map((p, i) => `${date} | ${i + 1} | ${p.firstName} | ${p.racerName} | ${p.score}`).join('\n') + '\n';
    this.onFinish(this.results); this.onChange();
  }

  hostAction(message) {
    if (message.gameId !== this.idValue) throw new Error('Refresh the host: this game has changed.');
    if (message.type === 'reset') { this.reset(); return; }
    if (message.type === 'start' && this.status === 'lobby') this.beginQuestion(0);
    if (message.type === 'next' && this.status === 'review' && message.roundId === this.round.id) this.beginQuestion(this.index + 1);
    if (message.type === 'end-question' && message.roundId === this.round?.id) this.endQuestion();
  }

  runAutomaticAnswers() {
    const round = this.round;
    if (round.autoDone || this.now() < round.startsAt) return;
    round.autoDone = true;
    for (const [id, item] of round.items) {
      if (item.type === 'intern') round.answers.set(id, { index: handlers.intern.answer(this.questions[this.index].answerIndex, this.randomInt), elapsed: 0, automatic: true });
      if (item.type === 'personal-skip') round.answers.set(id, { index: null, elapsed: 0, automatic: true });
    }
  }

  maybeEnd() {
    const round = this.round;
    if (this.status !== 'question' || !round.autoDone || this.presentations.busy) return false;
    const manual = [...round.participants].filter(id => !automated.has(round.items.get(id)?.type));
    if (round.participants.size && manual.every(id => round.answers.has(id))) { this.endQuestion(); return true; }
    return false;
  }

  answer(player, message) {
    const round = this.round, now = this.now();
    if (message.gameId !== this.idValue || message.roundId !== round?.id || this.status !== 'question') throw new Error('This question has ended.');
    if (!round.participants.has(player.id)) throw new Error('You joined mid-question. You’re in for the next one.');
    if (round.answers.has(player.id)) return;
    if (automated.has(round.items.get(player.id)?.type)) throw new Error('Your power-up is answering for you.');
    const unlockAt = round.frozen.has(player.id) ? round.startsAt : round.answerOpensAt;
    if (this.presentations.busy || now < unlockAt || now >= round.endsAt) throw new Error(now >= round.endsAt ? 'Time’s up!' : 'Wait for your answers to unlock.');
    if (!Number.isInteger(message.answerIndex) || message.answerIndex < 0 || message.answerIndex > 3) throw new Error('Choose a valid answer.');
    this.runAutomaticAnswers();
    round.answers.set(player.id, { index: message.answerIndex, elapsed: Math.max(0, now - round.startsAt), automatic: false });
    round.firstManual ||= player.id;
    player.answerIndex = message.answerIndex;
    if (!this.maybeEnd()) this.onChange();
  }

  passPotato(player, message) {
    const round = this.round, potato = round?.potato, now = this.now();
    if (this.status !== 'question' || message.roundId !== round?.id || !potato || potato.holderId !== player.id || message.version !== potato.version) throw new Error('That potato is no longer yours.');
    if (this.presentations.busy || now < round.startsAt || now < potato.nextPassAt || now >= round.endsAt) throw new Error('The potato cannot be passed right now.');
    const candidates = [...round.participants].filter(id => id !== player.id && this.players.get(id)?.connected);
    if (!candidates.length) throw new Error('No connected racer to pass to.');
    const recipient = candidates[this.randomInt(candidates.length)];
    const attack = reflect(this, player.id, recipient, 'potato');
    potato.holderId = attack.targetId; potato.version++; potato.nextPassAt = now + timing.potatoCooldown;
    // No public announcement per pass. Only the holder receives a tappable potato.
    this.onChange();
  }

  useItem(player, message) {
    const error = validate(this, player, message); if (error) throw new Error(error);
    const slot = player.inventory.find(item => item.id === message.itemId);
    player.inventory = player.inventory.filter(item => item.id !== slot.id); player.usedItemRound = this.round.id;
    this.itemUses[slot.type] = (this.itemUses[slot.type] || 0) + 1;
    if (byId[slot.type].maxUsesPerGame && this.itemUses[slot.type] >= byId[slot.type].maxUsesPerGame) {
      for (const other of this.players.values()) {
        const size = other.inventory.length; other.inventory = other.inventory.filter(item => item.type !== slot.type); this.refill(other, size);
      }
    }
    if (byId[slot.type].kind === 'next') {
      player.armed = { ...slot, order: ++this.activationOrder, ...(message.targetId ? { targetId: message.targetId } : {}) };
    } else {
      let presentation;
      if (slot.type === 'blackjack') {
        presentation = this.makePresentation(player.id, slot.type, 'result', {}, 'casino');
        presentation.duration = timing.blackjack;
        presentation.start = active => {
          player.score -= message.amount; player.reviewAdjustment -= message.amount;
          player.hand = blackjack.createHand(message.amount, this.randomInt, this.id(), active.startsAt + timing.blackjack);
          if (blackjack.value(player.hand.player) === 21 || blackjack.value(player.hand.dealer) === 21) this.settleHand(player);
        };
      } else if (slot.type === 'trophy') {
        presentation = this.makePresentation(player.id, slot.type, 'result', { detail: 'First place on the podium. Actual score unchanged.' });
        presentation.complete = () => { this.podiumOwner = player.id; };
      } else {
        const bonus = 100 * player.streak * player.streakMultiplier;
        presentation = this.makePresentation(player.id, slot.type, 'result',
          slot.type === 'cash-out' ? { beforeStreak: player.streak, multiplier: player.streakMultiplier, bonus, before: player.score, after: player.score + bonus } :
            { detail: 'Phoenix streak equipped', multiplier: player.streakMultiplier * 5 });
        const commands = handlers[slot.type].commands(player, [...this.players.values()]);
        presentation.complete = () => applyCommands(this, commands);
      }
      this.reviewStage = 'powers';
      this.presentations.start([presentation], this.now(), () => { this.reviewStage = 'ready'; });
      this.presentations.tick(this.now());
    }
    this.onChange();
  }

  settleHand(player) {
    if (player.hand?.status !== 'playing') return;
    const payout = blackjack.settle(player.hand); player.score += payout; player.reviewAdjustment += payout;
    if (this.presentations.active?.mode === 'casino') this.presentations.active.endsAt = this.now() + timing.interactiveResult;
  }

  playHand(player, message) {
    const hand = player.hand, active = this.presentations.active;
    if (this.status !== 'review' || message.roundId !== this.round?.id || active?.mode !== 'casino' || active.casterId !== player.id || !hand || message.handId !== hand.id || hand.status !== 'playing') throw new Error('That hand has already ended.');
    if (!['hit', 'stand'].includes(message.move)) throw new Error('Choose hit or stand.');
    if (this.now() >= hand.expiresAt) this.settleHand(player);
    else {
      if (message.move === 'hit') hand.player.push(hand.deck.pop());
      if (message.move === 'stand' || blackjack.value(hand.player) >= 21) this.settleHand(player);
    }
    this.onChange();
  }

  flipCoin(player, message) {
    const active = this.presentations.active;
    if (active?.mode !== 'coin' || active.casterId !== player.id || message.presentationId !== active.id || message.roundId !== this.round?.id || active.flipped) throw new Error('That coin is no longer waiting to flip.');
    active.flipped = true; active.endsAt = this.now() + timing.interactiveResult;
    this.onChange();
  }

  command(player, message) {
    if (!message.requestId || typeof message.requestId !== 'string' || message.requestId.length > 80) return { type: 'error', message: 'Missing request ID.' };
    if (player.requests.has(message.requestId)) return player.requests.get(message.requestId);
    let response;
    try {
      if (message.gameId !== this.idValue) throw new Error('This game has restarted.');
      if (message.type === 'answer') this.answer(player, message);
      else if (message.type === 'use-item') this.useItem(player, message);
      else if (message.type === 'blackjack') this.playHand(player, message);
      else if (message.type === 'pass-potato') this.passPotato(player, message);
      else if (message.type === 'flip-coin') this.flipCoin(player, message);
      else throw new Error('Unknown action.');
      response = { type: 'ack', requestId: message.requestId };
    } catch (error) { response = { type: 'error', requestId: message.requestId, action: message.type, message: error.message }; }
    player.requests.set(message.requestId, response);
    if (player.requests.size > 64) player.requests.delete(player.requests.keys().next().value);
    return response;
  }

  tick() {
    const now = this.now();
    let changed = false;
    const active = this.presentations.active;
    if (active?.mode === 'coin' && !active.flipped && now >= active.endsAt) { active.flipped = true; active.endsAt = now + timing.interactiveResult; changed = true; }
    for (const player of this.players.values()) if (player.hand?.status === 'playing' && now >= player.hand.expiresAt) { this.settleHand(player); changed = true; }
    changed = this.presentations.tick(now) || changed;
    if (this.status === 'question' && !this.round.skipped) {
      const round = this.round;
      if (!round.liveBroadcast && now >= round.answerOpensAt) { round.liveBroadcast = true; changed = true; }
      if (!round.billExpired && now >= round.answerOpensAt + timing.bill) { round.billExpired = true; changed = true; }
      if (!round.autoDone && now >= round.startsAt) { this.runAutomaticAnswers(); changed = true; }
      if (now >= round.endsAt && !this.presentations.busy) return this.endQuestion();
      if (this.maybeEnd()) return;
      for (const [id, item] of round.items) {
        if (item.type !== 'whisper' || now < round.startsAt) continue;
        const text = this.hintFor(id);
        if (round.hintCounts.get(id) !== text.length) {
          round.hintCounts.set(id, text.length); this.onPrivate(id, { type: 'hint', roundId: round.id, text });
        }
      }
    }
    if (this.status === 'review' && this.reviewStage === 'answer' && now >= this.round.reviewEndsAt) {
      this.reviewStage = 'powers';
      this.presentations.start(this.round.reveals, this.round.reviewEndsAt, () => this.finishReview());
      this.presentations.tick(now); changed = true;
    }
    if (changed) this.onChange();
  }

  hintFor(id) {
    if (this.status !== 'question' || this.round.items.get(id)?.type !== 'whisper') return '';
    const count = Math.max(0, Math.floor((this.now() - this.round.startsAt) / 350));
    const question = this.questions[this.index];
    return handlers.whisper.words(question.choices[question.answerIndex]).slice(0, count).join(' ');
  }

  stateFor(role, own) {
    const round = this.round, question = this.questions[this.index], now = this.now();
    const reviewing = this.status === 'review' || this.status === 'finished';
    const players = this.sorted().map((p, i) => ({
      id: p.id, racerName: p.racerName, score: p.score, streak: p.streak, streakMultiplier: p.streakMultiplier,
      streakIcon: p.streakMultiplier > 1 && p.streak ? '🐦‍🔥' : '🔥',
      connected: p.connected, answered: round?.answers.has(p.id) || false,
      rankChange: reviewing && round?.startRanks.has(p.id) ? round.startRanks.get(p.id) - i - 1 : 0,
      ...(this.status === 'finished' ? { firstName: p.firstName } : {})
    }));
    const self = own ? players.find(p => p.id === own.id) : null;
    const presentation = this.presentations.public();
    if (presentation?.mode === 'casino') presentation.hand = blackjack.publicHand(this.players.get(presentation.casterId)?.hand);
    const bill = this.status === 'question' && own && round.billTargets.has(own.id) && now < round.answerOpensAt + timing.bill;
    const potato = round?.potato;
    return {
      gameId: this.idValue, roundId: round?.id, status: this.status, reviewStage: this.reviewStage,
      scoresPending: this.status === 'review' && !round?.committed && !!round?.reveals?.length,
      questionNumber: this.index + 1, totalQuestions: this.questions.length,
      questionSeconds: (round?.duration || this.seconds * 1000) / 1000,
      questionStartedAt: round?.startsAt, questionEndsAt: this.status === 'question' ? round.endsAt : null,
      answerOpensAt: round?.answerOpensAt, opensAt: round?.opensAt, transitionAt: this.transitionAt, serverTime: now,
      questionFile: this.questionFile, skipped: round?.skipped || false, busyHands: this.busyHands(),
      presentation, presentationBusy: this.presentations.busy,
      reviewEndsAt: this.reviewStage === 'answer' ? round.reviewEndsAt : null,
      canAdvance: !this.presentations.busy && (this.status === 'lobby' || this.status === 'finished' || this.status === 'review' && this.reviewStage === 'ready' || this.status === 'question' && now >= round.answerOpensAt),
      frogLeaderboard: !!round?.frogLeaderboard,
      question: question ? { prompt: question.prompt, choices: bill ? question.choices.map(() => handlers.bill.text) : question.choices,
        ...(reviewing && !round.skipped || role === 'host' ? { correctIndex: question.answerIndex } : {}) } : null,
      answeredCount: round?.answers.size || 0, connectedCount: round?.participants.size ?? players.filter(p => p.connected).length,
      players,
      podiumPlayers: this.status === 'finished' ? [...players].sort((a, b) => Number(b.id === this.podiumOwner) - Number(a.id === this.podiumOwner)).slice(0, 3) : [],
      player: self ? { ...self, answerIndex: own.answerIndex, inventory: own.inventory, armed: own.armed,
        usedItemRound: own.usedItemRound, hand: blackjack.publicHand(own.hand), hint: this.hintFor(own.id),
        activeItem: this.status === 'question' ? round.items.get(own.id)?.type : null,
        answerOpensAt: round ? round.frozen.has(own.id) ? round.startsAt : round.answerOpensAt : null,
        frozenUntil: this.status === 'question' && round.frozen.has(own.id) ? round.startsAt : null,
        billUntil: bill ? round.answerOpensAt + timing.bill : null,
        potato: this.status === 'question' && potato?.holderId === own.id && now >= round.answerOpensAt ? { version: potato.version, nextPassAt: potato.nextPassAt } : null,
        spectator: this.status === 'question' && !round.participants.has(own.id),
        lastAnswerCorrect: reviewing ? own.lastAnswerCorrect : null,
        lastQuestionPoints: reviewing ? own.lastQuestionPoints : 0,
        breakdown: reviewing ? own.breakdown : null, reviewAdjustment: own.reviewAdjustment
      } : null
    };
  }
}
module.exports = { Game };
