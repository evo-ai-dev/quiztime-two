'use strict';

function reflect(game, casterId, targetId, type) {
  const round = game.round;
  if (targetId !== casterId && round.reverseCharges.has(targetId)) {
    round.reverseCharges.delete(targetId);
    round.reversals.push({ type, from: casterId, to: targetId });
    return { casterId: targetId, targetId: casterId, reversed: true };
  }
  return { casterId, targetId, reversed: false };
}

function prepareAttacks(game) {
  const round = game.round;
  for (const [casterId, item] of round.items) {
    if (item.type === 'freeze') {
      for (const targetId of round.participants) {
        if (casterId === targetId) continue;
        round.frozen.add(reflect(game, casterId, targetId, item.type).targetId);
      }
    }
    if (item.type === 'bill') {
      const target = reflect(game, casterId, item.targetId, item.type).targetId;
      item.effectTargetId = target;
      round.billTargets.add(target);
    }
    if (item.type === 'potato') {
      const candidates = [...round.participants].filter(id => id !== casterId);
      const targetId = candidates.length ? candidates[game.randomInt(candidates.length)] : casterId;
      const target = reflect(game, casterId, targetId, item.type).targetId;
      round.potato = { casterId, holderId: target, version: 0, nextPassAt: round.answerOpensAt };
    }
  }
}
module.exports = { reflect, prepareAttacks };
