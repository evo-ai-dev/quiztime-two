module.exports = { modify: (points, elapsed) => points > 0 && elapsed <= 5000 ? points * 2 : points };
