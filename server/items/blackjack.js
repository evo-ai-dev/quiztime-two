'use strict';

function value(cards) {
  let total = cards.reduce((sum, card) => sum + (card.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank)), 0);
  let aces = cards.filter(card => card.rank === 'A').length;
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}

function createHand(wager, randomInt, id, expiresAt) {
  const deck = ['♠', '♥', '♦', '♣'].flatMap(suit => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map(rank => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return { id, wager, expiresAt, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], status: 'playing', payout: 0 };
}

function settle(hand) {
  if (hand.status !== 'playing') return 0;
  const playerValue = value(hand.player);
  if (playerValue <= 21) while (value(hand.dealer) < 17) hand.dealer.push(hand.deck.pop());
  const dealerValue = value(hand.dealer);
  hand.status = playerValue > 21 ? 'lost' : dealerValue > 21 || playerValue > dealerValue ? 'won' : playerValue === dealerValue ? 'push' : 'lost';
  hand.payout = hand.status === 'won' ? hand.wager * 2 : hand.status === 'push' ? hand.wager : 0;
  return hand.payout;
}

function publicHand(hand) {
  if (!hand) return null;
  const { id, wager, expiresAt, status, player, dealer, payout } = hand;
  return { id, wager, expiresAt, status, player, dealer: status === 'playing' ? [dealer[0], null] : dealer, playerValue: value(player), dealerValue: status === 'playing' ? null : value(dealer), payout };
}

module.exports = { value, createHand, settle, publicHand };
