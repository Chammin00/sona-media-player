import { DEFAULT_PALETTE, extractPaletteFromImage } from './palettes.js';
import { extractWaveformPeaks, generateFallbackPeaks } from './waveform.js';

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'weba', 'aiff', 'wma',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi']);

export function inferMediaKindFromName(name, mimeType = '') {
  if (mimeType) {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
  }
  const cleanName = String(name || '').split('?')[0].split('#')[0];
  const ext = cleanName.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
}

export function isSubtitleFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'vtt' || ext === 'srt';
}

export function parseTitleArtistFromFilename(filename) {
  const base = String(filename || '').replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  const stripped = base.replace(/^\d{1,3}\s*[-.]\s*/, '');
  const parts = stripped.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim() || 'Local Artist',
      title: parts.slice(1).join(' - ').trim() || stripped,
    };
  }
  return {
    title: stripped || 'Untitled Media',
    artist: 'Local Library',
  };
}

function bytesToDataUrl(data, mime) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, i + chunkSize);
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function readSynchsafe(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function decodeId3Text(bytes, encoding) {
  if (!bytes || bytes.length === 0) return '';
  try {
    if (encoding === 0) {
      return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
    }
    if (encoding === 1) {
      const hasBomLE = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
      const hasBomBE = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
      const decoder = new TextDecoder(hasBomBE ? 'utf-16be' : 'utf-16le');
      const slice = hasBomLE || hasBomBE ? bytes.subarray(2) : bytes;
      return decoder.decode(slice).replace(/\0/g, '').trim();
    }
    if (encoding === 2) {
      return new TextDecoder('utf-16be').decode(bytes).replace(/\0/g, '').trim();
    }
    return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

function parseId3v2(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }

  const version = bytes[3];
  if (version < 3 || version > 4) return null;
  const flags = bytes[5];
  const tagSize = readSynchsafe(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);

  let offset = 10;
  if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
    const extSize = version === 4 ? readSynchsafe(bytes, offset) : readUint32BE(bytes, offset);
    offset += version === 4 ? extSize : extSize + 4;
  }

  const result = {};

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize =
      version === 4 ? readSynchsafe(bytes, offset + 4) : readUint32BE(bytes, offset + 4);
    offset += 10;
    if (frameSize <= 0 || offset + frameSize > tagEnd) break;

    const payload = bytes.subarray(offset, offset + frameSize);
    offset += frameSize;

    if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB') {
      const encoding = payload[0];
      const text = decodeId3Text(payload.subarray(1), encoding);
      if (frameId === 'TIT2' && text) result.title = text;
      if (frameId === 'TPE1' && text) result.artist = text;
      if (frameId === 'TALB' && text) result.album = text;
    } else if (frameId === 'APIC' && !result.artworkUrl && payload.length > 8) {
      const encoding = payload[0];
      let cursor = 1;
      while (cursor < payload.length && payload[cursor] !== 0) cursor++;
      const mime =
        new TextDecoder('ascii').decode(payload.subarray(1, cursor)).trim() || 'image/jpeg';
      cursor += 2; // null + picture type
      if (encoding === 1 || encoding === 2) {
        while (cursor + 1 < payload.length && !(payload[cursor] === 0 && payload[cursor + 1] === 0)) {
          cursor += 2;
        }
        cursor += 2;
      } else {
        while (cursor < payload.length && payload[cursor] !== 0) cursor++;
        cursor += 1;
      }
      if (cursor < payload.length) {
        const imgBytes = payload.subarray(cursor);
        if (imgBytes.length > 32) {
          const safeMime = mime.startsWith('image/') ? mime : 'image/jpeg';
          result.artworkUrl = bytesToDataUrl(imgBytes, safeMime);
        }
      }
    }
  }

  return result;
}

