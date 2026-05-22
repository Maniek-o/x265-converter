const query = new URLSearchParams(window.location.search);
const mode = query.get('mode') === 'result' ? 'result' : 'sample';
const sourceFile = query.get('sourceFile') || '';
const encodedFile = query.get('encodedFile') || '';
const isLiveMode = query.get('live') === '1';

let settings = {
  encoder: 'cpu',
  targetPercent: 55,
  qualityPreset: 'quality',
  audioCodec: 'opus',
  audioBitrateKbps: 96,
  testClipEnabled: false
};

try {
  const rawSettings = query.get('settings');
  if (rawSettings) {
    settings = { ...settings, ...JSON.parse(rawSettings) };
  }
} catch (_error) {
  // fallback defaults
}

const elements = {
  fileTitle: document.querySelector('#fileTitle'),
  metaText: document.querySelector('#metaText'),
  backendMarker: document.querySelector('#backendMarker'),
  closeBtn: document.querySelector('#closeBtn'),
  clipDuration: document.querySelector('#clipDuration'),
  prepMode: document.querySelector('#prepMode'),
  previewQualityPreset: document.querySelector('#previewQualityPreset'),
  zoomScale: document.querySelector('#zoomScale'),
  previewTargetPercent: document.querySelector('#previewTargetPercent'),
  targetSizeHint: document.querySelector('#targetSizeHint'),
  generateBtn: document.querySelector('#generateBtn'),
  startSlider: document.querySelector('#startSlider'),
  startValue: document.querySelector('#startValue'),
  endValue: document.querySelector('#endValue'),
  framePreviewTime: document.querySelector('#framePreviewTime'),
  framePreviewImage: document.querySelector('#framePreviewImage'),
  sliderHoverPreview: document.querySelector('#sliderHoverPreview'),
  sliderHoverImage: document.querySelector('#sliderHoverImage'),
  sliderHoverTime: document.querySelector('#sliderHoverTime'),
  progressLabel: document.querySelector('#progressLabel'),
  progressValue: document.querySelector('#progressValue'),
  stageDetail: document.querySelector('#stageDetail'),
  progressBar: document.querySelector('#progressBar'),
  videoOriginal: document.querySelector('#videoOriginal'),
  videoEncoded: document.querySelector('#videoEncoded'),
  divider: document.querySelector('#divider'),
  stage: document.querySelector('#stage'),
  stageWrap: document.querySelector('.stage-wrap'),
  stageFullscreenBtn: document.querySelector('#stageFullscreenBtn'),
  resultTransportCard: document.querySelector('#resultTransportCard'),
  resultPlayPauseBtn: document.querySelector('#resultPlayPauseBtn'),
  resultSeekSlider: document.querySelector('#resultSeekSlider'),
  resultSeekCurrent: document.querySelector('#resultSeekCurrent'),
  resultSeekDuration: document.querySelector('#resultSeekDuration'),
  sourceHintText: document.querySelector('#sourceHintText'),
  encodedHintText: document.querySelector('#encodedHintText'),
  errorText: document.querySelector('#errorText')
};

const state = {
  sourceDuration: 0,
  sessionId: null,
  statusPoller: null,
  baseVideoWidth: 0,
  baseVideoHeight: 0,
  framePreviewDebounceId: null,
  framePreviewAbortController: null,
  framePreviewRequestSeq: 0,
  activeFramePreviewObjectUrl: null,
  hoverPreviewDebounceId: null,
  hoverPreviewAbortController: null,
  hoverPreviewRequestSeq: 0,
  activeHoverPreviewObjectUrl: null,
  hoverPreviewIdleHideTimer: null,
  hoverPreviewLastTimeSeconds: null,
  timelineTouchActive: false,
  syncRaf: null,
  syncing: false,
  dividerPosition: 0.5,
  draggingDivider: false,
  dividerHoverActive: false,
  splitRenderRaf: null,
  dividerVisualDirty: false,
  wheelZoomScale: 1,
  panningEnabled: false,
  panningActive: false,
  panStartX: 0,
  panStartY: 0,
  panStartScrollLeft: 0,
  panStartScrollTop: 0,
  sourceSizeBytes: 0,
  encodedSizeBytes: 0,
  resultSeekDragging: false
};

elements.closeBtn.addEventListener('click', () => window.close());
elements.clipDuration.addEventListener('change', () => {
  updateTimelineLabels();
  scheduleFramePreview();
});
elements.previewQualityPreset?.addEventListener('change', (event) => {
  settings.qualityPreset = event.target.value === 'speed' || event.target.value === 'balanced'
    ? event.target.value
    : 'quality';
});
elements.previewTargetPercent?.addEventListener('input', (event) => {
  const value = Number(event.target.value || 55);
  settings.targetPercent = Math.max(20, Math.min(95, Number.isFinite(value) ? value : 55));
  updateTargetSizeHint();
});
elements.startSlider.addEventListener('input', () => {
  updateTimelineLabels();
  scheduleFramePreview();
  if (state.timelineTouchActive) {
    const point = getTimelinePointFromValue(Number(elements.startSlider.value || 0));
    if (point) {
      showHoverPreviewAt(point, true);
    }
  }
});
elements.generateBtn.addEventListener('click', startPreviewGeneration);
elements.zoomScale.addEventListener('change', () => {
  const selectedScale = Number(elements.zoomScale.value || 1);
  if (Number.isFinite(selectedScale) && selectedScale > 0) {
    state.wheelZoomScale = selectedScale;
  }
  applyScale();
});
setupDividerDragger();
setupStageFullscreen();
setupWheelZoom();
setupStagePanning();
setupKeyboardShortcuts();

