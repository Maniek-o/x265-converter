const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v', '.mpg', '.mpeg']);
const THEME_STORAGE_KEY = 'x265-theme';
const IS_DESKTOP_RUNTIME = Boolean(
  (window.electronAPI && window.electronAPI.isElectron) ||
  String(navigator.userAgent || '').includes('Electron')
);
const IS_REMOTE_BACKEND = (() => {
  const host = String(window.location.hostname || '').toLowerCase();
  return Boolean(host && host !== '127.0.0.1' && host !== 'localhost');
})();

const state = {
  scannedFiles: [],
  jobs: [],
  summary: null,
  jobsRefreshPromise: null,
  lastJobsRefreshAt: null,
  backendMarkerText: 'Backend: sprawdzanie...',
  backendCpuHistory: [],
  presets: [],
  settings: {
    encoder: 'cpu',
    fpsMode: 'source',
    targetPercent: 55,
    qualityPreset: 'quality',
    audioCodec: 'opus',
    audioBitrateKbps: 96,
    maxConcurrentJobs: 1,
    testClipEnabled: false,
    smartQuality: false
  }
};

let previewWindowRef = null;
const pendingDurationPaths = new Set();

const elements = {
  sourcePath: document.querySelector('#sourcePath'),
  browseBtn: document.querySelector('#browseBtn'),
  scanBtn: document.querySelector('#scanBtn'),
  addFilesBtn: document.querySelector('#addFilesBtn'),
  dropzone: document.querySelector('#dropzone'),
  scanStatus: document.querySelector('#scanStatus'),
  filesListWrap: document.querySelector('#filesListWrap'),
  filesList: document.querySelector('#filesList'),
  toggleFilesSectionBtn: document.querySelector('#toggleFilesSectionBtn'),
  clearFilesBtn: document.querySelector('#clearFilesBtn'),
  toggleSelectionBtn: document.querySelector('#toggleSelectionBtn'),
  encoderSwitch: document.querySelector('#encoderSwitch'),
  fpsMode: document.querySelector('#fpsMode'),
  targetPercent: document.querySelector('#targetPercent'),
  targetPercentValue: document.querySelector('#targetPercentValue'),
  qualityPreset: document.querySelector('#qualityPreset'),
  audioCodec: document.querySelector('#audioCodec'),
  audioBitrate: document.querySelector('#audioBitrate'),
  maxConcurrentJobs: document.querySelector('#maxConcurrentJobs'),
  testClipEnabled: document.querySelector('#testClipEnabled'),
  smartQualityEnabled: document.querySelector('#smartQualityEnabled'),
  smartQualityHint: document.querySelector('#smartQualityHint'),
  settingsHeaderTitle: document.querySelector('#settingsHeaderTitle'),
  presetBtn: document.querySelector('#presetBtn'),
  presetDialog: document.querySelector('#presetDialog'),
  presetDialogCloseBtn: document.querySelector('#presetDialogCloseBtn'),
  presetListSelect: document.querySelector('#presetListSelect'),
  presetNameInput: document.querySelector('#presetNameInput'),
  presetSaveBtn: document.querySelector('#presetSaveBtn'),
  presetUpdateBtn: document.querySelector('#presetUpdateBtn'),
  presetLoadBtn: document.querySelector('#presetLoadBtn'),
  presetDeleteBtn: document.querySelector('#presetDeleteBtn'),
  presetDialogStatus: document.querySelector('#presetDialogStatus'),
  queueBtn: document.querySelector('#queueBtn'),
  toggleQueueSectionBtn: document.querySelector('#toggleQueueSectionBtn'),
  queueBody: document.querySelector('#queueBody'),
  queueControls: document.querySelector('#queueControls'),
  resumeAllBtn: document.querySelector('#resumeAllBtn'),
  stopAllBtn: document.querySelector('#stopAllBtn'),
  clearQueueBtn: document.querySelector('#clearQueueBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  overallProgressLabel: document.querySelector('#overallProgressLabel'),
  overallProgressBar: document.querySelector('#overallProgressBar'),
  currentJobSummary: document.querySelector('#currentJobSummary'),
  queueInlineStats: document.querySelector('#queueInlineStats'),
  queueStats: document.querySelector('#queueStats'),
  queueLastRefreshed: document.querySelector('#queueLastRefreshed'),
  backendMarker: document.querySelector('#backendMarker'),
  cpuMiniChart: document.querySelector('#cpuMiniChart'),
  jobsList: document.querySelector('#jobsList')
};

const settingsTabButtons = Array.from(document.querySelectorAll('[data-settings-tab]'));
const settingsTabPanels = Array.from(document.querySelectorAll('[data-settings-panel]'));
const topNavButtons = Array.from(document.querySelectorAll('[data-nav-action]'));

elements.scanBtn?.addEventListener('click', handleScan);
elements.browseBtn?.addEventListener('click', handleBrowseFolder);
elements.addFilesBtn?.addEventListener('click', handleAddFilesDialog);
elements.toggleFilesSectionBtn?.addEventListener('click', () => toggleCollapsible('files'));
elements.clearFilesBtn?.addEventListener('click', clearFilesToQueue);
elements.toggleSelectionBtn?.addEventListener('click', toggleSelection);
elements.presetBtn?.addEventListener('click', handlePresetButton);
elements.presetDialogCloseBtn?.addEventListener('click', closePresetDialog);
elements.presetDialog?.addEventListener('click', (event) => {
  if (event.target === elements.presetDialog) {
    closePresetDialog();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.presetDialog && !elements.presetDialog.hidden) {
    closePresetDialog();
  }
});
elements.presetListSelect?.addEventListener('change', syncPresetDialogSelection);
elements.presetSaveBtn?.addEventListener('click', savePresetFromDialog);
elements.presetUpdateBtn?.addEventListener('click', updatePresetFromDialog);
elements.presetLoadBtn?.addEventListener('click', loadPresetFromDialog);
elements.presetDeleteBtn?.addEventListener('click', deletePresetFromDialog);
elements.queueBtn?.addEventListener('click', enqueueSelected);
elements.toggleQueueSectionBtn?.addEventListener('click', () => toggleCollapsible('queue'));
elements.resumeAllBtn?.addEventListener('click', resumeAllJobs);
elements.stopAllBtn?.addEventListener('click', stopAllJobs);
elements.clearQueueBtn?.addEventListener('click', clearQueue);
elements.refreshBtn?.addEventListener('click', refreshJobs);
elements.targetPercent?.addEventListener('input', (event) => {
  state.settings.targetPercent = Number(event.target.value);
  elements.targetPercentValue.textContent = `${state.settings.targetPercent}%`;
  updatePresetChip();
});
elements.qualityPreset?.addEventListener('change', (event) => {
  state.settings.qualityPreset = event.target.value;
  updatePresetChip();
});
elements.audioCodec?.addEventListener('change', (event) => {
  state.settings.audioCodec = event.target.value;
});
elements.audioBitrate?.addEventListener('change', (event) => {
  state.settings.audioBitrateKbps = Number(event.target.value);
});
elements.maxConcurrentJobs?.addEventListener('change', async (event) => {
  const value = Number(event.target.value);
  await updateQueueConfig(value);
});
elements.fpsMode?.addEventListener('change', (event) => {
  state.settings.fpsMode = event.target.value === '24' ? '24' : 'source';
  updatePresetChip();
});
elements.testClipEnabled?.addEventListener('change', (event) => {
  state.settings.testClipEnabled = event.target.checked;
});
elements.smartQualityEnabled?.addEventListener('change', async (event) => {
  state.settings.smartQuality = event.target.checked;
  await refreshSmartQualityHint();
});

elements.encoderSwitch?.querySelectorAll('button').forEach((button) => {
  button.addEventListener('click', () => {
    state.settings.encoder = button.dataset.value;
    elements.encoderSwitch.querySelectorAll('button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    updatePresetChip();
  });
});

setupDropzone();
setupSettingsTabs();
initializeRuntimeMode();
applyTheme('dark');
initializeCollapsibleSections();
loadPresets();
closePresetDialog();

setInterval(() => {
  void refreshJobs();
  void refreshBackendMarker();
}, 2000);

void refreshBackendMarker();
void refreshJobs();
void loadQueueConfig();
void refreshSmartQualityHint();
updatePresetChip();

function updatePresetChip() {
  if (!elements.settingsHeaderTitle) {
    return;
  }

  const encoderLabel = state.settings.encoder === 'gpu' ? 'GPU' : 'CPU';
  const qualityLabel = String(state.settings.qualityPreset || 'quality');
  const fpsLabel = state.settings.fpsMode === '24' ? '24 FPS' : 'source FPS';
  const targetPercent = Number.isFinite(Number(state.settings.targetPercent))
    ? Math.round(Number(state.settings.targetPercent))
    : 55;

  elements.settingsHeaderTitle.innerHTML = `&#9881; Ustawienia <span class="muted compact">${encoderLabel} | ${qualityLabel} | ${fpsLabel} | ${targetPercent}%</span>`;
}

function initializeRuntimeMode() {
  if (!IS_REMOTE_BACKEND) {
    if (elements.addFilesBtn) {
      elements.addFilesBtn.hidden = false;
      elements.addFilesBtn.disabled = false;
    }
    elements.dropzone?.classList.remove('is-remote');
    return;
  }

  if (elements.sourcePath && !String(elements.sourcePath.value || '').trim()) {
    elements.sourcePath.value = '/data';
  }

  if (elements.browseBtn) {
    elements.browseBtn.disabled = false;
    elements.browseBtn.title = 'Tryb zdalny: ustaw sciezke na serwerze Unraid (np. /data).';
  }

  if (elements.addFilesBtn) {
    elements.addFilesBtn.hidden = true;
    elements.addFilesBtn.disabled = true;
    elements.addFilesBtn.title = 'Tryb zdalny: dodawanie lokalnych plikow jest niedostepne.';
  }

  elements.dropzone?.classList.add('is-remote');

  setScanStatus('Tryb zdalny: skanuj pliki z /data na serwerze Unraid.', false);
}

async function handleBrowseFolder(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }

  if (IS_REMOTE_BACKEND) {
    const currentPath = String(elements.sourcePath?.value || '/data').trim() || '/data';

    if (elements.sourcePath) {
      elements.sourcePath.value = currentPath;
      elements.sourcePath.focus();
      elements.sourcePath.select();
    }

    let selectedPath = null;
    try {
      selectedPath = window.prompt('Podaj sciezke na Unraid (np. /data lub /data/podfolder):', currentPath);
    } catch (_error) {
      selectedPath = null;
    }

    if (selectedPath == null) {
      setScanStatus('Wpisz sciezke w polu obok (np. /data) i kliknij Skanuj.', false);
      return;
    }

    const normalized = String(selectedPath).trim();
    if (!normalized) {
      setScanStatus('Podaj poprawna sciezke na serwerze Unraid.', true);
      return;
    }

    elements.sourcePath.value = normalized;
    setScanStatus('Ustawiono sciezke zrodla. Kliknij Skanuj.', false);
    return;
  }

  if (!window.electronAPI || typeof window.electronAPI.openFolderDialog !== 'function') {
    setScanStatus('Wybór folderu działa tylko w aplikacji desktop (Electron).', true);
    return;
  }

  try {
    const selected = await window.electronAPI.openFolderDialog();
    if (selected) {
      elements.sourcePath.value = selected;
      setScanStatus('Wybrano folder. Kliknij Skanuj.', false);
    }
  } catch (error) {
    setScanStatus(error.message || 'Nie udało się wybrać folderu.', true);
  }
}

async function handleAddFilesDialog() {
  if (IS_REMOTE_BACKEND) {
    setScanStatus('Tryb zdalny: dodawanie plikow z lokalnego dysku jest wylaczone.', true);
    return;
  }

  if (!window.electronAPI || typeof window.electronAPI.openFilesDialog !== 'function') {
    setScanStatus('Dodawanie plików przez dialog działa tylko w aplikacji desktop (Electron).', true);
    return;
  }

  try {
    const selected = await window.electronAPI.openFilesDialog();
    const selectedPaths = Array.isArray(selected) ? selected : [];
    
    if (!selectedPaths.length) {
      setScanStatus('Nie wybrano żadnych plików ani folderów.', false);
      return;
    }

    const allFiles = [];
    
    // Process each selected item (could be file or folder)
    for (const itemPath of selectedPaths) {
      const normalizedPath = typeof itemPath === 'string' ? itemPath : String(itemPath?.path || '').trim();
      if (!normalizedPath) continue;
      
      try {
        // Try to scan as folder first
        const scanResult = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: normalizedPath })
        });
        
        if (scanResult.ok) {
          // It's a folder - got files from scan
          const scanPayload = await scanResult.json();
          if (scanPayload.files && Array.isArray(scanPayload.files)) {
            allFiles.push(...scanPayload.files);
          }
        } else {
          // Not a folder, treat as single file
          allFiles.push({
            path: normalizedPath,
            name: typeof itemPath === 'string' ? basename(normalizedPath) : (itemPath?.name || basename(normalizedPath)),
            sizeBytes: typeof itemPath === 'string' ? 0 : (itemPath?.sizeBytes || 0)
          });
        }
      } catch (error) {
        // If scan fails, treat as single file
        allFiles.push({
          path: normalizedPath,
          name: typeof itemPath === 'string' ? basename(normalizedPath) : (itemPath?.name || basename(normalizedPath)),
          sizeBytes: typeof itemPath === 'string' ? 0 : (itemPath?.sizeBytes || 0)
        });
      }
    }

    if (!allFiles.length) {
      setScanStatus('Brak plików video w wyborze.', true);
      return;
    }

    const addedCount = mergeScannedFiles(allFiles);
    setScanStatus(`Dodano pliki i foldery: ${addedCount} plików video.`, false);
  } catch (error) {
    setScanStatus(error.message || 'Nie udało się dodać plików.', true);
  }
}

