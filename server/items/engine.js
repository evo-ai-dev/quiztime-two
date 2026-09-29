'use strict';
const { catalog, handlers, byId } = require('./index');

function fillInventory(player, randomInt, id, { excluded = [], size = 3 } = {}) {
  while (player.inventory.length < size) {
    const pool = catalog.filter(item => !excluded.includes(item.id) && !player.inventory.some(slot => slot.type === item.id));
    let roll = randomInt(pool.reduce((sum, item) => sum + item.weight, 0));
    const item = pool.find(entry => (roll -= entry.weight) < 0);
    player.inventory.push({ id: id(), type: item.id });
  }
}

function validate(game, player, message) {
  if (!game.itemWindowOpen()) return 'Use your power-up during the question preview, before the host starts the countdown.';
  if (message.roundId !== game.round?.id) return 'That question has already ended.';
  if (!game.round.participants.has(player.id)) return 'You joined mid-question. You’re in for the next one.';
  if (player.usedItemRound === game.round.id) return 'One power-up per question. Make it count!';
  const slot = player.inventory.find(item => item.id === message.itemId);
  if (!slot || !byId[slot.type]) return 'That power-up is no longer in your backpack.';
  const item = byId[slot.type];
  if (item.maxUsesPerGame && (game.itemUses[item.id] || 0) >= item.maxUsesPerGame) return 'That room-wide power-up has already been used this game.';
  if (item.target) {
    const target = game.players.get(message.targetId);
    if (!target || target.id === player.id || !target.connected || !game.round.participants.has(target.id)) return 'Choose another connected racer in this question.';
    if (slot.type === 'siphon' && [...game.round.items.values()].some(item => item.type === slot.type && item.targetId === target.id)) return 'That racer already has Siphon Points aimed at them.';
  }
  if (slot.type === 'copycat' && ![...game.players.values()].some(p => p.id !== player.id && p.connected && game.round.participants.has(p.id))) return 'You need another racer to copy.';
  if (item.global && [...game.round.items.values()].some(active => active.type === slot.type)) return 'That global power-up is already active.';
  if (item.wager && (!Number.isInteger(message.amount) || message.amount < 1 || message.amount > Math.min(1000, player.score))) return 'Bet 1–1,000 points, up to your available score.';
  return handlers[slot.type].validate?.(player) || null;
}

function applyCommands(game, commands) {
  for (const command of commands) {
    const player = game.players.get(command.playerId);
    if (command.type === 'points') { player.score += command.amount; player.reviewAdjustment += command.amount; }
    if (command.type === 'streak') { player.streak = command.streak; player.streakMultiplier = command.multiplier; }
  }
}

module.exports = { fillInventory, validate, applyCommands };
