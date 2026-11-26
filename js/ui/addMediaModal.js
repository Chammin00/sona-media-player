import { positionGlider } from './glider.js';

export class AddMediaModal {
  constructor(actions) {
    this.actions = actions;
    this.modal = document.getElementById('add-media-modal');
    this.closeBtn = document.getElementById('btn-close-modal');
    this.tabsBar = document.getElementById('modal-tabs');
    this.glider = document.getElementById('modal-glider');
    this.tabFiles = document.getElementById('modal-tab-files');
    this.tabUrl = document.getElementById('modal-tab-url');
    this.tabSubtitles = document.getElementById('modal-tab-subtitles');

    this.inputFiles = document.getElementById('input-local-files');
    this.inputFolder = document.getElementById('input-local-folder');
    this.importProgress = document.getElementById('import-progress');

    this.streamUrlInput = document.getElementById('input-stream-url');
    this.streamTitleInput = document.getElementById('input-stream-title');
    this.streamKindSelect = document.getElementById('input-stream-kind');

    this.inputSubtitle = document.getElementById('input-subtitle-file');
    this.subtitleStatus = document.getElementById('subtitle-status');
    this.clearSubsBtn = document.getElementById('btn-clear-subtitles');

    this.dropOverlay = document.getElementById('drop-overlay');
    this.activeTab = 'files';
    this.dragDepth = 0;

    this.bindEvents();
  }

  bindEvents() {
    this.closeBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    this.tabsBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-modal-tab]');
      if (!btn) return;
      this.setTab(btn.dataset.modalTab);
    });

    this.inputFiles.addEventListener('change', async () => {
      if (this.inputFiles.files && this.inputFiles.files.length > 0) {
        await this.handleFileImport(this.inputFiles.files);
        this.inputFiles.value = '';
      }
    });

    this.inputFolder.addEventListener('change', async () => {
      if (this.inputFolder.files && this.inputFolder.files.length > 0) {
        await this.handleFileImport(this.inputFolder.files);
        this.inputFolder.value = '';
      }
    });

    this.tabUrl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = this.streamUrlInput.value.trim();
      if (!url) return;
      await this.actions.addStreamUrl({
        url,
        title: this.streamTitleInput.value.trim(),
        kind: this.streamKindSelect.value,
      });
      this.streamUrlInput.value = '';
      this.streamTitleInput.value = '';
      this.close();
    });

    this.inputSubtitle.addEventListener('change', async () => {
      const file = this.inputSubtitle.files?.[0];
      if (!file) return;
      await this.actions.loadSubtitleFile(file);
      this.inputSubtitle.value = '';
      this.close();
    });

    this.clearSubsBtn.addEventListener('click', () => {
      this.actions.clearSubtitles();
      this.updateSubtitleStatus(0, '');
    });

    // Global Drag & Drop
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      this.dragDepth++;
      this.dropOverlay.classList.remove('hidden');
    });

    window.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
    });

    window.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) {
        this.dropOverlay.classList.add('hidden');
      }
    });

    window.addEventListener('drop', async (e) => {
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      this.dragDepth = 0;
      this.dropOverlay.classList.add('hidden');
      await this.actions.importDroppedFiles(e.dataTransfer.files);
    });
  }

  async handleFileImport(fileList) {
    this.importProgress.textContent = `Importing ${fileList.length} item(s)...`;
    this.importProgress.classList.remove('hidden');
    const added = await this.actions.importDroppedFiles(fileList);
    this.importProgress.classList.add('hidden');
    if (added > 0) this.close();
  }

  setTab(tab) {
    this.activeTab = tab;
    this.tabsBar.querySelectorAll('[data-modal-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.modalTab === tab);
    });
    this.tabFiles.classList.toggle('hidden', tab !== 'files');
    this.tabUrl.classList.toggle('hidden', tab !== 'url');
    this.tabSubtitles.classList.toggle('hidden', tab !== 'subtitles');
    requestAnimationFrame(() => positionGlider(this.tabsBar, this.glider));
  }

  open(tab = 'files') {
    this.modal.classList.remove('hidden');
    this.setTab(tab);
  }

  close() {
    this.modal.classList.add('hidden');
  }

  isOpen() {
    return !this.modal.classList.contains('hidden');
  }

  updateSubtitleStatus(cueCount, filename = '') {
    if (cueCount > 0) {
      this.subtitleStatus.textContent = `Active: ${filename || 'Subtitles'} (${cueCount} cues)`;
      this.clearSubsBtn.classList.remove('hidden');
    } else {
      this.subtitleStatus.textContent = 'No subtitle file loaded';
      this.clearSubsBtn.classList.add('hidden');
    }
  }
}
