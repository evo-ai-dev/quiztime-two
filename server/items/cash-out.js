module.exports = {
  validate(player) { return player.streak ? null : 'Build a streak first.'; },
  commands(player) { return [{ type: 'points', playerId: player.id, amount: 100 * player.streak * player.streakMultiplier }, { type: 'streak', playerId: player.id, streak: 0, multiplier: 1 }]; }
};