function setupDropzone() {
  if (!elements.dropzone) return;

  if (IS_REMOTE_BACKEND) {
    const label = elements.dropzone.querySelector('p');
    if (label) {
      label.textContent = 'Tryb zdalny: uzyj sciezki /data i przycisku Skanuj';
    }
    return;
  }

  ['dragenter', 'dragover'].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add('is-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove('is-over');
    });
  });

  elements.dropzone.addEventListener('drop', (event) => {
    const fallbackDroppedPaths = extractDroppedPathsFromDataTransfer(event.dataTransfer);
    const droppedRaw = Array.from(event.dataTransfer?.files || [])
      .map((file, index) => {
        const resolvedPath = resolveDroppedPath(file) || fallbackDroppedPaths[index] || '';
        return {
          path: resolvedPath,
          name: file.name || basename(resolvedPath || ''),
          sizeBytes: Number(file.size || 0),
          extension: extname(resolvedPath || file.name || '')
        };
      });

    if (!droppedRaw.length) {
      setScanStatus('Drop nie zawiera plików.', true);
      return;
    }

    const droppedSupported = droppedRaw
      .filter((file) => file.path && VIDEO_EXTENSIONS.has(file.extension));

    const droppedMissingPathSupported = droppedRaw
      .filter((file) => !file.path && VIDEO_EXTENSIONS.has(file.extension));

    const unsupportedExtensions = new Map();
    droppedRaw.forEach((file) => {
      if (!VIDEO_EXTENSIONS.has(file.extension)) {
        const label = file.extension || '(bez rozszerzenia)';
        unsupportedExtensions.set(label, (unsupportedExtensions.get(label) || 0) + 1);
      }
    });

    const missingPathSupportedExtensions = new Map();
    droppedMissingPathSupported.forEach((file) => {
      const label = file.extension || '(bez rozszerzenia)';
      missingPathSupportedExtensions.set(label, (missingPathSupportedExtensions.get(label) || 0) + 1);
    });

    const unsupportedSummary = [...unsupportedExtensions.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'pl'))
      .map(([extension, count]) => `${extension}${count > 1 ? ` x${count}` : ''}`)
      .join(', ');

    const missingPathSummary = [...missingPathSupportedExtensions.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'pl'))
      .map(([extension, count]) => `${extension}${count > 1 ? ` x${count}` : ''}`)
      .join(', ');

    if (!droppedSupported.length) {
      if (missingPathSummary) {
        let message = `Wykryto obsługiwane pliki video (${missingPathSummary}), ale aplikacja nie dostała lokalnej ścieżki pliku z drop.`;
        if (unsupportedSummary) {
          message += ` Dodatkowo odrzucono: ${unsupportedSummary}.`;
        }
        if (IS_DESKTOP_RUNTIME) {
          message += ' Użyj przycisku "Dodaj pliki z dysku" dla tych pozycji.';
        } else {
          message += ' Jesteś w trybie WWW: użyj skanowania folderu albo uruchom aplikację desktop (Electron).';
        }
        setScanStatus(message, true);
        return;
      }

      const message = unsupportedSummary
        ? `Brak obsługiwanych plików video w drop. Odrzucono: ${unsupportedSummary}.`
        : 'Brak obsługiwanych plików video w drop.';
      setScanStatus(message, true);
      return;
    }

    const addedCount = mergeScannedFiles(droppedSupported);
    const skippedUnsupported = droppedRaw.filter((file) => !VIDEO_EXTENSIONS.has(file.extension)).length;
    const skippedMissingPath = droppedMissingPathSupported.length;
    const skippedDuplicates = droppedSupported.length - addedCount;

    if (!addedCount) {
      setScanStatus('Pliki z drop są już na liście lub nie są obsługiwane.', true);
      return;
    }

    let statusMessage = `Dodano przez drag&drop: ${addedCount} plików.`;
    if (skippedUnsupported > 0) {
      statusMessage += ` Pominięto nieobsługiwane: ${skippedUnsupported}`;
      if (unsupportedSummary) {
        statusMessage += ` (${unsupportedSummary})`;
      }
      statusMessage += '.';
    }
    if (skippedMissingPath > 0) {
      statusMessage += ` Bez lokalnej ścieżki z drop: ${skippedMissingPath}`;
      if (missingPathSummary) {
        statusMessage += ` (${missingPathSummary})`;
      }
      if (IS_DESKTOP_RUNTIME) {
        statusMessage += '. Użyj "Dodaj pliki z dysku" dla tych pozycji.';
      } else {
        statusMessage += '. W trybie WWW użyj skanowania folderu lub aplikacji desktop.';
      }
    }
    if (skippedDuplicates > 0) {
      statusMessage += ` Pominięto duplikaty: ${skippedDuplicates}.`;
    }

    setScanStatus(statusMessage, false);
  });
}

