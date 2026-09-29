'use strict';

// Host narration is deliberately third-person. Never include a silent target here.
function hostDescription(type, racer, target = 'the top-scoring rival') {
  const descriptions = {
    copycat: `${racer} will trust ${target}: the same answer, with the same answering time.`,
    double: `${racer} will flip a coin after this answer. Heads doubles their question points; tails gives them zero.`,
    siphon: `${racer} will absorb 50% of ${target}’s points for this question — or share their loss.`,
    whisper: `Walker’s Weapon will type the correct answer privately for ${racer}, one word at a time.`,
    freeze: `Everyone except ${racer} will be frozen for three seconds. Only ${racer} can answer while the clock is paused.`,
    boost: `${racer} will boost their streak’s cash-in value ×5 after this answer, earning a phoenix icon.`,
    'clear-streaks': `${racer} is bringing Water. Everyone else’s streak will be extinguished after this answer.`,
    'ten-seconds': `${racer} is speeding things up. Everyone has just ten seconds to answer this question.`,
    'cash-out': `${racer} will trade their streak for points after this answer: 100 × streak × boost.`,
    blackjack: `${racer} will play blackjack after this answer. Watch their hand here while they choose Hit or Stand.`,
    skip: `${racer} is skipping this question for everyone. Streaks stay and other used powers are returned.`,
    sucker: `If 6 or more people get this question wrong, ${racer} will get double question points.`,
    intern: `${racer} has sent The Intern. There’s a 50% chance of a correct answer, worth 1.5× points.`,
    potato: `${racer} has released a hot potato! Tap to pass it. Whoever finishes holding it gets half their question points.`,
    prediction: `${racer} predicted who would answer first. A correct prediction doubles their question points.`,
    ribbit: `${racer} has turned every racer name into Frog for the next leaderboard.`,
    trophy: `${racer} is claiming first place on the podium. Their real score and official ranking do not change.`,
    taxes: `Every racer above ${racer} at the start of this question will contribute 100 points.`,
    reverse: `${racer} brought an Uno Reverse Card. Their first incoming attack goes back to its sender.`,
    'blue-shell': `${racer} has launched a Blue Shell. The first manual answer gets half its question points.`,
    bill: `${racer} replaced a rival’s answer labels with “I miss Bill” for five seconds.`,
    wpm: `If ${racer} answers correctly within five seconds, they will get double question points.`,
    'personal-skip': `${racer} skipped this question for 500 points, keeping their streak intact.`
  };
  return descriptions[type];
}

module.exports = { hostDescription };
