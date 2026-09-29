'use strict';
// Preloaded by the transport test only. Keep one card deterministic so random
// drops cannot make the WebSocket item-use assertion flaky.
const gameModule = require('../game');
const BaseGame = gameModule.Game;
gameModule.Game = class extends BaseGame {
  refill(player, size = 3) {
    if (this.index === 0 && player.racerName === 'Transport0' && !player.inventory.length) {
      player.inventory.push({ id: this.id(), type: 'whisper' });
    }
    super.refill(player, size);
  }
};
