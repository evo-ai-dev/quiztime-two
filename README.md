# RibBit

RibBit is a small Kahoot-style quiz app with chaotic power-ups. One browser hosts at `/host`; everyone else joins at `/` from a phone or desktop. Use it on your LAN or deploy the same app to Render.

## Run it

Use Node 22.14 or newer (Render is pinned to the Node 22 release line). From this folder:

```bash
npm install
npm run build
npm start
```

The server prints a host URL and the network URL(s) to the terminal. Open the host URL (ending in `/host`) on the computer running RibBit, then share the network URL without `/host` with players. The React client is built by Vite and served by the small Node server.

For front-end development, use two terminals:

```bash
# terminal 1
npm run server

# terminal 2
npm run dev
```

Then open `http://localhost:5173`. Vite proxies the `/ws` connection to the game server on port `3000`.

By default RibBit uses `data/questions.txt`, listens on port `3000`, and appends final scores to `data/results.txt`.

To choose another text file or question timer:

```bash
node server.js --questions /path/to/my-quiz.txt --time 30 --port 3000
```

The same settings can be supplied with `QUESTION_FILE`, `QUESTION_SECONDS`, `RESULTS_FILE`, and `PORT` environment variables.

## Question file format

Use one `QUESTION` block per question. Separate blocks with a blank line. Answers may be a letter, number, or exact choice text.

Add `TIME` once near the top of the file to set the countdown for every question:

```text
TIME: 20

QUESTION: Which planet is known as the Red Planet?
A: Venus
B: Mars
C: Jupiter
D: Mercury
ANSWER: B
```

Question prompts can continue across multiple lines. Use triple backticks for a formatted code block:

````text
QUESTION:
What does this code print?

```js
const answer = 2 + 2;
console.log(answer);
```

A: 2
B: 4
C: 6
D: 8
ANSWER: B
````

Restart RibBit after changing the question file so the server reloads the timer and questions.

The server validates the complete file before it starts. Every question must have a prompt, four choices, and an answer.

## What is included

- Host and player views in one responsive web page.
- Server-side answer checking and speed-based scoring.
- In-memory player objects with reconnect support while the server is running.
- Fullscreen request after a player joins (browsers require a user gesture, so this cannot be forced silently on page load).
- Attention events for CTRL, ESC, leaving the tab, and window blur. These are signals for the host, not a foolproof anti-cheat system.
- Scores written as one pipe-delimited line per player when the game finishes:
  `timestamp | rank | first name | racer name | score`

## Before using it with a real group

- Set a strong `HOST_PIN` before exposing the server. It protects host websocket commands, not just the host page. Render requires at least eight characters. Do not put the PIN in a public URL or commit it.
- Players reconnect automatically with a private, per-tab session token. A refresh preserves the racer; a server restart cannot. Disconnected participants remain in the current round until its deadline. New arrivals join the next question.
- Decide whether questions should be shuffled, whether answer choices should be shuffled, and whether scores should be speed-based or fixed.
- Test the host computer’s firewall and the network’s client-isolation setting. Some guest Wi-Fi networks prevent phones from reaching a laptop even when both are connected.
- Consider HTTPS if this moves beyond a trusted local network. Fullscreen and browser permissions vary by browser and device.
- Back up or rotate `data/results.txt` if many games will be run.
- Add a database if scores, names, or game history must survive a server restart. The current player state is intentionally memory-only.

## Power-ups

After each answer review, each player has up to three random, distinct items. Pick a card, choose a target or wager if needed, then confirm. One use per review; no cancellation after confirmation. Unused cards carry over. Consumed slots refill **after the following question**, not immediately. The first question has no items. Hosts should give players time to make selections before clicking Next.

### Announcements and timing

Loud next-question powers each get their own **five-second** spotlight after the green countdown/reveal, before answering opens. Every spotlight shows the emoji, power name, caster’s racer name and description. The server owns the queue and clock; host and players see the same active entry. Announcements consume no answering time.

The correct answer stays on screen for five seconds (including the host’s existing fade-to-black for incorrect choices). Then silent powers and score-changing results reveal individually. Future silent announcements and unrevealed coin results are not sent to clients. Final item adjustments commit when the result queue finishes; the swipeable leaderboard and backpack then become available. Instant powers such as cash-in and casino run during that same review period. Next is disabled during presentations; reset remains available.

