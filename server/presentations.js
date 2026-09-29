'use strict';
const timing = require('../shared/timing.json');

// Only the active entry is serialized. Future silent powers, coin results and
// score transfers never travel to browsers before their reveal starts.
class Presentations {
  constructor() { this.clear(); }
  clear() { this.entries = []; this.active = null; this.done = null; this.nextAt = null; }
  get busy() { return !!this.active || !!this.entries.length; }
  append(entry, now) {
    if (this.busy) this.entries.push(entry);
    else this.start([entry], now);
    this.tick(now);
  }
  start(entries, startAt, done) {
    if (this.busy) throw new Error('Wait for the current power-up presentation.');
    this.entries = [...entries]; this.nextAt = startAt; this.done = done;
    if (!entries.length) { this.done = null; done?.(); }
  }
  tick(now) {
    let changed = false;
    while (true) {
      if (this.active) {
        if (now < this.active.endsAt) break;
        const entry = this.active;
        this.active = null; this.nextAt = entry.endsAt;
        entry.complete?.(); changed = true;
      }
      if (this.entries.length) {
        if (now < this.nextAt) break;
        const entry = this.entries.shift();
        // A delayed tick must not skip an interactive turn before anyone sees it.
        const startsAt = ['coin', 'casino'].includes(entry.mode) ? Math.max(now, this.nextAt) : this.nextAt;
        this.active = { ...entry, startsAt, endsAt: startsAt + (entry.duration || timing.announcement) };
        this.active.start?.(this.active); changed = true;
        continue;
      }
      const done = this.done; this.done = null; done?.();
      break;
    }
    return changed;
  }
  public(role) {
    const entry = this.active;
    if (!entry) return null;
    const { id, type, emoji, name, casterId, casterName, description, phase, mode, startsAt, endsAt, data, flipped } = entry;
    return { id, type, emoji, name, casterId, casterName, description, phase, mode, startsAt, endsAt,
      ...(role === 'host' ? { hostDescription: entry.hostDescription } : {}),
      remaining: this.entries.length, flipped: !!flipped,
      data: mode === 'coin' && !flipped ? {} : data };
  }
}
module.exports = { Presentations };
