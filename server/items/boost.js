module.exports = {
  validate(player) { return !player.streak ? 'Build a streak first.' : player.streakMultiplier >= 25 ? 'Your streak is already at ×25.' : null; },
  commands(player) { return [{ type: 'streak', playerId: player.id, streak: player.streak, multiplier: player.streakMultiplier * 5 }]; }
};
