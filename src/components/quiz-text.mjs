// Small, deliberately non-HTML formatter. React escapes every text/code segment.
export function splitQuizText(text) {
  const segments = [];
  let lines = [], fence = null;
  const flush = type => {
    if (lines.length && (type === 'code' || lines.join('').trim())) segments.push({ type, value: lines.join('\n') });
    lines = [];
  };
  for (const line of String(text || '').split('\n')) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (!fence && marker) { flush('text'); fence = marker[1]; }
    else if (fence && new RegExp(`^${fence[0]}{${fence.length},}\\s*$`).test(line.trim())) { flush('code'); fence = null; }
    else lines.push(line);
  }
  flush(fence ? 'code' : 'text');
  return segments;
}
