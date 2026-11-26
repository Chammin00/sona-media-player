export function positionGlider(barEl, gliderEl) {
  if (!barEl || !gliderEl) return;
  const activeBtn = barEl.querySelector('.seg-btn.active');
  if (!activeBtn) return;

  const barRect = barEl.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  if (barRect.width === 0 || btnRect.width === 0) return;

  const offsetLeft = activeBtn.offsetLeft;
  gliderEl.style.width = `${btnRect.width}px`;
  gliderEl.style.transform = `translateX(${Math.max(0, offsetLeft - 3)}px)`;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