async function refreshSmartQualityHint() {
  if (!elements.smartQualityHint) return;

  if (!state.settings.smartQuality) {
    elements.smartQualityHint.textContent = 'Probe-based 1-pass (próbki): wyłączony.';
    return;
  }

  const selected = state.scannedFiles.find((file) => file.selected) || state.scannedFiles[0];
  if (!selected) {
    elements.smartQualityHint.textContent = 'Probe-based 1-pass (próbki): włączony. Zaznacz plik, aby zobaczyć analizę.';
    return;
  }

  try {
    const response = await fetch('/api/suggest-quality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: selected.path })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Brak sugestii Probe-based 1-pass (próbki).');
    }

    const v = payload.analysis || {};
    const fps = Number(v.fps || 0);
    const probeCrf = Number(payload.crf || 24);
    // Build same adaptive candidate range as server (±2 from probe CRF, clamped 20-30)
    const rawCands = [-2, -1, 0, 1, 2].map((d) => Math.max(20, Math.min(30, probeCrf + d)));
    const cands = [...new Set(rawCands)];
    const candHtml = cands.map((c) => {
      // Each CRF step ≈ 6% size change relative to probe CRF
      const pct = Math.round(100 * Math.pow(0.94, c - probeCrf));
      const cls = c === probeCrf ? 'sq-cand sq-cand-base' : 'sq-cand';
      return `<span class="${cls}">CRF&nbsp;${c}&nbsp;(~${pct}%)</span>`;
    }).join('<span class="sq-arrow"> → </span>');
    const warnHtml = payload.warning
      ? `<span class="sq-warn"> · ${payload.warning}</span>`
      : '';
    elements.smartQualityHint.innerHTML =
      `<b>Probe-based 1-pass (próbki)</b>: bazowo&nbsp;CRF&nbsp;<b>${probeCrf}</b> · ` +
      `${v.width || 0}×${v.height || 0}, ${fps.toFixed(1)}&nbsp;fps, <em>${v.codec || 'unknown'}</em>${warnHtml}` +
      `<br><span class="sq-label">Kandydaci próbkowania: </span>${candHtml}`;
  } catch (error) {
    elements.smartQualityHint.textContent = `Probe-based 1-pass (próbki): błąd analizy (${error.message}).`;
  }
}

async function handleScan() {
  const sourcePath = elements.sourcePath.value.trim();
  if (!sourcePath) {
    setScanStatus('Podaj folder do skanowania.', true);
    return;
  }

  setScanStatus('Skanuję folder rekurencyjnie...', false);
  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Skanowanie nie powiodło się.');
    }

    mergeScannedFiles(payload.files);
    await refreshSmartQualityHint();
    setScanStatus(`Znaleziono ${payload.files.length} plików video (rekurencyjnie).`, false);
  } catch (error) {
    setScanStatus(error.message, true);
  }
}

function mergeScannedFiles(newFiles) {
  const byPath = new Map(state.scannedFiles.map((file) => [file.path.toLowerCase(), file]));
  let addedCount = 0;
  for (const file of newFiles) {
    const normalizedPath = String(file.path || '').trim();
    if (!normalizedPath || !VIDEO_EXTENSIONS.has(extname(normalizedPath))) {
      continue;
    }

    const key = normalizedPath.toLowerCase();
    if (!byPath.has(key)) {
      byPath.set(key, {
        path: normalizedPath,
        name: file.name || basename(normalizedPath),
        sizeBytes: Number(file.sizeBytes || 0),
        durationSeconds: Number(file.durationSeconds || 0),
        selected: true
      });
      addedCount += 1;
    } else {
      const existing = byPath.get(key);
      const incomingDuration = Number(file.durationSeconds || 0);
      if ((!Number.isFinite(existing.durationSeconds) || existing.durationSeconds <= 0) && incomingDuration > 0) {
        existing.durationSeconds = incomingDuration;
      }
    }
  }

  state.scannedFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path, 'pl'));
  renderFiles();
  void hydrateMissingDurations();
  return addedCount;
}

