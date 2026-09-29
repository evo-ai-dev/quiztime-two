'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once, EventEmitter } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const WebSocket = require('ws');

test('real transport: protected host, 30 racers, all four questions, reconnect, export and reset', { timeout: 70000 }, async t => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ribbit-transport-'));
  const server = spawn(process.execPath, ['server.js', '--port', String(port)], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, HOST_PIN: 'integration-only-pin', RESULTS_FILE: path.join(folder, 'results.txt') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const sockets = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); server.kill(); await fs.rm(folder, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 7000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('Host:')) { clearTimeout(timeout); resolve(); } });
    server.once('exit', code => { clearTimeout(timeout); if (code) reject(new Error(`Server exited ${code}`)); });
    server.stderr.on('data', chunk => t.diagnostic(String(chunk)));
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal(await (await fetch(base + '/healthz')).text(), 'ok');
  assert.equal((await fetch(base + '/host')).status, 200);

  async function client(hello) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
    const client = { ws, state: null, messages: [], events: new EventEmitter() };
    ws.on('message', raw => { const message = JSON.parse(raw); client.messages.push(message); if (message.type === 'state') client.state = message.state; client.events.emit('message', message); });
    client.wait = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const found = client.messages.find(predicate); if (found) return resolve(found);
      const done = message => { if (predicate(message)) { clearTimeout(timeout); client.events.off('message', done); resolve(message); } };
      const timeout = setTimeout(() => { client.events.off('message', done); reject(new Error('Timed out waiting for websocket message')); }, timeoutMs);
      client.events.on('message', done);
    });
    client.send = message => ws.send(JSON.stringify({ gameId: client.state?.gameId, roundId: client.state?.roundId, requestId: crypto.randomUUID(), ...message }));
    await once(ws, 'open'); client.send({ type: 'hello', ...hello }); return client;
  }

  const denied = await client({ role: 'host', pin: 'wrong' }); await denied.wait(m => m.type === 'auth-required');
  denied.send({ type: 'start' });
  const host = await client({ role: 'host', pin: 'integration-only-pin' }); await host.wait(m => m.type === 'state'); assert.equal(host.state.status, 'lobby');
  const players = await Promise.all(Array.from({ length: 30 }, (_, i) => client({ role: 'player', firstName: `Private${i}`, racerName: `Transport${i}` })));
  await Promise.all(players.map(p => p.wait(m => m.type === 'state')));
  await host.wait(m => m.type === 'state' && m.state.players.length === 30);
  assert.ok(host.state.players.every(p => !p.firstName && !p.token));
  host.send({ type: 'start' });
  for (let index = 0; index < 4; index++) {
    await host.wait(m => m.type === 'state' && m.state.status === 'question' && m.state.questionNumber === index + 1);
    await Promise.all(players.map(p => p.wait(m => m.type === 'state' && m.state.status === 'question' && m.state.questionNumber === index + 1)));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, host.state.questionStartedAt - Date.now() + 30)));
    const answerIndex = host.state.question.correctIndex;
    players.forEach(p => p.send({ type: 'answer', answerIndex }));
    await host.wait(m => m.type === 'state' && m.state.status === 'review' && m.state.reviewStage === 'ready' && m.state.questionNumber === index + 1, 8000);
    await Promise.all(players.map(p => p.wait(m => m.type === 'state' && m.state.status === 'review' && m.state.reviewStage === 'ready' && m.state.questionNumber === index + 1, 8000)));
    assert.ok(host.state.players.every(p => p.score >= (index + 1) * 900));
    assert.ok(players.every(p => p.state.player.inventory.length === 3));
    if (index === 0) {
      const old = players[0];
      const token = old.messages.find(m => m.type === 'connected').playerId;
      const id = old.state.player.id;
      assert.notEqual(token, id);
      old.ws.close(); await once(old.ws, 'close');
      players[0] = await client({ role: 'player', sessionId: token, resumeOnly: true });
      await players[0].wait(m => m.type === 'state');
      assert.equal(players[0].state.player.id, id); assert.equal(players[0].state.player.score, old.state.player.score);
    }
    host.send({ type: 'next' });
  }
  await host.wait(m => m.type === 'state' && m.state.status === 'finished');
  assert.ok(host.state.players.every(p => p.firstName));
  host.send({ type: 'download-results' });
  const results = await host.wait(m => m.type === 'results');
  assert.equal(results.text.trim().split('\n').length, 30); assert.match(results.text, /Private0 \| Transport0/);
  assert.equal(await fs.readFile(path.join(folder, 'results.txt'), 'utf8'), results.text);
  host.messages = []; host.send({ type: 'reset' });
  await host.wait(m => m.type === 'state' && m.state.status === 'lobby' && !m.state.players.length);
  await Promise.all(players.map(p => p.wait(m => m.type === 'lobby-reset')));
});