window.addEventListener('beforeunload', () => {
  stopPolling();
  cancelSyncLoop();
  abortFramePreviewRequest();
  clearFramePreviewObjectUrl();
  abortHoverPreviewRequest();
  clearHoverPreviewObjectUrl();
  if (state.sessionId) {
    fetch(`/api/preview/${encodeURIComponent(state.sessionId)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
});

init().catch((error) => {
  setError(error.message || 'Nie udało się zainicjalizować podglądu.');
});

async function init() {
  if (!sourceFile) {
    throw new Error('Brak sourceFile w adresie okna podglądu.');
  }

  if (mode === 'result' && !encodedFile) {
    throw new Error('Brak encodedFile dla trybu porównania końcowego.');
  }

  if (mode === 'result') {
    document.body.classList.add('result-mode');
    if (elements.resultTransportCard) {
      elements.resultTransportCard.hidden = false;
    }
    if (elements.videoEncoded) {
      elements.videoEncoded.controls = false;
    }
  }

  elements.fileTitle.textContent = `Podglad: ${basename(sourceFile)}`;
  updateTargetSizeHint();
  if (elements.previewQualityPreset) {
    const initialPreset = settings.qualityPreset === 'speed' || settings.qualityPreset === 'balanced'
      ? settings.qualityPreset
      : 'quality';
    elements.previewQualityPreset.value = initialPreset;
    settings.qualityPreset = initialPreset;
  }
  if (elements.previewTargetPercent) {
    const initialTargetPercent = clampPercent(settings.targetPercent, 55);
    settings.targetPercent = initialTargetPercent;
    elements.previewTargetPercent.value = String(initialTargetPercent);
  }
  await loadBackendMarker();
  await loadMeta();
  updateTimelineLabels();
  state.wheelZoomScale = Number(elements.zoomScale.value || 1);
  applyScale();
  applySplit();
  setupVideoSync();
  scheduleFramePreview(true);

  if (mode === 'result') {
    setProgress('Ładowanie plików...', 10, 0, null);
    const originalUrl = `/api/preview/direct/video?filePath=${encodeURIComponent(sourceFile)}`;
    const encodedUrl = `/api/preview/direct/video?filePath=${encodeURIComponent(encodedFile)}`;
    try {
      await loadPreviewVideos(originalUrl, encodedUrl);
      setupResultTransport();
      if (isLiveMode) {
        setProgress('Podgląd częściowy — konwersja trwa. Kliknij „Odśwież" aby załadować więcej.', 100, 100, null);
        showLiveReloadBanner();
      }
    } catch (_directError) {
      // In result mode always prefer full-file compare and avoid 1-minute fallback generation.
      setProgress('Nie udało się załadować pełnego porównania.', 0, 0, null);
      setError('Ten format nie jest odtwarzalny bezpośrednio w podglądzie przeglądarki. Użyj "Otwórz" (VLC) albo przekoduj wynik do kompatybilnego kontenera.');
    }
  }
}

function setupResultTransport() {
  const source = elements.videoOriginal;
  const target = elements.videoEncoded;
  const slider = elements.resultSeekSlider;
  const currentEl = elements.resultSeekCurrent;
  const durationEl = elements.resultSeekDuration;
  const playPauseBtn = elements.resultPlayPauseBtn;

  if (mode !== 'result' || !source || !target || !slider) {
    return;
  }

  const refreshDuration = () => {
    const duration = Number.isFinite(source.duration) ? Number(source.duration) : state.sourceDuration;
    const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
    slider.max = String(safeDuration);
    if (durationEl) {
      durationEl.textContent = formatTime(safeDuration);
    }
  };

  const refreshCurrent = () => {
    const current = Math.max(0, Number(source.currentTime || 0));
    if (!state.resultSeekDragging) {
      slider.value = String(current);
    }
    if (currentEl) {
      currentEl.textContent = formatTime(current);
    }
  };

  const syncFromSlider = () => {
    const time = Math.max(0, Number(slider.value || 0));
    source.currentTime = time;
    target.currentTime = time;
    if (currentEl) {
      currentEl.textContent = formatTime(time);
    }
  };

  slider.addEventListener('pointerdown', () => {
    state.resultSeekDragging = true;
  });
  slider.addEventListener('pointerup', () => {
    state.resultSeekDragging = false;
    syncFromSlider();
  });
  slider.addEventListener('pointercancel', () => {
    state.resultSeekDragging = false;
  });
  slider.addEventListener('input', syncFromSlider);

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      if (source.paused) {
        source.play().catch(() => {});
      } else {
        source.pause();
      }
    });
  }

  source.addEventListener('loadedmetadata', refreshDuration);
  source.addEventListener('durationchange', refreshDuration);
  source.addEventListener('timeupdate', refreshCurrent);
  source.addEventListener('seeked', refreshCurrent);

  refreshDuration();
  refreshCurrent();
}

function updateTargetSizeHint() {
  if (!elements.targetSizeHint) {
    return;
  }

  const percent = clampPercent(settings.targetPercent, 55);
  elements.targetSizeHint.textContent = `${percent}%`;
}

function clampPercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(20, Math.min(95, Math.round(numeric)));
}

async function loadMeta() {
  if (mode === 'result') {
    const response = await fetch('/api/preview/direct/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFile, encodedFile })
    });

    const payload = await readJsonResponse(response, 'Nie udało się odczytać metadanych porównania wynikowego.');
    state.sourceDuration = Number(payload.sourceDurationSeconds || 0);
    state.sourceSizeBytes = Number(payload.sourceSizeBytes || 0);
    state.encodedSizeBytes = Number(payload.encodedSizeBytes || 0);
    elements.metaText.textContent =
      `Tryb wynikowy | Oryginał: ${payload.sourceWidth || '?'}x${payload.sourceHeight || '?'} | ` +
      `Wynik: ${payload.encodedWidth || '?'}x${payload.encodedHeight || '?'} | ` +
      `Czas: ${formatTime(state.sourceDuration)}`;
    updateDividerSizeHints();

    const duration = Number(elements.clipDuration.value);
    const maxStart = Math.max(0, state.sourceDuration - duration);
    elements.startSlider.max = String(maxStart);
    elements.startSlider.value = '0';
    return;
  }

  const response = await fetch('/api/preview/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceFile })
  });

  const payload = await readJsonResponse(response, 'Nie udało się odczytać metadanych pliku.');

  state.sourceDuration = Number(payload.durationSeconds || 0);
  state.sourceSizeBytes = 0;
  state.encodedSizeBytes = 0;
  updateDividerSizeHints();
  elements.metaText.textContent = `Pelna dlugosc: ${formatTime(state.sourceDuration)} | Rozdzielczosc: ${payload.width || '?'}x${payload.height || '?'}`;

  const duration = Number(elements.clipDuration.value);
  const maxStart = Math.max(0, state.sourceDuration - duration);
  elements.startSlider.max = String(maxStart);
  elements.startSlider.value = '0';
}

async function loadBackendMarker() {
  if (!elements.backendMarker) {
    return;
  }

  try {
    const response = await fetch('/api/health');
    const payload = await readJsonResponse(response, 'Nie udało się odczytać stanu backendu.');
    const startedAt = formatDateTime(payload.startedAt);
    const host = payload.host || '127.0.0.1';
    const port = Number(payload.port || 3001);
    const instanceId = payload.instanceId || 'brak';
    const pid = Number(payload.pid || 0) || '—';
    elements.backendMarker.textContent = `Backend: ${host}:${port} | instancja: ${instanceId} | PID: ${pid} | start: ${startedAt}`;
  } catch (_error) {
    elements.backendMarker.textContent = 'Backend: niedostepny';
  }
}

function updateTimelineLabels() {
  const duration = Number(elements.clipDuration.value || 60);
  const maxStart = Math.max(0, state.sourceDuration - duration);
  const currentStart = Math.min(maxStart, Number(elements.startSlider.value || 0));

  elements.startSlider.max = String(maxStart);
  elements.startSlider.value = String(currentStart);
  elements.startValue.textContent = `Start: ${formatTime(currentStart)}`;
  elements.endValue.textContent = `Koniec: ${formatTime(currentStart + duration)}`;
  if (elements.framePreviewTime) {
    elements.framePreviewTime.textContent = `Czas: ${formatTime(currentStart)}`;
  }
}

function scheduleFramePreview(immediate = false) {
  if (!sourceFile || !elements.framePreviewImage) {
    return;
  }

  if (state.framePreviewDebounceId) {
    clearTimeout(state.framePreviewDebounceId);
    state.framePreviewDebounceId = null;
  }

  if (immediate) {
    void loadFramePreview();
    return;
  }

  state.framePreviewDebounceId = setTimeout(() => {
    state.framePreviewDebounceId = null;
    void loadFramePreview();
  }, 170);
}

function setupTimelineHoverPreview() {
  const slider = elements.startSlider;
  const hoverBox = elements.sliderHoverPreview;
  if (!slider || !hoverBox) {
    return;
  }

  const handlePointerMove = (event) => {
    if (!Number.isFinite(event.clientX)) {
      return;
    }
    const point = getTimelinePoint(event.clientX);
    if (!point) {
      return;
    }

    showHoverPreviewAt(point, false);
  };

  slider.addEventListener('pointerenter', handlePointerMove);
  slider.addEventListener('pointermove', handlePointerMove);

  slider.addEventListener('pointerdown', (event) => {
    handlePointerMove(event);
  });

  const handleTouchMove = (event) => {
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (!touch || !Number.isFinite(touch.clientX)) {
      return;
    }

    const point = getTimelinePoint(touch.clientX);
    if (!point) {
      return;
    }

    showHoverPreviewAt(point, false);
  };

  slider.addEventListener('touchstart', (event) => {
    state.timelineTouchActive = true;
    handleTouchMove(event);
  }, { passive: true });

  slider.addEventListener('touchmove', handleTouchMove, { passive: true });

  const finishTouchPreview = () => {
    state.timelineTouchActive = false;
    hideTimelineHoverPreview();
  };

  slider.addEventListener('touchend', finishTouchPreview, { passive: true });
  slider.addEventListener('touchcancel', finishTouchPreview, { passive: true });

  slider.addEventListener('pointerleave', hideTimelineHoverPreview);
  slider.addEventListener('blur', hideTimelineHoverPreview);
  window.addEventListener('blur', hideTimelineHoverPreview);
}

function getTimelinePoint(clientX) {
  const slider = elements.startSlider;
  if (!slider) {
    return null;
  }

  const sliderRect = slider.getBoundingClientRect();
  if (!sliderRect.width) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, (clientX - sliderRect.left) / sliderRect.width));
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 0);
  const timeSeconds = min + (max - min) * ratio;
  const rowRect = slider.closest('.timeline-row')?.getBoundingClientRect() || sliderRect;
  const xInRow = sliderRect.left - rowRect.left + ratio * sliderRect.width;

  return {
    ratio,
    xInRow,
    timeSeconds: Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0)
  };
}

function getTimelinePointFromValue(value) {
  const slider = elements.startSlider;
  if (!slider) {
    return null;
  }

  const min = Number(slider.min || 0);
  const max = Number(slider.max || 0);
  const safeRange = Math.max(1e-9, max - min);
  const safeValue = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  const ratio = Math.max(0, Math.min(1, (safeValue - min) / safeRange));

  const sliderRect = slider.getBoundingClientRect();
  const rowRect = slider.closest('.timeline-row')?.getBoundingClientRect() || sliderRect;
  const xInRow = sliderRect.left - rowRect.left + ratio * sliderRect.width;

  return {
    ratio,
    xInRow,
    timeSeconds: Math.max(0, safeValue)
  };
}

function showHoverPreviewAt(point, immediate) {
  const hoverBox = elements.sliderHoverPreview;
  if (!hoverBox) {
    return;
  }

  hoverBox.hidden = false;
  hoverBox.style.left = `${point.xInRow}px`;
  if (elements.sliderHoverTime) {
    elements.sliderHoverTime.textContent = formatTime(point.timeSeconds);
  }

  scheduleHoverFramePreview(point.timeSeconds, immediate);
  scheduleHoverPreviewIdleHide();
}

function hideTimelineHoverPreview() {
  if (state.hoverPreviewIdleHideTimer) {
    clearTimeout(state.hoverPreviewIdleHideTimer);
    state.hoverPreviewIdleHideTimer = null;
  }
  if (elements.sliderHoverPreview) {
    elements.sliderHoverPreview.hidden = true;
  }
  abortHoverPreviewRequest();
}

function scheduleHoverPreviewIdleHide() {
  if (state.hoverPreviewIdleHideTimer) {
    clearTimeout(state.hoverPreviewIdleHideTimer);
  }

  state.hoverPreviewIdleHideTimer = setTimeout(() => {
    state.hoverPreviewIdleHideTimer = null;
    hideTimelineHoverPreview();
  }, 450);
}

function scheduleHoverFramePreview(timeSeconds, immediate = false) {
  if (!sourceFile || !elements.sliderHoverImage) {
    return;
  }

  if (state.hoverPreviewDebounceId) {
    clearTimeout(state.hoverPreviewDebounceId);
    state.hoverPreviewDebounceId = null;
  }

  const snappedTime = Math.round(Math.max(0, timeSeconds) * 5) / 5;
  if (snappedTime === state.hoverPreviewLastTimeSeconds && !immediate) {
    return;
  }

  if (immediate) {
    void loadHoverFramePreview(snappedTime);
    return;
  }

  state.hoverPreviewDebounceId = setTimeout(() => {
    state.hoverPreviewDebounceId = null;
    void loadHoverFramePreview(snappedTime);
  }, 120);
}

async function loadHoverFramePreview(timeSeconds) {
  state.hoverPreviewLastTimeSeconds = timeSeconds;
  abortHoverPreviewRequest();
  const requestId = ++state.hoverPreviewRequestSeq;

  const controller = new AbortController();
  state.hoverPreviewAbortController = controller;

  const params = new URLSearchParams({
    sourceFile,
    timeSeconds: String(Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0))
  });

  try {
    const response = await fetch(`/api/preview/frame?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob || !blob.size) {
      throw new Error('Pusta odpowiedz podgladu klatki.');
    }

    if (requestId !== state.hoverPreviewRequestSeq) {
      return;
    }

    clearHoverPreviewObjectUrl();
    const objectUrl = URL.createObjectURL(blob);
    state.activeHoverPreviewObjectUrl = objectUrl;
    elements.sliderHoverImage.src = objectUrl;
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    // Hover preview errors should stay silent to not disturb the main workflow.
  } finally {
    if (state.hoverPreviewAbortController === controller) {
      state.hoverPreviewAbortController = null;
    }
  }
}

async function loadFramePreview() {
  abortFramePreviewRequest();
  const requestId = ++state.framePreviewRequestSeq;

  const controller = new AbortController();
  state.framePreviewAbortController = controller;

  const startSeconds = Number(elements.startSlider.value || 0);
  const params = new URLSearchParams({
    sourceFile,
    timeSeconds: String(Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0))
  });

  try {
    const response = await fetch(`/api/preview/frame?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob || !blob.size) {
      throw new Error('Pusta odpowiedz podgladu klatki.');
    }

    if (requestId !== state.framePreviewRequestSeq) {
      return;
    }

    clearFramePreviewObjectUrl();
    const objectUrl = URL.createObjectURL(blob);
    state.activeFramePreviewObjectUrl = objectUrl;
    elements.framePreviewImage.src = objectUrl;
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    setError(`Nie udało się odświeżyć klatki podglądu: ${error.message || 'nieznany błąd'}`);
  } finally {
    if (state.framePreviewAbortController === controller) {
      state.framePreviewAbortController = null;
    }
  }
}

function abortFramePreviewRequest() {
  if (state.framePreviewAbortController) {
    state.framePreviewAbortController.abort();
    state.framePreviewAbortController = null;
  }
}

function abortHoverPreviewRequest() {
  if (state.hoverPreviewAbortController) {
    state.hoverPreviewAbortController.abort();
    state.hoverPreviewAbortController = null;
  }
}

function clearFramePreviewObjectUrl() {
  if (!state.activeFramePreviewObjectUrl) {
    return;
  }
  URL.revokeObjectURL(state.activeFramePreviewObjectUrl);
  state.activeFramePreviewObjectUrl = null;
}

function clearHoverPreviewObjectUrl() {
  if (!state.activeHoverPreviewObjectUrl) {
    return;
  }
  URL.revokeObjectURL(state.activeHoverPreviewObjectUrl);
  state.activeHoverPreviewObjectUrl = null;
}

async function startPreviewGeneration() {
  clearError();
  stopPolling();
  cancelSyncLoop();

  const durationSeconds = Number(elements.clipDuration.value || 60);
  const startSeconds = Number(elements.startSlider.value || 0);
  const prepMode = normalizePrepMode(elements.prepMode.value);

  elements.generateBtn.disabled = true;
  setProgress(mode === 'result' ? 'Przygotowywanie fragmentu porównawczego...' : 'Generowanie podglądu...', 1);

  try {
    let response;
    if (mode === 'result') {
      response = await fetch('/api/preview/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFile,
          encodedFile,
          startSeconds,
          durationSeconds
        })
      });
    } else {
      response = await fetch('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFile,
          settings,
          startSeconds,
          durationSeconds,
          prepMode
        })
      });
    }

    const payload = await readJsonResponse(response, 'Nie udało się uruchomić podglądu.');

    state.sessionId = payload.sessionId;
    startPolling();
  } catch (error) {
    setError(error.message || 'Start podglądu nie powiódł się.');
    elements.generateBtn.disabled = false;
    setProgress('Błąd', 0);
  }
}

function startPolling() {
  stopPolling();
  state.statusPoller = setInterval(async () => {
    if (!state.sessionId) {
      return;
    }

    try {
      const response = await fetch(`/api/preview/${encodeURIComponent(state.sessionId)}/status`);
      const payload = await readJsonResponse(response, 'Brak statusu podglądu.');

      const progress = Number(payload.progressPercent || 0);
      const stageProgress = Number(payload.stageProgressPercent || 0);
      const etaSeconds = payload.etaSeconds == null ? null : Number(payload.etaSeconds);
      const stageLabel = payload.stage === 'extract-original'
        ? 'Etap 1/2: Wycinanie oryginalnej próbki'
        : payload.stage === 'encode-preview'
          ? 'Etap 2/2: Kodowanie próbki x265'
          : payload.stage === 'extract-encoded'
            ? 'Etap 2/2: Wycinanie wyniku konwersji'
            : payload.stage === 'done'
              ? 'Gotowe'
              : payload.stage;

      setProgress(stageLabel, progress, stageProgress, etaSeconds);

      if (payload.status === 'failed') {
        stopPolling();
        elements.generateBtn.disabled = false;
        setError(payload.error || 'Generowanie podglądu zakończone błędem.');
        return;
      }

      if (payload.status === 'ready') {
        stopPolling();
        await loadPreviewVideos(payload.originalUrl, payload.encodedUrl);
        elements.generateBtn.disabled = false;
      }
    } catch (error) {
      stopPolling();
      elements.generateBtn.disabled = false;
      setError(error.message || 'Nie udało się odświeżyć statusu podglądu.');
    }
  }, 500);
}

function stopPolling() {
  if (!state.statusPoller) {
    return;
  }
  clearInterval(state.statusPoller);
  state.statusPoller = null;
}

async function loadPreviewVideos(originalUrl, encodedUrl) {
  elements.videoOriginal.src = withCacheBust(originalUrl);
  elements.videoEncoded.src = withCacheBust(encodedUrl);

  await Promise.all([
    waitForVideoReady(elements.videoOriginal),
    waitForVideoReady(elements.videoEncoded)
  ]);

  state.baseVideoWidth = Number(elements.videoOriginal.videoWidth || elements.videoEncoded.videoWidth || 0);
  state.baseVideoHeight = Number(elements.videoOriginal.videoHeight || elements.videoEncoded.videoHeight || 0);

  elements.videoOriginal.currentTime = 0;
  elements.videoEncoded.currentTime = 0;
  elements.videoOriginal.play().catch(() => {});
  elements.videoEncoded.play().catch(() => {});
  setProgress('Gotowe', 100, 100, 0);
  applySplit();
  startSyncLoop();
}

function withCacheBust(url) {
  const suffix = `t=${Date.now()}`;
  return String(url).includes('?') ? `${url}&${suffix}` : `${url}?${suffix}`;
}

function waitForVideoReady(video) {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Nie udało się załadować materiału podglądu.'));
    };

    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
    video.load();
  });
}

function setupVideoSync() {
  elements.videoEncoded.muted = true;

  elements.videoOriginal.addEventListener('play', () => {
    syncTargetTime(true);
    elements.videoEncoded.play().catch(() => {});
    startSyncLoop();
  });

  elements.videoOriginal.addEventListener('pause', () => {
    elements.videoEncoded.pause();
    cancelSyncLoop();
  });

  elements.videoOriginal.addEventListener('seeking', () => {
    syncTargetTime(false);
  });

  elements.videoOriginal.addEventListener('ratechange', () => {
    elements.videoEncoded.playbackRate = elements.videoOriginal.playbackRate;
  });

  elements.videoOriginal.addEventListener('timeupdate', () => {
    syncTargetTime(false);
  });
}

function startSyncLoop() {
  if (state.syncing) {
    return;
  }
  state.syncing = true;

  const tick = () => {
    if (!state.syncing) {
      return;
    }

    syncTargetTime(false);
    state.syncRaf = requestAnimationFrame(tick);
  };

  state.syncRaf = requestAnimationFrame(tick);
}

function cancelSyncLoop() {
  state.syncing = false;
  if (state.syncRaf) {
    cancelAnimationFrame(state.syncRaf);
    state.syncRaf = null;
  }
}

function syncTargetTime(forceSet) {
  const source = elements.videoOriginal;
  const target = elements.videoEncoded;

  if (!source || !target || Number.isNaN(source.currentTime) || Number.isNaN(target.currentTime)) {
    return;
  }

  const sourceRate = Number(source.playbackRate || 1);
  const driftSigned = source.currentTime - target.currentTime;
  const drift = Math.abs(driftSigned);

  // Hard seek only for large drift or explicit force-sync events.
  if (forceSet || drift > 0.18) {
    try {
      target.currentTime = source.currentTime;
      target.playbackRate = sourceRate;
    } catch (_error) {
      // no-op
    }
    return;
  }

  // Soft correction for small drift to avoid jitter from frequent seeks.
  if (drift > 0.012) {
    const correction = Math.min(0.08, drift * 2.2);
    const nextRate = driftSigned > 0
      ? sourceRate + correction
      : Math.max(0.1, sourceRate - correction);
    target.playbackRate = nextRate;
    return;
  }

  if (Math.abs((target.playbackRate || 1) - sourceRate) > 0.005) {
    target.playbackRate = sourceRate;
  }
}

function applySplit() {
  const split = Math.max(0, Math.min(1, Number(state.dividerPosition || 0.5)));
  const splitPercent = split * 100;

  if (!elements.videoEncoded || !elements.divider) {
    return;
  }

  elements.videoEncoded.style.clipPath = `inset(0 0 0 ${splitPercent}%)`;
  elements.divider.style.left = `${splitPercent}%`;
  const dividerActive = state.dividerHoverActive || state.draggingDivider;
  elements.divider.classList.toggle('is-active', dividerActive);
  elements.stage.classList.toggle('is-divider-active', dividerActive);
  elements.stage.classList.toggle('is-dragging-divider', state.draggingDivider);
}

function updateDividerSizeHints() {
  if (elements.sourceHintText) {
    const sourceLabel = state.sourceSizeBytes > 0
      ? `Plik zrodlowy\n${formatBytes(state.sourceSizeBytes)}`
      : 'Plik zrodlowy';
    elements.sourceHintText.textContent = sourceLabel;
  }

  if (elements.encodedHintText) {
    if (state.encodedSizeBytes > 0 && state.sourceSizeBytes > 0) {
      const deltaPercent = ((state.encodedSizeBytes - state.sourceSizeBytes) / state.sourceSizeBytes) * 100;
      const sign = deltaPercent >= 0 ? '+' : '';
      elements.encodedHintText.textContent =
        `Plik docelowy\n${formatBytes(state.encodedSizeBytes)} (${sign}${deltaPercent.toFixed(1)}% vs zrodlowy)`;
    } else {
      elements.encodedHintText.textContent = 'Plik docelowy';
    }
  }
}

function setupWheelZoom() {
  const wrap = elements.stageWrap;
  if (!wrap) {
    return;
  }

  wrap.addEventListener('wheel', (event) => {
    if (!elements.stage || !wrap.contains(event.target)) {
      return;
    }

    event.preventDefault();
    const current = Number.isFinite(state.wheelZoomScale) && state.wheelZoomScale > 0
      ? state.wheelZoomScale
      : Number(elements.zoomScale.value || 1);
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    const next = Math.max(0.2, Math.min(3, current * factor));
    state.wheelZoomScale = Number(next.toFixed(2));
    syncZoomSelectWithWheelScale(state.wheelZoomScale);
    applyScale();
    requestSplitRender();
  }, { passive: false });
}

function setupStagePanning() {
  const wrap = elements.stageWrap;
  if (!wrap) {
    return;
  }

  const stopPanning = () => {
    if (!state.panningActive) {
      return;
    }
    state.panningActive = false;
    wrap.classList.remove('is-panning');
  };

  wrap.addEventListener('pointerdown', (event) => {
    const panGesture = event.button === 1 || (event.button === 0 && event.altKey);
    if (!panGesture || !state.panningEnabled) {
      return;
    }

    const target = event.target;
    if (target instanceof Element) {
      if (target.closest('#divider') || target.closest('#stageFullscreenBtn')) {
        return;
      }
    }

    state.panningActive = true;
    state.panStartX = event.clientX;
    state.panStartY = event.clientY;
    state.panStartScrollLeft = wrap.scrollLeft;
    state.panStartScrollTop = wrap.scrollTop;
    wrap.classList.add('is-panning');
    event.preventDefault();

    if (typeof wrap.setPointerCapture === 'function') {
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch (_error) {
        // no-op
      }
    }
  });

  wrap.addEventListener('pointermove', (event) => {
    if (!state.panningActive) {
      return;
    }

    const dx = event.clientX - state.panStartX;
    const dy = event.clientY - state.panStartY;
    wrap.scrollLeft = state.panStartScrollLeft - dx;
    wrap.scrollTop = state.panStartScrollTop - dy;
    event.preventDefault();
  });

  wrap.addEventListener('pointerup', stopPanning);
  wrap.addEventListener('pointercancel', stopPanning);
  wrap.addEventListener('mouseleave', stopPanning);
  window.addEventListener('blur', stopPanning);
}

function updatePanningAvailability() {
  const wrap = elements.stageWrap;
  if (!wrap) {
    return;
  }

  const zoom = Number.isFinite(state.wheelZoomScale) ? state.wheelZoomScale : 1;
  const canPan = zoom > 1.01 && (wrap.scrollWidth > wrap.clientWidth || wrap.scrollHeight > wrap.clientHeight);
  state.panningEnabled = canPan;
  wrap.classList.toggle('is-pan-enabled', canPan);
  if (!canPan) {
    state.panningActive = false;
    wrap.classList.remove('is-panning');
  }
}

function syncZoomSelectWithWheelScale(scale) {
  const select = elements.zoomScale;
  if (!select) {
    return;
  }

  const rounded = Number(scale.toFixed(2));
  const exactOption = Array.from(select.options).find((option) => Math.abs(Number(option.value) - rounded) < 0.001);
  const dynamicAttr = 'data-wheel-zoom';

  if (exactOption) {
    const existingDynamic = select.querySelector(`option[${dynamicAttr}="1"]`);
    if (existingDynamic) {
      existingDynamic.remove();
    }
    select.value = exactOption.value;
    return;
  }

  let dynamicOption = select.querySelector(`option[${dynamicAttr}="1"]`);
  if (!dynamicOption) {
    dynamicOption = document.createElement('option');
    dynamicOption.setAttribute(dynamicAttr, '1');
    select.appendChild(dynamicOption);
  }
  dynamicOption.value = rounded.toFixed(2);
  dynamicOption.textContent = `${rounded.toFixed(2)}x (kolko myszki)`;
  select.value = dynamicOption.value;
}

function requestSplitRender() {
  state.dividerVisualDirty = true;
  if (state.splitRenderRaf) {
    return;
  }

  state.splitRenderRaf = requestAnimationFrame(() => {
    state.splitRenderRaf = null;
    if (!state.dividerVisualDirty) {
      return;
    }
    state.dividerVisualDirty = false;
    applySplit();
  });
}

function setupStageFullscreen() {
  const btn = elements.stageFullscreenBtn;
  const wrap = elements.stageWrap;
  if (!btn || !wrap) {
    return;
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await wrap.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  };

  const updateButtonState = () => {
    const isFullscreen = document.fullscreenElement === wrap;
    btn.textContent = isFullscreen ? '⛶' : '⛶';
    btn.setAttribute('aria-pressed', String(isFullscreen));
    // Viewport size changes in/out of fullscreen affect pan availability.
    requestAnimationFrame(() => {
      updatePanningAvailability();
      requestSplitRender();
    });
  };

  btn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateButtonState);
  document.addEventListener('webkitfullscreenchange', updateButtonState);
  document.addEventListener('mozfullscreenchange', updateButtonState);
  document.addEventListener('msfullscreenchange', updateButtonState);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement) {
      const tagName = String(target.tagName || '').toLowerCase();
      const isEditable = target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
      if (isEditable) {
        return;
      }
    }

    const source = elements.videoOriginal;
    const key = String(event.key || '').toLowerCase();
    const step = event.shiftKey ? 10 : 5;

    if (!source) {
      return;
    }

    if (key === ' ' || key === 'k') {
      event.preventDefault();
      if (source.paused) {
        source.play().catch(() => {});
      } else {
        source.pause();
      }
      return;
    }

    if (key === 'arrowleft') {
      event.preventDefault();
      source.currentTime = Math.max(0, Number(source.currentTime || 0) - step);
      return;
    }

    if (key === 'arrowright') {
      event.preventDefault();
      const duration = Number.isFinite(source.duration) ? Number(source.duration) : Number.MAX_SAFE_INTEGER;
      source.currentTime = Math.min(duration, Number(source.currentTime || 0) + step);
      return;
    }

    if (key === 'j') {
      event.preventDefault();
      source.currentTime = Math.max(0, Number(source.currentTime || 0) - 10);
      return;
    }

    if (key === 'l') {
      event.preventDefault();
      const duration = Number.isFinite(source.duration) ? Number(source.duration) : Number.MAX_SAFE_INTEGER;
      source.currentTime = Math.min(duration, Number(source.currentTime || 0) + 10);
      return;
    }

    if (key === 'm') {
      event.preventDefault();
      source.muted = !source.muted;
      return;
    }

    if (key === 'f') {
      event.preventDefault();
      elements.stageFullscreenBtn?.click();
    }
  });
}

function setupDividerDragger() {
  const stage = elements.stage;
  const divider = elements.divider;
  if (!stage || !divider) {
    return;
  }

  const updateFromClientX = (clientX, immediate = false) => {
    const rect = stage.getBoundingClientRect();
    if (!rect.width) {
      return;
    }

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (Math.abs(ratio - state.dividerPosition) < 0.0009 && !immediate) {
      return;
    }
    state.dividerPosition = ratio;
    if (immediate) {
      state.dividerHoverActive = true;
      applySplit();
      return;
    }
    requestSplitRender();
  };

  const updateHoverState = (clientX) => {
    const rect = stage.getBoundingClientRect();
    if (!rect.width) {
      return;
    }

    const dividerX = rect.left + rect.width * state.dividerPosition;
    const nearDivider = Math.abs(clientX - dividerX) <= 18;
    if (nearDivider === state.dividerHoverActive && !state.draggingDivider) {
      return;
    }
    state.dividerHoverActive = nearDivider;
    stage.style.cursor = nearDivider || state.draggingDivider ? 'col-resize' : 'default';
    requestSplitRender();
  };

  const handlePointerMove = (event) => {
    if (!Number.isFinite(event.clientX)) {
      return;
    }

    if (state.draggingDivider) {
      updateFromClientX(event.clientX, true);
      return;
    }

    updateHoverState(event.clientX);
  };

  const stopDragging = () => {
    state.draggingDivider = false;
    state.dividerHoverActive = false;
    stage.classList.remove('is-dragging-divider');
    stage.style.cursor = 'default';
    applySplit();
  };

  const startDragging = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    state.draggingDivider = true;
    state.dividerHoverActive = true;
    stage.classList.add('is-dragging-divider');
    stage.style.cursor = 'col-resize';
    if (typeof divider.setPointerCapture === 'function') {
      try {
        divider.setPointerCapture(event.pointerId);
      } catch (_error) {
        // no-op
      }
    }
    updateFromClientX(event.clientX, true);
  };

  divider.addEventListener('pointerdown', startDragging);
  divider.addEventListener('pointermove', handlePointerMove);
  divider.addEventListener('pointerenter', handlePointerMove);
  divider.addEventListener('pointerleave', () => {
    if (!state.draggingDivider) {
      state.dividerHoverActive = false;
      stage.style.cursor = 'default';
      applySplit();
    }
  });

  stage.addEventListener('pointermove', handlePointerMove);
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    const rect = stage.getBoundingClientRect();
    if (!rect.width) {
      return;
    }

    const dividerX = rect.left + rect.width * state.dividerPosition;
    if (Math.abs(event.clientX - dividerX) <= 22) {
      startDragging(event);
    }
  });

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
  window.addEventListener('blur', stopDragging);
}

function applyScale() {
  const scale = Number.isFinite(state.wheelZoomScale) && state.wheelZoomScale > 0
    ? state.wheelZoomScale
    : Number(elements.zoomScale.value || 1);
  if (!Number.isFinite(scale) || scale <= 0) {
    return;
  }

  const baseWidth = Number(state.baseVideoWidth || elements.videoOriginal.videoWidth || elements.videoEncoded.videoWidth || 0);
  const baseHeight = Number(state.baseVideoHeight || elements.videoOriginal.videoHeight || elements.videoEncoded.videoHeight || 0);

  if (!baseWidth || !baseHeight) {
    // Metadata may still be loading; do not force dimensions yet.
    return;
  }

  const width = Math.max(2, Math.round(baseWidth * scale));
  const height = Math.max(2, Math.round(baseHeight * scale));

  elements.stage.style.width = `${width}px`;
  elements.stage.style.height = `${height}px`;
  elements.videoOriginal.style.width = `${width}px`;
  elements.videoOriginal.style.height = `${height}px`;
  elements.videoEncoded.style.width = `${width}px`;
  elements.videoEncoded.style.height = `${height}px`;
  updatePanningAvailability();
}

function setProgress(label, percent, stagePercent = null, etaSeconds = null) {
  const safe = Math.max(0, Math.min(100, Number(percent || 0)));
  elements.progressLabel.textContent = label;
  elements.progressValue.textContent = `${safe.toFixed(1)}%`;
  elements.progressBar.style.width = `${safe}%`;

  const stagePart = Number.isFinite(Number(stagePercent))
    ? `Postep etapu: ${Number(stagePercent).toFixed(1)}%`
    : 'Postep etapu: -';
  const etaPart = Number.isFinite(Number(etaSeconds)) && Number(etaSeconds) >= 0
    ? `ETA: ${formatTime(Number(etaSeconds))}`
    : 'ETA: ...';
  elements.stageDetail.textContent = `${stagePart} | ${etaPart}`;
}

function setError(message) {
  elements.errorText.textContent = message;
}

function clearError() {
  setError('');
}

function basename(filePath) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function formatTime(secondsRaw) {
  const seconds = Math.max(0, Math.floor(Number(secondsRaw || 0)));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytesRaw) {
  const bytes = Math.max(0, Number(bytesRaw || 0));
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function normalizePrepMode(value) {
  return value === 'accurate' ? 'accurate' : 'quick';
}

function showLiveReloadBanner() {
  let banner = document.querySelector('#liveReloadBanner');
  if (banner) return;
  banner = document.createElement('div');
  banner.id = 'liveReloadBanner';
  banner.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:10px;padding:10px 20px;display:flex;gap:12px;align-items:center;z-index:999;font-size:13px;box-shadow:0 4px 24px #0008';
  banner.innerHTML = '<span>⏳ Konwersja trwa — widoczna część pliku</span><button id="liveReloadBtn" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:13px">Odśwież</button>';
  document.body.appendChild(banner);
  document.querySelector('#liveReloadBtn').addEventListener('click', () => {
    banner.remove();
    const originalUrl = `/api/preview/direct/video?filePath=${encodeURIComponent(sourceFile)}`;
    const encodedUrl = `/api/preview/direct/video?filePath=${encodeURIComponent(encodedFile)}`;
    setProgress('Odświeżanie...', 10, 0, null);
    loadPreviewVideos(originalUrl, encodedUrl).then(() => {
      setProgress('Załadowano nową wersję częściową.', 100, 100, null);
      showLiveReloadBanner();
    }).catch(() => {});
  });
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('pl-PL');
}

async function readJsonResponse(response, fallbackMessage) {
  const rawBody = await response.text();
  let payload = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch (_error) {
      payload = null;
    }
  }

  if (!response.ok) {
    const compact = String(rawBody || '').replace(/\s+/g, ' ').trim();
    const isMissingPreviewStartRoute =
      response.status === 404 &&
      /Cannot POST \/api\/preview\/start/i.test(compact);

    if (isMissingPreviewStartRoute) {
      throw new Error(
        `${fallbackMessage} Endpoint podgladu nie istnieje na aktualnym serwerze. ` +
        `Uruchom x265 Converter z folderu x265-converter i otworz http://127.0.0.1:3001.`
      );
    }

    const detail = payload?.error || summarizeResponseSnippet(rawBody);
    throw new Error(`${fallbackMessage} (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }

  if (payload !== null) {
    return payload;
  }

  throw new Error(`${fallbackMessage} Odpowiedz nie jest JSON: ${summarizeResponseSnippet(rawBody)}`);
}

function summarizeResponseSnippet(rawBody) {
  const compact = String(rawBody || '').replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'pusta odpowiedz';
  }

  const shortened = compact.slice(0, 160);
  return shortened + (compact.length > 160 ? '...' : '');
}