async function hydrateMissingDurations() {
  const candidates = state.scannedFiles.filter((file) => {
    const hasDuration = Number.isFinite(Number(file.durationSeconds)) && Number(file.durationSeconds) > 0;
    return !hasDuration && !pendingDurationPaths.has(file.path);
  });

  if (!candidates.length) {
    return;
  }

  const requests = candidates.map(async (file) => {
    pendingDurationPaths.add(file.path);
    try {
      const response = await fetch('/api/preview/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFile: file.path })
      });
      const payload = await response.json();
      if (!response.ok) {
        return null;
      }

      const durationSeconds = Number(payload.durationSeconds || 0);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return null;
      }

      return { path: file.path, durationSeconds };
    } catch (_error) {
      return null;
    } finally {
      pendingDurationPaths.delete(file.path);
    }
  });

  const resolved = (await Promise.all(requests)).filter(Boolean);
  if (!resolved.length) {
    return;
  }

  const byPath = new Map(resolved.map((item) => [item.path.toLowerCase(), item.durationSeconds]));
  state.scannedFiles = state.scannedFiles.map((file) => {
    const matchedDuration = byPath.get(String(file.path || '').toLowerCase());
    if (!matchedDuration) {
      return file;
    }
    return {
      ...file,
      durationSeconds: matchedDuration
    };
  });
  renderFiles();
}

function toggleSelection() {
  if (!state.scannedFiles.length) return;
  state.scannedFiles = state.scannedFiles.map((file) => ({ ...file, selected: !file.selected }));
  renderFiles();
  void refreshSmartQualityHint();
}

function clearFilesToQueue() {
  if (!state.scannedFiles.length) {
    setScanStatus('Lista plików jest już pusta.', false);
    return;
  }

  state.scannedFiles = [];
  renderFiles();
  setScanStatus('Wyczyszczono kolejkę plików.', false);
  void refreshSmartQualityHint();
}

function renderFiles() {
  if (!state.scannedFiles.length) {
    elements.filesList.innerHTML = 'Brak danych do wyświetlenia.';
    elements.filesList.classList.add('empty-state');
    return;
  }

  elements.filesList.classList.remove('empty-state');
  elements.filesList.innerHTML = state.scannedFiles.map((file, index) => {
    const dirPath = dirname(file.path);
    const slash = dirPath ? '\\' : '';
    return `
      <div class="file-row file-row-compact">
        <input type="checkbox" data-index="${index}" ${file.selected ? 'checked' : ''}>
        <span class="file-path-inline">${escapeHtml(dirPath)}${slash}<strong class="file-name-inline">${escapeHtml(file.name)}</strong></span>
        <span class="file-size">${formatBytes(file.sizeBytes)} | ${formatDurationShort(file.durationSeconds)}</span>
        <button type="button" class="ghost small preview-btn" data-preview-index="${index}">Podgląd testowy</button>
      </div>
    `;
  }).join('');

  elements.filesList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const index = Number(event.target.dataset.index);
      state.scannedFiles[index].selected = event.target.checked;
      void refreshSmartQualityHint();
    });
  });

  elements.filesList.querySelectorAll('[data-preview-index]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(button.dataset.previewIndex);
      openSamplePreviewWindow(index);
    });
  });
}

function openSamplePreviewWindow(index) {
  const file = state.scannedFiles[index];
  if (!file) return;

  const params = new URLSearchParams({
    mode: 'sample',
    sourceFile: file.path,
    settings: JSON.stringify({
      ...state.settings,
      testClipEnabled: false
    })
  });

  openPreviewWindow(`/preview.html?${params.toString()}`, `Otwarto podgląd testowy dla: ${file.name}`);
}

function openResultCompareWindow(job) {
  const params = new URLSearchParams({
    mode: 'result',
    sourceFile: job.sourceFile,
    encodedFile: job.outputPath,
    settings: JSON.stringify(job.settings || state.settings)
  });
  if (job.status === 'processing') {
    params.set('live', '1');
  }
  openPreviewWindow(`/preview.html?${params.toString()}`, `Otwarto porównanie wynikowe: ${basename(job.sourceFile)}`);
}

function openPreviewWindow(url, statusText) {
  if (previewWindowRef && !previewWindowRef.closed) {
    previewWindowRef.close();
    previewWindowRef = null;
  }

  const features = 'popup=yes,width=1460,height=920,menubar=no,toolbar=no,location=no,status=no';
  previewWindowRef = window.open(url, 'x265-preview-window', features);
  if (previewWindowRef) {
    previewWindowRef.focus();
    setScanStatus(statusText, false);
  } else {
    setScanStatus('Przeglądarka zablokowała popup. Zezwól na okna dla aplikacji.', true);
  }
}

async function enqueueSelected() {
  const sourceFiles = state.scannedFiles.filter((file) => file.selected).map((file) => file.path);
  if (!sourceFiles.length) {
    setScanStatus('Zaznacz przynajmniej jeden plik.', true);
    return;
  }

  elements.queueBtn.disabled = true;
  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFiles, settings: state.settings })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Dodanie do kolejki nie powiodło się.');
    }

    await refreshJobs();
    setScanStatus(`Dodano ${payload.jobs.length} pozycji do kolejki.`, false);
  } catch (error) {
    setScanStatus(error.message, true);
  } finally {
    elements.queueBtn.disabled = false;
  }
}

async function refreshJobs() {
  if (state.jobsRefreshPromise) return state.jobsRefreshPromise;

  state.jobsRefreshPromise = (async () => {
    try {
      const response = await fetch('/api/jobs');
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Nie udało się odświeżyć kolejki.');
      }

      state.jobs = payload.jobs || [];
      state.summary = payload.summary || null;
      if (payload.config && Number.isFinite(Number(payload.config.maxConcurrentJobs))) {
        state.settings.maxConcurrentJobs = Math.max(1, Math.min(5, Number(payload.config.maxConcurrentJobs)));
        if (elements.maxConcurrentJobs) {
          elements.maxConcurrentJobs.value = String(state.settings.maxConcurrentJobs);
        }
      }
      state.lastJobsRefreshAt = new Date();
      renderJobs();
    } catch (error) {
      elements.queueStats.textContent = error.message;
    } finally {
      state.jobsRefreshPromise = null;
    }
  })();

  return state.jobsRefreshPromise;
}

async function loadQueueConfig() {
  try {
    const response = await fetch('/api/queue/config');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Nie udało się pobrać konfiguracji kolejki.');
    }
    const nextValue = Math.max(1, Math.min(5, Number(payload.maxConcurrentJobs || 1)));
    state.settings.maxConcurrentJobs = nextValue;
    if (elements.maxConcurrentJobs) {
      elements.maxConcurrentJobs.value = String(nextValue);
    }
  } catch (_error) {
    // Ignore to keep UI usable with defaults.
  }
}

async function updateQueueConfig(maxConcurrentJobs) {
  const normalized = Math.max(1, Math.min(5, Number(maxConcurrentJobs || 1)));
  state.settings.maxConcurrentJobs = normalized;
  if (elements.maxConcurrentJobs) {
    elements.maxConcurrentJobs.value = String(normalized);
    elements.maxConcurrentJobs.disabled = true;
  }

  try {
    const response = await fetch('/api/queue/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentJobs: normalized })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Nie udało się zmienić limitu jednoczesnych konwersji.');
    }
    state.jobs = payload.jobs || state.jobs;
    state.summary = payload.summary || state.summary;
    renderJobs();
  } catch (error) {
    elements.queueStats.textContent = error.message || 'Nie udało się zmienić limitu jednoczesnych konwersji.';
  } finally {
    if (elements.maxConcurrentJobs) {
      elements.maxConcurrentJobs.disabled = false;
    }
  }
}