Interactive exceptions: the coin’s owner can tap to flip, with an automatic flip after eight seconds; a blackjack hand auto-stands after 20 seconds. Their results hold for three seconds. Disconnecting cannot strand the queue.

With 30 loud activations, **30 × 5 seconds = 150 seconds of announcements**. There is deliberately no batching or truncating players’ spotlights.

| Item | Visibility | What happens |
| --- | --- | --- |
| 🦜 Trust Them | Loud | Copies the highest-scoring other participant’s original answer and server-measured speed, not their item bonuses. Target locks at question start; ties use racer name. No original answer: item returned; no recursive copy chains. |
| 🪙 Double or Nothing | Loud | After-answer interactive coin flip: double positive question points or earn zero. A correct answer still counts toward the streak. |
| 🧲 Siphon Points | Loud | Absorb 50% of a target’s signed question score; share their loss if negative. One siphon per target. After-answer animation shows both racers and the transfer. |
| 🤖 Walker's Weapon | Loud | Privately streams the correct answer one word every 350ms. A scripted joke chatbot, **no AI API or cost**. |
| 🧊 Cold Feet | Loud | For three seconds only its user can answer; other players are frozen and the clock pauses. Reverse gives the reverser that exemption and freezes the original caster. |
| 🔥 Hot Streak | Loud, instant | Streak cash-out value ×5, capped at ×25. A phoenix replaces the streak icon until it dies or is cashed in. Does not multiply normal answer points. |
| 💧 Water | Loud | After the next answer, clear everyone else’s streak/multiplier. Yours survives unless reversed. Existing points stay. |
| ⏱️ Think Fast | Loud | Exactly ten answering seconds on the next question. Announcements and Cold Feet’s pause do not consume them. |
| 🏦 Cash in Streak | Loud, instant | Show the streak turning into 100 × streak × boost points, then clear it. |
| 🃏 Pond Casino | Loud, instant | Owner plays blackjack on their device; everyone watches the same hand. Bet 1–1,000 quiz points, up to your score. Hit/stand, dealer stands on all 17s, wins pay 1:1, ties return the wager. No real money. |
| 🦘 Nope! | Loud | Skip the next question for everyone, keeping scores/streaks and refunding other queued powers. Skipping the final question finishes the quiz. |
| 🍭 Sucker | Loud | Six or more wrong answers double your positive question points. Unanswered and personally skipped questions do not count as wrong answers. |
| 🧑‍💼 The Intern | Loud | Automatically answers with exactly 50% chance of being right. Correct pays **1.5×**. |
| 🥔 Hot Potato | Loud | Tap to pass to a random connected rival, even after answering. The final holder gets half their positive question points. Announce activation and final outcome only, never individual passes. |
| 🔮 Prediction | Silent | Predict the first **manual** answerer; double your positive question points if correct. |
| 🐸 Ribbit | Silent | Everyone displays as Frog on the next leaderboard. Identities and scores remain unchanged. |
| 🏆 Participation Trophy | Silent, instant | Claim first on the final **podium only**. Displayed score, score-ranked standings and exported results remain authentic. |
| 🧾 Taxes | Loud | Racers ranked above you at question start each contribute 100 points. Reverse redirects the affected racer’s contribution back from the caster. |
| 🪞 Uno Reverse Card | Silent | Reflect the first attack against you, with no recursive bouncing. Cold Feet/Water transfer caster immunity to you; targeted attacks return to their sender. |
| 🐚 Blue Shell | Loud | First manual answerer gets half their positive question points. Automated Intern/Skip answers do not trigger it. |
| 💔 Bill | Silent | A target’s answer labels become “I miss Bill” for five playable seconds. Original labels are withheld from that device during the effect. |
| ⌨️ 200WPM | Loud | Correct within five scoring seconds: double question points. |
| ⏭️ Skip | Silent | Skip only your own question, gain 500 points and preserve your streak. Separate from room-wide Nope! |

Lights Out has been removed. Multipliers apply to **question points**, not accumulated scores. Next-question items are unavailable on final review; instant ones still work. Identical globals cannot stack. **Nope!, Water and Participation Trophy each have a shared one-use-per-game limit**; exhausted copies are replaced and stop dropping. Tune rarity weights and caps in `shared/items.json`.

