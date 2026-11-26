function parseTimestamp(raw) {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(clean) || 0;
}

function cleanCueText(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .trim();
}

export function parseSubtitles(content) {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE')) continue;

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const timingLine = lines[timingIndex];
    const [startRaw, endRawWithSettings] = timingLine.split('-->');
    if (!startRaw || !endRawWithSettings) continue;

    const endRaw = endRawWithSettings.trim().split(/\s+/)[0];
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    const text = cleanCueText(lines.slice(timingIndex + 1).join('\n'));

    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      cues.push({ start, end, text });
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

export function getActiveSubtitle(cues, currentTime) {
  if (!cues || cues.length === 0) return null;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (currentTime >= cue.start && currentTime <= cue.end) {
      return cue;
    }
    if (cue.start > currentTime) break;
  }
  return null;
}
