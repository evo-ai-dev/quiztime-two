module.exports = {
  answer(correct, randomInt) { const wrong = [0, 1, 2, 3].filter(i => i !== correct); return randomInt(2) === 1 ? correct : wrong[randomInt(3)]; },
  modify: points => points > 0 ? Math.round(points * 1.5) : points
};