function parseMp4Ilst(bytes) {
  const result = {};
  const textDec = new TextDecoder('utf-8');

  function findDataAtom(start, end) {
    let pos = start;
    while (pos + 8 <= end) {
      const size = readUint32BE(bytes, pos);
      if (size < 8 || pos + size > end) break;
      const type = String.fromCharCode(
        bytes[pos + 4],
        bytes[pos + 5],
        bytes[pos + 6],
        bytes[pos + 7]
      );
      if (type === 'data' && size > 16) {
        const dataType = readUint32BE(bytes, pos + 8);
        return { dataType, payload: bytes.subarray(pos + 16, pos + size) };
      }
      pos += size;
    }
    return null;
  }

  function scanBoxes(start, end) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = readUint32BE(bytes, pos);
      if (size === 0) size = end - pos;
      if (size < 8 || pos + size > end) break;

      const b4 = bytes[pos + 4];
      const b5 = bytes[pos + 5];
      const b6 = bytes[pos + 6];
      const b7 = bytes[pos + 7];
      const type = String.fromCharCode(b4, b5, b6, b7);

      if (type === 'moov' || type === 'udta' || type === 'ilst') {
        scanBoxes(pos + 8, pos + size);
      } else if (type === 'meta' && size > 12) {
        scanBoxes(pos + 12, pos + size);
      } else if (b4 === 0xa9 && b5 === 0x6e && b6 === 0x61 && b7 === 0x6d) {
        const atom = findDataAtom(pos + 8, pos + size);
        if (atom) result.title = textDec.decode(atom.payload).trim();
      } else if (b4 === 0xa9 && b5 === 0x41 && b6 === 0x52 && b7 === 0x54) {
        const atom = findDataAtom(pos + 8, pos + size);
        if (atom) result.artist = textDec.decode(atom.payload).trim();
      } else if (b4 === 0xa9 && b5 === 0x61 && b6 === 0x6c && b7 === 0x62) {
        const atom = findDataAtom(pos + 8, pos + size);
        if (atom) result.album = textDec.decode(atom.payload).trim();
      } else if (type === 'covr' && !result.artworkUrl) {
        const atom = findDataAtom(pos + 8, pos + size);
        if (atom && atom.payload.length > 32) {
          const mime = atom.dataType === 14 ? 'image/png' : 'image/jpeg';
          result.artworkUrl = bytesToDataUrl(atom.payload, mime);
        }
      }
      pos += size;
    }
  }

  scanBoxes(0, bytes.length);
  return result;
}

async function parseEmbeddedTags(file) {
  try {
    const headerSlice = file.slice(0, Math.min(file.size, 768 * 1024));
    const buf = await headerSlice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return parseId3v2(bytes);
    }
    if (bytes.length >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
      return parseMp4Ilst(bytes);
    }
  } catch {
    // Ignore tag parse errors cleanly
  }
  return null;
}

async function probeMediaElementMetadata(src, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;

    const finish = (duration, thumbnailUrl) => {
      el.removeAttribute('src');
      el.load();
      resolve({ duration: Number.isFinite(duration) ? duration : 0, thumbnailUrl });
    };

    const timer = window.setTimeout(() => finish(0), 4000);

    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      if (kind !== 'video') {
        window.clearTimeout(timer);
        finish(duration);
        return;
      }

      const targetTime = duration > 0 ? Math.min(2, duration * 0.2) : 0.2;
      el.onseeked = () => {
        window.clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          const vw = el.videoWidth || 512;
          const vh = el.videoHeight || 288;
          const scale = Math.min(1, 512 / vw);
          canvas.width = Math.max(160, Math.round(vw * scale));
          canvas.height = Math.max(90, Math.round(vh * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
            finish(duration, canvas.toDataURL('image/jpeg', 0.85));
            return;
          }
        } catch {
          // Ignore thumbnail draw error
        }
        finish(duration);
      };

      try {
        el.currentTime = targetTime;
      } catch {
        window.clearTimeout(timer);
        finish(duration);
      }
    };

    el.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };

    el.src = src;
  });
}

export async function extractTrackFromFile(file) {
  const kind = inferMediaKindFromName(file.name, file.type);
  if (!kind) return null;

  const fallback = parseTitleArtistFromFilename(file.name);
  const tags = await parseEmbeddedTags(file);

  const title = tags?.title || fallback.title;
  const artist = tags?.artist || fallback.artist;
  const album = tags?.album || (kind === 'video' ? 'Video Library' : 'Local Audio');
  let artworkUrl = tags?.artworkUrl;

  const src = URL.createObjectURL(file);
  const probed = await probeMediaElementMetadata(src, kind);
  const duration = probed.duration;
  if (!artworkUrl && probed.thumbnailUrl) {
    artworkUrl = probed.thumbnailUrl;
  }

  const palette = artworkUrl ? await extractPaletteFromImage(artworkUrl) : DEFAULT_PALETTE;
  const peaks =
    kind === 'audio'
      ? await extractWaveformPeaks(src, 96)
      : generateFallbackPeaks(file.name, 96);

  const id = `local-${crypto.randomUUID()}`;
  return {
    id,
    title,
    artist,
    album,
    duration,
    kind,
    sourceType: 'local',
    src,
    artworkUrl,
    palette,
    mimeType: file.type || undefined,
    addedAt: Date.now(),
    favorite: false,
    peaks,
    blobKey: id,
  };
}
