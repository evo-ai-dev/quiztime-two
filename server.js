'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PROJECT_ROOT = __dirname;
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'dist');

function readOption(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function numberOption(flag, envName, fallback) {
  const value = Number(readOption(flag, process.env[envName] || fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const options = {
  port: numberOption('--port', 'PORT', 3000),
  questionSeconds: numberOption('--time', 'QUESTION_SECONDS', 20),
  questionFile: path.resolve(process.cwd(), readOption('--questions', process.env.QUESTION_FILE || 'data/questions.txt')),
  resultsFile: path.resolve(process.cwd(), process.env.RESULTS_FILE || 'data/results.txt')
};

function fail(message) {
  console.error(`\nRibBit could not start: ${message}\n`);
  process.exitCode = 1;
}

function parseQuestions(text) {
  const questions = [];
  let timerSeconds = null;
  let current = null;

  function startQuestion(promptText) {
    current = {
      promptLines: promptText ? [promptText] : [],
      choices: [],
      answerIndex: null,
      choicesStarted: false,
      inCodeFence: false
    };
  }

  function setAnswer(answerText) {
    const answer = answerText.trim();
    const letterIndex = /^[A-D]$/i.test(answer) ? 'ABCD'.indexOf(answer.toUpperCase()) : -1;
    const numberIndex = /^[1-4]$/.test(answer) ? Number(answer) - 1 : -1;
    const textIndex = current.choices.findIndex((choice) => choice && choice.toLowerCase() === answer.toLowerCase());
    current.answerIndex = letterIndex >= 0 ? letterIndex : numberIndex >= 0 ? numberIndex : textIndex >= 0 ? textIndex : null;
  }

  function flush() {
    if (!current) return;

    if (current.inCodeFence) {
      throw new Error(`Question ${questions.length + 1} has an unclosed code block.`);
    }
    const prompt = current.promptLines.join('\n').trim();
    if (!prompt) {
      throw new Error(`Question ${questions.length + 1} is missing a QUESTION line.`);
    }
    if (['A', 'B', 'C', 'D'].some((_, index) => !current.choices[index])) {
      throw new Error(`Question ${questions.length + 1} must have A, B, C, and D choices.`);
    }
    if (current.answerIndex === null) {
      throw new Error(`Question ${questions.length + 1} is missing a valid ANSWER line.`);
    }

    questions.push({
      id: questions.length + 1,
      prompt,
      choices: current.choices,
      answerIndex: current.answerIndex
    });
    current = null;
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const originalLine of lines) {
    const rawLine = originalLine.replace(/\r$/, '');
    const line = rawLine.trim();
    const questionMatch = line.match(/^QUESTION\s*:\s*(.*)$/i);
    const timerMatch = line.match(/^(?:TIME|TIMER)\s*:\s*(\d+)\s*$/i);
    const choiceMatch = line.match(/^([A-D])\s*[:.)-]\s*(.+)$/i);
    const answerMatch = line.match(/^ANSWER\s*:\s*(.+)$/i);

    if (!current) {
      if (!line || line.startsWith('#')) continue;
      if (timerMatch) {
        const seconds = Number(timerMatch[1]);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
          throw new Error('TIME must be a whole number between 1 and 600 seconds.');
        }
        timerSeconds = seconds;
        continue;
      }
      if (questionMatch) {
        startQuestion(questionMatch[1].trim());
        continue;
      }
      throw new Error('Found content before the first QUESTION line.');
    }

    if (!current.choicesStarted) {
      if (current.inCodeFence) {
        current.promptLines.push(rawLine);
        if (line.startsWith('```')) current.inCodeFence = false;
        continue;
      }
      if (line.startsWith('```')) {
        current.promptLines.push(rawLine);
        current.inCodeFence = true;
        continue;
      }
      if (questionMatch) {
        flush();
        startQuestion(questionMatch[1].trim());
        continue;
      }
      if (choiceMatch) {
        current.choicesStarted = true;
        current.choices[choiceMatch[1].toUpperCase().charCodeAt(0) - 65] = choiceMatch[2].trim();
        continue;
      }
      if (answerMatch) {
        throw new Error(`Question ${questions.length + 1} must define its choices before ANSWER.`);
      }
      current.promptLines.push(rawLine);
      continue;
    }

    if (!line || line.startsWith('#')) continue;
    if (questionMatch) {
      flush();
      startQuestion(questionMatch[1].trim());
      continue;
    }
    if (choiceMatch) {
      current.choices[choiceMatch[1].toUpperCase().charCodeAt(0) - 65] = choiceMatch[2].trim();
      continue;
    }
    if (answerMatch) {
      setAnswer(answerMatch[1]);
      continue;
    }

    throw new Error(`Unrecognized line in question ${questions.length + 1}: ${line}`);
  }

  flush();
  if (questions.length === 0) throw new Error('No questions were found.');
  return { questions, timerSeconds };
}

function loadQuestions() {
  let text;
  try {
    text = fs.readFileSync(options.questionFile, 'utf8');
  } catch (error) {
    throw new Error(`could not read ${options.questionFile}: ${error.message}`);
  }
  try {
    return parseQuestions(text);
  } catch (error) {
    throw new Error(`${options.questionFile}: ${error.message}`);
  }
}

let questions;
try {
  const parsed = loadQuestions();
  questions = parsed.questions;
  if (parsed.timerSeconds !== null) options.questionSeconds = parsed.timerSeconds;
} catch (error) {
  fail(error.message);
  return;
}

const { Game } = require('./server/game');
const hostPin = process.env.HOST_PIN || '';
if (process.env.RENDER && hostPin.length < 8) {
  fail('Set HOST_PIN to at least 8 characters in Render Environment before starting.');
  return;
}
const hosts = new Set();
function safeSend(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) socket.send(JSON.stringify(payload));
}
function broadcast() {
  for (const socket of hosts) safeSend(socket, { type: 'state', state: game.stateFor('host') });
  for (const player of game.players.values()) safeSend(player.socket, { type: 'state', state: game.stateFor('player', player) });
}
const game = new Game({
  questions, seconds: options.questionSeconds, questionFile: path.basename(options.questionFile),
  wrongPenalty: Math.max(0, Math.min(1000, Number(process.env.WRONG_ANSWER_PENALTY) || 0)),
  onFinish(text) {
    try {
      fs.mkdirSync(path.dirname(options.resultsFile), { recursive: true });
      fs.appendFileSync(options.resultsFile, text, 'utf8');
    } catch (error) { console.error('Results file unavailable; use Download results:', error.message); }
  },
  onPrivate(id, message) { safeSend(game.players.get(id)?.socket, message); }
});
game.onChange = broadcast;

function handleMessage(socket, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  if (message.type === 'time-sync') {
    if (Number.isFinite(message.clientSentAt)) safeSend(socket, { type: 'time-sync', clientSentAt: message.clientSentAt, serverTime: Date.now() });
    return;
  }
  if (!socket.role) {
    if (message.type !== 'hello') return;
    if (message.role === 'host') {
      const supplied = Buffer.from(String(message.pin || ''));
      const expected = Buffer.from(hostPin);
      if (hostPin && (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected))) {
        safeSend(socket, { type: 'auth-required', message: 'Enter the host PIN to control this game.' });
        return;
      }
      socket.role = 'host';
      hosts.add(socket);
      safeSend(socket, { type: 'connected', host: true });
      safeSend(socket, { type: 'state', state: game.stateFor('host') });
    } else if (message.role === 'player') {
      try {
        const player = game.join(message);
        const oldSocket = player.socket;
        player.socket = socket;
        if (oldSocket && oldSocket !== socket) { safeSend(oldSocket, { type: 'session-replaced' }); oldSocket.close(1000); }
        socket.role = 'player';
        socket.playerId = player.id;
        safeSend(socket, { type: 'connected', playerId: player.token });
        broadcast();
      } catch (error) { safeSend(socket, { type: message.resumeOnly ? 'session-expired' : 'error', message: error.message }); }
    }
    return;
  }
  if (socket.role === 'host') {
    if (message.type === 'download-results') {
      if (game.status === 'finished') safeSend(socket, { type: 'results', text: game.results });
      return;
    }
    if (message.type === 'reset' && message.gameId === game.idValue) {
      for (const player of game.players.values()) { safeSend(player.socket, { type: 'lobby-reset' }); player.socket?.close(1000); }
    }
    try { game.hostAction(message); }
    catch (error) { safeSend(socket, { type: 'error', message: error.message }); }
    return;
  }
  const player = game.players.get(socket.playerId);
  if (!player || player.socket !== socket) return;
  if (message.type === 'attention') {
    if (game.status !== 'question' || Date.now() < game.round.opensAt || !['control-key', 'escape-key', 'left-tab', 'window-blur'].includes(message.kind) || Date.now() - player.attentionAt < 1500) return;
    player.attentionAt = Date.now();
    for (const host of hosts) safeSend(host, { type: 'attention', player: { racerName: player.racerName } });
  } else safeSend(socket, game.command(player, message));
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }[extension] || 'application/octet-stream';
}