async function resumeAllJobs() {
  elements.resumeAllBtn.disabled = true;
  try {
    const response = await fetch('/api/queue/resume-all', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Nie udało się wznowić zadań.');
    }

    state.jobs = payload.jobs || [];
    state.summary = payload.summary || null;
    renderJobs();
    if (payload.resumedCount > 0) {
      elements.queueStats.textContent = `Wznowiono ${payload.resumedCount} zadań.`;
    } else {
      elements.queueStats.textContent = 'Brak zadań do wznowienia.';
    }
  } catch (error) {
    elements.queueStats.textContent = error.message;
  } finally {
    elements.resumeAllBtn.disabled = false;
  }
}

async function stopAllJobs() {
  elements.stopAllBtn.disabled = true;
  try {
    const response = await fetch('/api/queue/stop-all', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Nie udało się zatrzymać zadań.');
    }

    state.jobs = payload.jobs || [];
    state.summary = payload.summary || null;
    renderJobs();
  } catch (error) {
    elements.queueStats.textContent = error.message;
  } finally {
    elements.stopAllBtn.disabled = false;
  }
}

async function clearQueue() {
  const shouldClear = window.confirm('Na pewno zatrzymać i usunąć całą kolejkę?');
  if (!shouldClear) return;

  elements.clearQueueBtn.disabled = true;
  try {
    const response = await fetch('/api/queue', { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Nie udało się wyczyścić kolejki.');
    }

    state.jobs = payload.jobs || [];
    state.summary = payload.summary || null;
    renderJobs();
  } catch (error) {
    elements.queueStats.textContent = error.message;
  } finally {
    elements.clearQueueBtn.disabled = false;
  }
}

function renderJobs() {
  renderQueueLastRefreshed();

  const hasJobs = Array.isArray(state.jobs) && state.jobs.length > 0;
  if (elements.queueControls) {
    elements.queueControls.hidden = !hasJobs;
  }

  if (!hasJobs) {
    renderOverallProgress(0);
    if (elements.currentJobSummary) {
      elements.currentJobSummary.textContent = 'Brak aktywnie konwertowanego pliku.';
    }
    if (elements.queueInlineStats) {
      elements.queueInlineStats.textContent = 'Przekonwertowano: 0/0 (0.0%) | Aktywne: 0 | W kolejce: 0';
    }
    elements.queueStats.textContent = 'Brak aktywnych zadań.';
    elements.jobsList.textContent = 'Kolejka jest pusta.';
    elements.jobsList.classList.add('empty-state');
    return;
  }

  const summary = state.summary || {
    preparing: state.jobs.filter((job) => job.status === 'preparing').length,
    processing: state.jobs.filter((job) => job.status === 'processing').length,
    paused: state.jobs.filter((job) => job.status === 'paused').length,
    queued: state.jobs.filter((job) => job.status === 'queued').length,
    completed: state.jobs.filter((job) => job.status === 'completed').length,
    skipped: state.jobs.filter((job) => job.status === 'skipped').length,
    failed: state.jobs.filter((job) => job.status === 'failed').length,
    cancelled: state.jobs.filter((job) => job.status === 'cancelled').length,
    overallProgressPercent: 0
  };

  renderOverallProgress(summary.overallProgressPercent || 0);
  renderCurrentJobSummary(summary);

  const totalJobs = state.jobs.length;
  const convertedJobs = Number(summary.completed || 0);
  const convertedPct = totalJobs > 0 ? (convertedJobs / totalJobs) * 100 : 0;
  const queueTiming = buildQueueTimingInfo(summary);

  const queueHeading = elements.jobsList.closest('section')?.querySelector('h2') || document.querySelector('#queueSection h2');
  if (queueHeading) {
    queueHeading.textContent = `Kolejka | ${convertedJobs}/${totalJobs} (${convertedPct.toFixed(1)}%)`;
  }
  if (elements.queueInlineStats) {
    elements.queueInlineStats.textContent = `Przekonwertowano: ${convertedJobs}/${totalJobs} (${convertedPct.toFixed(1)}%) | Aktywne: ${(summary.processing || 0) + (summary.paused || 0)} | W kolejce: ${summary.queued || 0}`;
  }

  elements.queueStats.textContent =
    `Przekonwertowano: ${convertedJobs}/${totalJobs} (${convertedPct.toFixed(1)}%) | Aktywne: ${summary.processing || 0} | Pauza: ${summary.paused || 0} | Pozostało w kolejce: ${summary.queued || 0} | Pominięte: ${summary.skipped || 0} | Błędy: ${summary.failed || 0} | Anulowane: ${summary.cancelled || 0} | Czas kolejki: ${queueTiming.elapsedText} | Pozostało: ${queueTiming.remainingText}`;

  const prioritizedJobs = [...state.jobs].sort((a, b) => {
    const rank = (status) => {
      if (status === 'processing') return 0;
      if (status === 'paused') return 1;
      if (status === 'preparing') return 2;
      if (status === 'queued') return 3;
      if (status === 'failed') return 4;
      if (status === 'cancelled') return 5;
      if (status === 'skipped') return 6;
      if (status === 'completed') return 7;
      return 8;
    };
    const rankDiff = rank(a.status) - rank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  elements.jobsList.classList.remove('empty-state');
  elements.jobsList.innerHTML = `
    <div class="queue-table-wrap">
      <table class="queue-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Plik</th>
            <th>Postęp</th>
            <th>Rozmiar</th>
            <th>Czas</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          ${prioritizedJobs.map((job) => renderJobRow(job)).join('')}
        </tbody>
      </table>
    </div>
  `;

  elements.jobsList.querySelectorAll('[data-cancel-job]').forEach((button) => {
    button.addEventListener('click', async () => {
      const jobId = Number(button.dataset.cancelJob);
      try {
        await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
        await refreshJobs();
      } catch (error) {
        elements.queueStats.textContent = error.message || 'Nie udało się anulować zadania.';
      }
    });
  });

  elements.jobsList.querySelectorAll('[data-resume-job]').forEach((button) => {
    button.addEventListener('click', async () => {
      const jobId = Number(button.dataset.resumeJob);
      try {
        const response = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Nie udało się wznowić zadania.');
        }
        await refreshJobs();
      } catch (error) {
        elements.queueStats.textContent = error.message || 'Nie udało się wznowić zadania.';
      }
    });
  });

  elements.jobsList.querySelectorAll('[data-stream-job]').forEach((button) => {
    button.addEventListener('click', () => {
      const jobId = Number(button.dataset.streamJob);
      if (!jobId) return;
      try {
        // Construct stream URL using current window location
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port ? `:${window.location.port}` : '';
        const streamUrl = `${protocol}//${hostname}${port}/api/jobs/${jobId}/stream`;
        
        // Open stream URL in new window/tab; browser will handle MIME type
        // If VLC is default player for video, it will launch automatically
        window.open(streamUrl, '_blank');
      } catch (error) {
        elements.queueStats.textContent = error.message || 'Nie udało się otworzyć pliku w odtwarzaczu.';
      }
    });
  });

  elements.jobsList.querySelectorAll('[data-compare-output]').forEach((button) => {
    button.addEventListener('click', () => {
      const jobId = Number(button.dataset.compareOutput);
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) {
        openResultCompareWindow(job);
      }
    });
  });

  elements.jobsList.querySelectorAll('[data-preview-source]').forEach((button) => {
    button.addEventListener('click', () => {
      const pathValue = button.dataset.previewSource;
      const index = state.scannedFiles.findIndex((file) => file.path === pathValue);
      if (index >= 0) {
        openSamplePreviewWindow(index);
      } else {
        openPreviewWindow(`/preview.html?${new URLSearchParams({
          mode: 'sample',
          sourceFile: pathValue,
          settings: JSON.stringify(state.settings)
        }).toString()}`, 'Otwarto podgląd testowy.');
      }
    });
  });

  ensureActiveJobVisible();
}

function renderCurrentJobSummary(summary) {
  if (!elements.currentJobSummary) {
    return;
  }

  const total = state.jobs.length;
  const active = state.jobs.find((job) => job.status === 'processing') || state.jobs.find((job) => job.status === 'paused') || state.jobs.find((job) => job.status === 'preparing');
  const completedLike = (summary.completed || 0) + (summary.skipped || 0) + (summary.failed || 0) + (summary.cancelled || 0);
  const currentIndex = Math.min(total, completedLike + (active ? 1 : 0));
  const pct = Number(summary.overallProgressPercent || 0);

  if (!active) {
    elements.currentJobSummary.textContent = `Postęp: ${Math.max(0, currentIndex)}/${total} | ${pct.toFixed(1)}% | Brak aktywnego pliku`;
    return;
  }

  const activeName = basename(active.sourceFile || '');
  const activeFps = Number(active.metrics?.fps || 0);
  const activeEta = active.metrics?.etaSeconds == null ? '...' : formatEta(active.metrics.etaSeconds);
  const statusLabelText = active.status === 'paused' ? 'Wstrzymane' : 'Aktualnie konwertuje';
  elements.currentJobSummary.textContent = `${statusLabelText}: ${activeName} | ${currentIndex}/${total} | ${pct.toFixed(1)}% | ETA: ${activeEta} | ${activeFps.toFixed(1)} fps`;
}

function ensureActiveJobVisible() {
  const activeRow = elements.jobsList.querySelector('tr.queue-row.status-processing')
    || elements.jobsList.querySelector('tr.queue-row.status-paused');
  elements.jobsList.querySelectorAll('tr.queue-row').forEach((row) => row.classList.remove('is-current-job'));
  if (!activeRow) {
    return;
  }

  activeRow.classList.add('is-current-job');
}

function setupTopNav() {
  if (!topNavButtons.length) {
    return;
  }

  topNavButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.navAction;
      if (action === 'source') {
        document.querySelector('#sourceSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (action === 'presets') {
        document.querySelector('#settingsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const summaryTab = settingsTabButtons.find((item) => item.dataset.settingsTab === 'summary');
        summaryTab?.click();
        return;
      }

      if (action === 'queue') {
        document.querySelector('#queueSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (action === 'help') {
        setScanStatus('Pomoc: przeciągnij pliki video lub użyj "Dodaj pliki z dysku", potem kliknij "Dodaj zaznaczone do kolejki".', false);
      }
    });
  });

  updateTopNavQueueState();
}

