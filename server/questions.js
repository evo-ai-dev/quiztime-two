'use strict';

// Metadata is recognized only outside fenced blocks. Question and answer code
// preserve indentation, blank lines, and text such as "ANSWER:" verbatim.
function parseQuestions(text) {
  const questions = [];
  let timerSeconds = null, current = null, activeChoice = null, fence = null;
  const start = prompt => { current = { prompt: [], choices: [], answer: null }; activeChoice = null; append(prompt); };
  const linesForSection = () => activeChoice === null ? current.prompt : current.choices[activeChoice];
  function append(line) {
    linesForSection().push(line);
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (!fence && marker) fence = marker[1];
    else if (fence && new RegExp(`^${fence[0]}{${fence.length},}\\s*$`).test(line.trim())) fence = null;
  }
  function flush() {
    if (!current) return;
    const number = questions.length + 1;
    if (fence) throw new Error(`Question ${number} has an unclosed code block.`);
    const prompt = current.prompt.join('\n').trim();
    const choices = Array.from({ length: 4 }, (_, i) => (current.choices[i] || []).join('\n').trim());
    if (!prompt) throw new Error(`Question ${number} is missing a QUESTION line.`);
    if (choices.some(choice => !choice)) throw new Error(`Question ${number} must have A, B, C, and D choices.`);
    const answer = current.answer || '';
    const answerIndex = /^[A-D]$/i.test(answer) ? 'ABCD'.indexOf(answer.toUpperCase())
      : /^[1-4]$/.test(answer) ? Number(answer) - 1 : choices.findIndex(choice => choice.toLowerCase() === answer.toLowerCase());
    if (answerIndex < 0) throw new Error(`Question ${number} is missing a valid ANSWER line.`);
    questions.push({ id: number, prompt, choices, answerIndex });
    current = null; activeChoice = null;
  }
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (fence) { append(rawLine); continue; }
    const question = line.match(/^QUESTION\s*:\s*(.*)$/i);
    if (question) { flush(); start(question[1]); continue; }
    if (!current) {
      if (!line || line.startsWith('#')) continue;
      const timer = line.match(/^(?:TIME|TIMER)\s*:\s*(\d+)\s*$/i);
      if (!timer) throw new Error('Found content before the first QUESTION line.');
      timerSeconds = Number(timer[1]);
      if (timerSeconds < 1 || timerSeconds > 600) throw new Error('TIME must be a whole number between 1 and 600 seconds.');
      continue;
    }
    if (current.answer !== null) {
      if (!line || line.startsWith('#')) continue;
      throw new Error(`Unrecognized line after ANSWER in question ${questions.length + 1}: ${line}`);
    }
    const answer = line.match(/^ANSWER\s*:\s*(.+)$/i);
    if (answer) {
      if (activeChoice === null) throw new Error(`Question ${questions.length + 1} must define its choices before ANSWER.`);
      current.answer = answer[1].trim(); continue;
    }
    const choice = line.match(/^([A-D])\s*[:.)-]\s*(.*)$/i);
    if (choice) {
      activeChoice = choice[1].toUpperCase().charCodeAt(0) - 65;
      if (current.choices[activeChoice]) throw new Error(`Question ${questions.length + 1} repeats choice ${choice[1].toUpperCase()}.`);
      current.choices[activeChoice] = []; append(choice[2]); continue;
    }
    if (activeChoice !== null && line.startsWith('#')) continue;
    append(rawLine);
  }
  flush();
  if (!questions.length) throw new Error('No questions were found.');
  return { questions, timerSeconds };
}

module.exports = { parseQuestions };
