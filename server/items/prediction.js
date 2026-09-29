module.exports = { modify: (points, predicted, first) => points > 0 && predicted === first ? points * 2 : points };