Scoring order: original answers/speed → Trust Them resolution → base points and personal multipliers → Blue Shell/potato penalties → snapshot-based signed siphons and fixed taxes → Water/streak changes. Siphon chains conserve points. Base points appear in answer review; planned item adjustments stay private until their reveal. Wrong/unanswered questions break streaks and boosts, except explicit skips. `WRONG_ANSWER_PENALTY=100` optionally makes wrong answers cost 100; default is 0.

All ownership, targets, randomness, timings and scores are server-authoritative. Game/round/request IDs reject stale actions and make reconnect retries idempotent. Only the owner can flip their coin, play their hand or pass their potato. First names appear only in final standings; play-time announcements use racer names.

### Code map / adding an item

- `shared/items.json`: client-safe labels, emoji, descriptions, visibility and weighted rarity.
- `shared/timing.json`: shared transition, announcement, review and effect durations.
- `server/items/`: individual handlers, attack reflection, validation and inventory commands.
- `server/game.js`: lifecycle, authoritative clock, activation, private state and interactive actions.
- `server/presentations.js`: ordered server-timed spotlight queue; serializes only the current entry.
- `server/settlement.js`: plans results once, then commits final adjustments after reveals.
- `src/components/PowerUps.jsx`: backpack, targeting/wager controls and in-question effects.
- `src/components/PowerUpPresentation.jsx`: shared host/player announcements, coin, transfers, casino and podium.
- `server/test/game.test.js`: injected-clock/RNG tests for scoring, privacy, interactions and 30 queued announcements.

Add metadata and a handler, register it in `server/items/index.js`, wire the relevant lifecycle/settlement stage, then test conflicts, disconnects, final-question behavior and private-state serialization. Never send decks, credentials or future hint text to clients.

Run `npm test` and `npm run build` before deploying. `npm run test:integration` starts a disposable server, plays four rounds over 30 actual WebSocket connections, checks host authentication/reconnect/export/reset, and removes its temporary results. No new runtime dependencies, database, Redis, background worker or paid services were added.

## Render free deployment

Deploy as **one Node Web Service**, not a static site and not two separate services. One process serves the Vite build and `/ws` on the same origin. Do not horizontally scale: this version intentionally owns a single in-memory lobby.

1. Put this folder in a GitHub repository. Do not include `node_modules`, `dist`, results, PINs or real player data.
2. In Render choose **New → Blueprint**, select that repository, and use the included `render.yaml`. It selects `plan: free`, builds/tests the app, and generates a host PIN.
3. After deployment, copy `HOST_PIN` from the service’s Environment settings. Open `https://YOUR-SERVICE.onrender.com/host`, enter the PIN, and screenshare that host window.
4. Players open `https://YOUR-SERVICE.onrender.com/` — they do not need the PIN or the same Wi-Fi.
5. At the end, click **Download results** before resetting. The server also attempts to append to `data/results.txt`, but that file is temporary on Render.

If you prefer **New → Web Service**, choose the Free instance, build with `npm ci --include=dev && npm test && npm run build`, start with `npm start`, set `HOST_PIN` to a strong secret of at least eight characters, and set the health check to `/healthz`. Render supplies `PORT`; the server binds `0.0.0.0`. If the repository contains the larger Fidelity folder, set the service **Root Directory** to `RibBit` (or add `rootDir: RibBit` to its Blueprint). The included Blueprint assumes RibBit itself is the repository root.

Keep your question text in the repository, or set `QUESTION_FILE` to another committed file. Never deploy secret/company quiz material to a personal public service without approval. Use a private repository for non-public source and quiz files.

### Free-tier limits to plan around

- Render [spins free services down after 15 minutes without inbound HTTP or WebSocket traffic](https://render.com/docs/free). The next visit can take about a minute to wake it. Open the host page before the group arrives.
- Memory and local files disappear on restart, redeploy or sleep. Reconnecting handles a dropped connection **only while the same server process lives**. A restarted server sends players back to the join form. There is no durable recovery in this free, database-free version.
- Render [supports WebSockets](https://render.com/docs/websocket). The app detects stale connections with protocol ping/pong and reconnects browsers with backoff. No external keep-awake cron or paid realtime service is used.
- Free compute is not an uptime guarantee; bandwidth/build quotas still apply. Check the [current free-tier limits](https://render.com/docs/free) before a live event. Avoid deploying during a game.
- This is one shared lobby, capped at 100 retained racers per game to bound memory. Thirty players is covered by automated simulation; test with your actual phones/network before the event. Corporate Wi-Fi can still restrict public hosts or WebSockets; use approved access, not firewall workarounds.