function updateTopNavQueueState() {
  const queueButton = topNavButtons.find((button) => button.dataset.navAction === 'queue');
  if (!queueButton) {
    return;
  }

  const hasQueueItems = Array.isArray(state.jobs) && state.jobs.length > 0;
  queueButton.classList.toggle('is-attention', hasQueueItems);
  queueButton.setAttribute('aria-label', hasQueueItems ? 'Kolejka (aktywna)' : 'Kolejka');
}

function renderJobRow(job) {
  const progress = Number(job.metrics?.progressPercent || 0);
  const eta = job.metrics?.etaSeconds == null ? '...' : formatEta(job.metrics.etaSeconds);
  const fps = job.metrics?.fps ? `${job.metrics.fps.toFixed(1)} fps` : '0 fps';
  const sourceSize = Number(job.metrics?.sourceSizeBytes || 0);
  const outputSize = Number(job.metrics?.currentSizeBytes || 0);
  const conversionSeconds = job.metrics?.conversionSeconds;
  const sourceDuration = Number(job.metrics?.sourceDurationSeconds || 0);
  const durationText = sourceDuration > 0 ? formatDuration(sourceDuration) : '—';
  const status = statusLabel(job.status);

  const savedPercent = Number(job.sizeSavedPercent);
  const hasSavings = Number.isFinite(savedPercent);
  const savingsText = hasSavings ? `${savedPercent >= 0 ? '-' : '+'}${Math.abs(savedPercent).toFixed(1)}%` : '-';
  const savingsClass = hasSavings ? (savedPercent >= 0 ? 'good' : 'bad') : '';

  const canCompareResult = (job.status === 'completed' || job.status === 'processing') && Boolean(job.outputPath);
  const canOpenResult = job.status === 'completed' && Boolean(job.outputPath);

  const notes = [];
  if (job.skipReason) notes.push(job.skipReason);
  if (job.error) notes.push(`Błąd: ${job.error}`);
  const notesHtml = notes.length ? `<div class="job-row-note">${escapeHtml(notes.join(' | '))}</div>` : '';
  // UKRYTE: const createdAtText = formatIsoDateTime(job.createdAt);
  // UKRYTE: const startedAtText = formatIsoDateTime(job.startedAt);
  // UKRYTE: const finishedAtText = formatIsoDateTime(job.finishedAt);
  // UKRYTE: const timestampsHtml = `<div class="job-row-time">Dodano: ${escapeHtml(createdAtText)} | Start: ${escapeHtml(startedAtText)} | Koniec: ${escapeHtml(finishedAtText)}</div>`;
  const timestampsHtml = ''; // Ukryte timestamps

  const actions = [];
  if (job.status === 'processing' || job.status === 'paused' || job.status === 'queued' || job.status === 'preparing') {
    actions.push(`<button class="ghost small" data-cancel-job="${job.id}">Anuluj</button>`);
  }
  if (job.status === 'cancelled' || job.status === 'failed' || job.status === 'paused') {
    actions.push(`<button class="ghost small" data-resume-job="${job.id}">Wznów</button>`);
  }
  actions.push(`<button class="action-btn small" data-preview-source="${escapeHtmlAttr(job.sourceFile)}">Podgląd</button>`);
  if (canCompareResult) {
    const compareLabel = job.status === 'processing' ? 'Podgląd na żywo' : 'Porównaj';
    actions.push(`<button class="action-btn small" data-compare-output="${job.id}">${compareLabel}</button>`);
  }
  if (canOpenResult) {
    actions.push(`<button class="action-btn small" data-stream-job="${job.id}">Otwórz</button>`);
  }

  return `
    <tr class="queue-row status-${job.status}">
      <td><span class="status-pill">${status}</span></td>
      <td>
        <div class="job-row-file">${escapeHtml(basename(job.sourceFile))}</div>
        <div class="job-row-path">${escapeHtml(job.outputPath || '(brak pliku wynikowego)')}</div>
        ${timestampsHtml}
        ${notesHtml}
      </td>
      <td>
        <div class="job-row-progress">${progress.toFixed(1)}%</div>
        <div class="inline-progress"><span style="width:${progress}%"></span></div>
        <div class="job-row-meta">ETA: ${eta} · ${fps}</div>
      </td>
      <td>
        <div>Org: ${formatBytes(sourceSize)} | ${durationText}</div>
        <div>Po: ${formatBytes(outputSize)}</div>
        <div class="saving-badge ${savingsClass}">${savingsText}</div>
      </td>
      <td>${conversionSeconds == null ? '-' : formatEta(conversionSeconds)}</td>
      <td><div class="row-actions">${actions.join('')}</div></td>
    </tr>
  `;
}