const server = http.createServer((request, response) => {
  let requestUrl;
  try { requestUrl = new URL(request.url, 'http://localhost'); }
  catch { response.writeHead(400); response.end('Bad URL'); return; }
  if (requestUrl.pathname === '/healthz') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('ok'); return; }
  let relativePath;
  try { relativePath = decodeURIComponent(requestUrl.pathname); }
  catch { response.writeHead(400); response.end('Bad URL'); return; }
  if (relativePath === '/') relativePath = '/index.html';

  let filePath = path.resolve(CLIENT_ROOT, `.${relativePath}`);
  if (!filePath.startsWith(`${CLIENT_ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error && error.code === 'ENOENT' && !path.extname(relativePath)) {
      filePath = path.join(CLIENT_ROOT, 'index.html');
      fs.readFile(filePath, (fallbackError, fallbackData) => {
        if (fallbackError) {
          response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Build the React client first with: npm run build');
          return;
        }
        response.writeHead(200, {
          'Content-Type': contentType(filePath),
          'Cache-Control': 'no-store'
        });
        response.end(fallbackData);
      });
      return;
    }
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-store'
    });
    response.end(data);
  });
});

const webSocketServer = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
webSocketServer.on('connection', (socket) => {
  socket.alive = true;
  socket.on('pong', () => { socket.alive = true; });
  socket.on('error', () => {});
  const helloTimeout = setTimeout(() => { if (!socket.role) socket.close(1008, 'Please connect again.'); }, 60000);
  socket.on('message', raw => {
    const now = Date.now();
    if (!socket.rateAt || now - socket.rateAt > 1000) { socket.rateAt = now; socket.rateCount = 0; }
    if (++socket.rateCount > 30) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(socket, message);
  });
  socket.on('close', () => {
    clearTimeout(helloTimeout);
    hosts.delete(socket);
    const player = game.players.get(socket.playerId);
    if (player?.socket === socket) { player.connected = false; player.socket = null; broadcast(); }
  });
});
const tick = setInterval(() => game.tick(), 100);
const heartbeat = setInterval(() => {
  for (const socket of webSocketServer.clients) {
    if (!socket.alive) { socket.terminate(); continue; }
    socket.alive = false;
    socket.ping();
  }
}, 30000);
server.on('close', () => { clearInterval(tick); clearInterval(heartbeat); });

function networkAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
    }
  }
  return addresses;
}

server.listen(options.port, '0.0.0.0', () => {
  console.log(`\nRibBit is ready with ${questions.length} question${questions.length === 1 ? '' : 's'}.`);
  console.log(`Questions: ${options.questionFile}`);
  console.log(`Results:   ${options.resultsFile}`);
  console.log(`Host:      http://localhost:${options.port}/host`);
  for (const address of networkAddresses()) {
    console.log(`Network:   http://${address}:${options.port}/`);
  }
  console.log('');
});
