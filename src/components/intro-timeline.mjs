const clamp = value => Math.max(0, Math.min(1, value));
export const ease = value => value < .5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;

// All phases are derived from absolute server timestamps, never chained timers.
export function introFrame(intro, now) {
  if (now < intro.coveredAt) return { phase: 'cover', cover: ease(clamp((now - intro.startAt) / (intro.coveredAt - intro.startAt))) };
  if (now < intro.previewAt) return { phase: 'powers' };
  if (intro.endsAt === null || now < intro.revealAt) return {
    phase: 'preview', elapsed: now - intro.previewAt,
    waiting: intro.countdownAt === null,
    count: intro.countdownAt === null || now < intro.countdownAt ? 0 : Math.max(0, Math.ceil((intro.previewEndsAt - now) / 1000)),
    fade: intro.previewEndsAt === null || now < intro.previewEndsAt ? 1 : 1 - clamp((now - intro.previewEndsAt) / (intro.revealAt - intro.previewEndsAt)),
    second: intro.countdownAt === null ? 0 : (Math.max(0, now - intro.countdownAt) % 1000) / 1000
  };
  if (now < intro.endsAt) return { phase: 'reveal', mask: ease(clamp((now - intro.revealAt) / (intro.endsAt - intro.revealAt))) };
  return { phase: 'done', mask: 1 };
}

export function powerPan(event, now, duration) {
  const enter = ease(clamp((now - event.startsAt) / duration));
  const leave = ease(clamp((now - (event.endsAt - duration)) / duration));
  return { transform: `translateY(${(1 - enter + leave) * 100}vh)`, opacity: Math.min(enter, 1 - leave) };
}