function setScanStatus(message, isError) {
  elements.scanStatus.textContent = message;
  elements.scanStatus.classList.toggle('error-text', Boolean(isError));
}

function statusLabel(status) {
  const labels = {
    preparing: 'Przygotowywanie',
    queued: 'W kolejce',
    processing: 'Przetwarzanie',
    paused: 'Wstrzymane',
    completed: 'Gotowe',
    skipped: 'Pominięte',
    failed: 'Błąd',
    cancelled: 'Anulowane'
  };
  return labels[status] || status;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatEta(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDurationShort(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '...';
  const rounded = Math.max(0, Math.round(seconds));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function buildQueueTimingInfo(summary) {
  const nowMs = Date.now();
  const startedTimes = state.jobs
    .map((job) => job.startedAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  const queueStartedAt = startedTimes.length ? Math.min(...startedTimes) : null;
  const elapsedSeconds = queueStartedAt ? Math.max(0, Math.floor((nowMs - queueStartedAt) / 1000)) : 0;

  const activeJobs = state.jobs.filter((job) => job.status === 'processing' || job.status === 'paused');
  const queuedCount = Number(summary.queued || 0) + Number(summary.preparing || 0);
  const activeEtaSum = activeJobs
    .map((job) => Number(job.metrics?.etaSeconds || 0))
    .reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);

  const finishedJobs = state.jobs.filter((job) => job.status === 'completed' && Number.isFinite(Number(job.metrics?.conversionSeconds || 0)));
  const avgCompletedSeconds = finishedJobs.length
    ? finishedJobs.reduce((acc, job) => acc + Number(job.metrics?.conversionSeconds || 0), 0) / finishedJobs.length
    : 0;

  const concurrency = Math.max(1, Number(state.settings.maxConcurrentJobs || 1));
  const queuedEtaEstimate = avgCompletedSeconds > 0 ? (queuedCount * avgCompletedSeconds) / concurrency : 0;
  const remainingSeconds = Math.max(0, Math.round(activeEtaSum + queuedEtaEstimate));

  return {
    elapsedSeconds,
    remainingSeconds,
    elapsedText: formatEta(elapsedSeconds),
    remainingText: formatEta(remainingSeconds)
  };
}

function renderOverallProgress(progressPercent) {
  const safeProgress = Math.min(100, Math.max(0, Number(progressPercent || 0)));
  elements.overallProgressLabel.textContent = `Całość przekonwertowana: ${safeProgress.toFixed(1)}%`;
  elements.overallProgressBar.style.width = `${safeProgress}%`;
}

function renderQueueLastRefreshed() {
  elements.queueLastRefreshed.textContent = `Ostatnio odświeżono: ${formatRefreshTime(state.lastJobsRefreshAt)}`;
}

function formatRefreshTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('pl-PL');
}

async function refreshBackendMarker() {
  try {
    const response = await fetch('/api/health');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Brak /api/health');
    }

    const appHost = String(window.location.host || `${payload.host || '127.0.0.1'}:${Number(payload.port || 3001)}`);
    const cpuTotal = Number.isFinite(Number(payload.cpuUsagePercent))
      ? Number(payload.cpuUsagePercent)
      : 0;
    // RAM info usunięty - nie potrzebny
    // const rss = Number.isFinite(Number(payload.processRssMB))
    //   ? `${Number(payload.processRssMB).toFixed(0)} MB`
    //   : '-';

    state.backendCpuHistory.push(cpuTotal);
    if (state.backendCpuHistory.length > 32) {
      state.backendCpuHistory.shift();
    }

    state.backendMarkerText = `Backend: ${appHost} | CPU: ${cpuTotal.toFixed(1)}%`;
    drawCpuMiniChart();
  } catch (_error) {
    state.backendMarkerText = 'Backend: niedostępny';
  }
  if (elements.backendMarker) {
    elements.backendMarker.textContent = state.backendMarkerText;
  }
}

function drawCpuMiniChart() {
  if (!elements.cpuMiniChart) {
    return;
  }

  const canvas = elements.cpuMiniChart;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#d2dbe8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(w, h - 1);
  ctx.stroke();

  const values = state.backendCpuHistory;
  if (!values.length) {
    return;
  }

  const stepX = values.length > 1 ? (w - 2) / (values.length - 1) : 0;
  ctx.strokeStyle = '#2f6fbe';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  values.forEach((v, index) => {
    const x = 1 + index * stepX;
    const y = h - 2 - ((Math.max(0, Math.min(100, Number(v))) / 100) * (h - 4));
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function formatIsoDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pl-PL');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll('`', '');
}

function basename(filePath) {
  const normalized = String(filePath || '').replaceAll('/', '\\');
  const idx = normalized.lastIndexOf('\\');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function dirname(filePath) {
  const normalized = String(filePath || '').replaceAll('/', '\\');
  const idx = normalized.lastIndexOf('\\');
  return idx === -1 ? '' : normalized.slice(0, idx);
}

function extname(filePath) {
  const name = basename(filePath).toLowerCase();
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx);
}

function resolveDroppedPath(file) {
  const directPath = String(file?.path || '').trim();
  if (directPath) {
    return directPath;
  }

  const resolver = window.electronAPI?.resolveDroppedFilePath;
  if (typeof resolver === 'function') {
    try {
      return String(resolver(file) || '').trim();
    } catch (_error) {
      return '';
    }
  }

  return '';
}

function extractDroppedPathsFromDataTransfer(dataTransfer) {
  if (!dataTransfer || typeof dataTransfer.getData !== 'function') {
    return [];
  }

  const results = [];
  const seen = new Set();
  const addPath = (candidate) => {
    const normalized = String(candidate || '').trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    results.push(normalized);
  };

  const parseTextPayload = (payload) => {
    if (!payload) {
      return;
    }

    String(payload)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const fileUriPath = parseFileUriToWindowsPath(line);
        if (fileUriPath) {
          addPath(fileUriPath);
          return;
        }

        if (/^[A-Za-z]:\\/.test(line)) {
          addPath(line);
        }
      });
  };

  parseTextPayload(dataTransfer.getData('text/uri-list'));
  parseTextPayload(dataTransfer.getData('text/plain'));
  return results;
}

function parseFileUriToWindowsPath(value) {
  const raw = String(value || '').trim();
  if (!raw.toLowerCase().startsWith('file://')) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'file:') {
      return '';
    }

    const decodedPath = decodeURIComponent(parsed.pathname || '');
    if (!decodedPath) {
      return '';
    }

    const windowsPath = /^\/[A-Za-z]:/.test(decodedPath)
      ? decodedPath.slice(1)
      : decodedPath;

    return windowsPath.replaceAll('/', '\\');
  } catch (_error) {
    return '';
  }
}

function initializeCollapsibleSections() {
  if (elements.queueBody) {
    elements.queueBody.classList.add('is-collapsed');
  }
  refreshCollapsibleButtonLabels();
}

function toggleCollapsible(target) {
  if (target === 'files' && elements.filesListWrap) {
    elements.filesListWrap.classList.toggle('is-collapsed');
  }
  if (target === 'queue' && elements.queueBody) {
    elements.queueBody.classList.toggle('is-collapsed');
  }
  refreshCollapsibleButtonLabels();
}

function refreshCollapsibleButtonLabels() {
  if (elements.toggleFilesSectionBtn && elements.filesListWrap) {
    const collapsed = elements.filesListWrap.classList.contains('is-collapsed');
    elements.toggleFilesSectionBtn.textContent = collapsed ? 'Rozwiń' : 'Ukryj';
  }
  if (elements.toggleQueueSectionBtn && elements.queueBody) {
    const collapsed = elements.queueBody.classList.contains('is-collapsed');
    elements.toggleQueueSectionBtn.textContent = collapsed ? 'Rozwiń' : 'Ukryj';
  }
}

function loadPresets() {
  try {
    const raw = localStorage.getItem('x265-presets');
    state.presets = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.presets)) {
      state.presets = [];
    }
  } catch (_error) {
    state.presets = [];
  }
}

function savePresets() {
  try {
    localStorage.setItem('x265-presets', JSON.stringify(state.presets));
  } catch (_error) {
    // Ignore storage errors.
  }
}

function settingsSnapshot() {
  return {
    encoder: state.settings.encoder,
    fpsMode: state.settings.fpsMode,
    targetPercent: state.settings.targetPercent,
    qualityPreset: state.settings.qualityPreset,
    audioCodec: state.settings.audioCodec,
    audioBitrateKbps: state.settings.audioBitrateKbps,
    testClipEnabled: state.settings.testClipEnabled,
    smartQuality: state.settings.smartQuality
  };
}

function applySettingsToUi() {
  if (elements.encoderSwitch) {
    elements.encoderSwitch.querySelectorAll('button').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.value === state.settings.encoder);
    });
  }
  if (elements.fpsMode) elements.fpsMode.value = state.settings.fpsMode === '24' ? '24' : 'source';
  if (elements.targetPercent) elements.targetPercent.value = String(state.settings.targetPercent);
  if (elements.targetPercentValue) elements.targetPercentValue.textContent = `${state.settings.targetPercent}%`;
  if (elements.qualityPreset) elements.qualityPreset.value = state.settings.qualityPreset;
  if (elements.audioCodec) elements.audioCodec.value = state.settings.audioCodec;
  if (elements.audioBitrate) elements.audioBitrate.value = String(state.settings.audioBitrateKbps);
  if (elements.testClipEnabled) elements.testClipEnabled.checked = Boolean(state.settings.testClipEnabled);
  if (elements.smartQualityEnabled) elements.smartQualityEnabled.checked = Boolean(state.settings.smartQuality);
  updatePresetChip();
  void refreshSmartQualityHint();
}

function handlePresetButton() {
  if (!elements.presetDialog) {
    return;
  }

  renderPresetDialog();
  elements.presetDialog.hidden = false;
  elements.presetNameInput?.focus();
}

function closePresetDialog() {
  if (elements.presetDialog) {
    elements.presetDialog.hidden = true;
  }
}

function renderPresetDialog(selectedIndex = 0) {
  if (!elements.presetListSelect || !elements.presetDialogStatus) {
    return;
  }

  elements.presetListSelect.innerHTML = '';

  if (!state.presets.length) {
    elements.presetDialogStatus.textContent = 'Brak zapisanych presetów. Możesz zapisać bieżące ustawienia jako nowy preset.';
    if (elements.presetNameInput) {
      elements.presetNameInput.value = '';
    }
    return;
  }

  state.presets.forEach((preset, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = preset.name;
    elements.presetListSelect.append(option);
  });

  const normalizedIndex = Math.max(0, Math.min(state.presets.length - 1, selectedIndex));
  elements.presetListSelect.value = String(normalizedIndex);
  syncPresetDialogSelection();
}

function syncPresetDialogSelection() {
  if (!elements.presetListSelect || !elements.presetDialogStatus || !elements.presetNameInput) {
    return;
  }

  const idx = Number(elements.presetListSelect.value);
  const selectedPreset = state.presets[idx];
  if (!selectedPreset) {
    elements.presetDialogStatus.textContent = 'Brak wybranego presetu.';
    return;
  }

  elements.presetNameInput.value = selectedPreset.name;
  elements.presetDialogStatus.textContent = `Wybrany preset: ${selectedPreset.name}`;
}

function savePresetFromDialog() {
  const name = String(elements.presetNameInput?.value || '').trim();
  if (!name) {
    setPresetDialogStatus('Podaj nazwę nowego presetu.', true);
    return;
  }

  state.presets.push({ name, settings: settingsSnapshot() });
  savePresets();
  renderPresetDialog(state.presets.length - 1);
  setPresetDialogStatus(`Zapisano nowy preset: ${name}`, false);
  setScanStatus(`Zapisano preset: ${name}`, false);
}

function updatePresetFromDialog() {
  const idx = Number(elements.presetListSelect?.value);
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.presets.length) {
    setPresetDialogStatus('Wybierz preset do aktualizacji.', true);
    return;
  }

  const name = String(elements.presetNameInput?.value || state.presets[idx].name).trim();
  state.presets[idx] = {
    name: name || state.presets[idx].name,
    settings: settingsSnapshot()
  };
  savePresets();
  renderPresetDialog(idx);
  setPresetDialogStatus(`Zaktualizowano preset: ${state.presets[idx].name}`, false);
  setScanStatus(`Zaktualizowano preset: ${state.presets[idx].name}`, false);
}

function loadPresetFromDialog() {
  const idx = Number(elements.presetListSelect?.value);
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.presets.length) {
    setPresetDialogStatus('Wybierz preset do wczytania.', true);
    return;
  }

  state.settings = {
    ...state.settings,
    ...(state.presets[idx].settings || {})
  };
  applySettingsToUi();
  setPresetDialogStatus(`Wczytano preset: ${state.presets[idx].name}`, false);
  setScanStatus(`Wczytano preset: ${state.presets[idx].name}`, false);
}

function deletePresetFromDialog() {
  const idx = Number(elements.presetListSelect?.value);
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.presets.length) {
    setPresetDialogStatus('Wybierz preset do usunięcia.', true);
    return;
  }

  const removed = state.presets.splice(idx, 1);
  savePresets();
  renderPresetDialog(Math.max(0, idx - 1));
  setPresetDialogStatus(`Usunięto preset: ${removed[0]?.name || 'preset'}`, false);
  setScanStatus(`Usunięto preset: ${removed[0]?.name || 'preset'}`, false);
}

function setPresetDialogStatus(message, isError) {
  if (!elements.presetDialogStatus) {
    return;
  }

  elements.presetDialogStatus.textContent = message;
  elements.presetDialogStatus.classList.toggle('error-text', Boolean(isError));
}

function setupSettingsTabs() {
  if (!settingsTabButtons.length || !settingsTabPanels.length) {
    return;
  }

  const activateTab = (tabName) => {
    settingsTabButtons.forEach((button) => {
      const isActive = button.dataset.settingsTab === tabName;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    settingsTabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== tabName;
    });
  };

  settingsTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.settingsTab);
    });
  });

  activateTab(settingsTabButtons[0].dataset.settingsTab);
}

function setupThemeToggle() {
  let initialTheme = 'light';
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
      initialTheme = savedTheme;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      initialTheme = 'dark';
    }
  } catch (_error) {
    initialTheme = 'light';
  }

  applyTheme(initialTheme);

  if (!elements.themeToggle) {
    return;
  }

  elements.themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (_error) {
      // Ignore storage errors; theme still changes for the current session.
    }
  });
}

function applyTheme(theme) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalizedTheme;
  if (elements.themeToggle) {
    elements.themeToggle.textContent = normalizedTheme === 'dark' ? 'Motyw: Ciemny' : 'Motyw: Jasny';
    elements.themeToggle.setAttribute('aria-pressed', normalizedTheme === 'dark' ? 'true' : 'false');
  }
}