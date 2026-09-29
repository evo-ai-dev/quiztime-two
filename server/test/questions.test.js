'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestions } = require('../questions');

const sample = [
  'TIME: 25', 'QUESTION: What does this function return?', '```js',
  'function frog(x) {', '  // Blank lines and metadata-looking code must survive.', '',
  '  return `ANSWER: ${x}`;', '}', '```',
  'A: ```js', 'function one() {', '  return 1;', '}', '```',
  'B:', '```text', 'QUESTION: this is code, not a new question', 'A: also code', 'ANSWER: preserved', '```',
  'C: Two lines of ordinary answer text', 'and the continuation.', 'D: None of the above', 'ANSWER: B'
].join('\n');

test('question file preserves multiline question and answer code, indentation and metadata literals', () => {
  const { questions, timerSeconds } = parseQuestions(sample);
  assert.equal(timerSeconds, 25); assert.equal(questions.length, 1);
  const q = questions[0];
  assert.ok(q.prompt.includes('\n\n  return'));
  assert.ok(q.choices[0].includes('\n  return 1;\n'));
  assert.ok(q.choices[1].includes('QUESTION: this is code'));
  assert.ok(q.choices[1].includes('ANSWER: preserved'));
  assert.equal(q.choices[2], 'Two lines of ordinary answer text\nand the continuation.');
  assert.equal(q.answerIndex, 1);
});

test('legacy one-line choices and answers still parse', () => {
  const input = 'QUESTION: Pick one\nA: Alpha\nB: Beta\nC: Gamma\nD: Delta\nANSWER: Beta';
  assert.equal(parseQuestions(input).questions[0].answerIndex, 1);
  assert.equal(parseQuestions(input.replace('ANSWER: Beta', 'ANSWER: 3')).questions[0].answerIndex, 2);
});

test('unclosed code, missing or repeated choices, and invalid answers are rejected', () => {
  assert.throws(() => parseQuestions('QUESTION: Code\n```js\nconst x = 1;'), /unclosed code/);
  assert.throws(() => parseQuestions(sample.replace('D: None of the above', 'D:')), /must have A, B, C, and D/);
  assert.throws(() => parseQuestions(sample.replace('D: None of the above', 'C: repeated')), /repeats choice C/);
  assert.throws(() => parseQuestions(sample.replace(/ANSWER: B$/, 'ANSWER: E')), /valid ANSWER/);
});

test('renderer recognizes fences without interpreting HTML or dropping indentation', async () => {
  const { splitQuizText } = await import('../../src/components/quiz-text.mjs');
  assert.deepEqual(splitQuizText('Hello\n```js\n  return "<script>";\n```\nAfter'), [
    { type: 'text', value: 'Hello' }, { type: 'code', value: '  return "<script>";' }, { type: 'text', value: 'After' }
  ]);
  assert.deepEqual(splitQuizText('~~~text\nA: literal\n~~~'), [{ type: 'code', value: 'A: literal' }]);
});
