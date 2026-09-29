const catalog = require('../../shared/items.json');
const handlers = {
  copycat: require('./copycat'), double: require('./double'), siphon: require('./siphon'), whisper: require('./whisper'),
  freeze: require('./freeze'), 'ten-seconds': require('./ten-seconds'), skip: require('./skip'),
  boost: require('./boost'), 'cash-out': require('./cash-out'), 'clear-streaks': require('./clear-streaks'), blackjack: require('./blackjack'),
  sucker: require('./sucker'), intern: require('./intern'), potato: require('./potato'), prediction: require('./prediction'),
  ribbit: require('./ribbit'), trophy: require('./trophy'), taxes: require('./taxes'), reverse: require('./reverse'),
  'blue-shell': require('./blue-shell'), bill: require('./bill'), wpm: require('./wpm'), 'personal-skip': require('./personal-skip')
};
module.exports = { catalog, handlers, byId: Object.fromEntries(catalog.map(item => [item.id, item])) };
