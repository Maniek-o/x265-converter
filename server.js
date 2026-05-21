const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('ffprobe-static');
const open = require('open').default;

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const AUTO_OPEN_BROWSER = process.env.AUTO_OPEN_BROWSER !== '0';
const FILE_OPEN_ENABLED = process.env.FILE_OPEN_ENABLED !== '0';
const app = express();
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_INSTANCE_ID = `${process.pid}-${Date.now().toString(36)}`;

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v', '.mpg', '.mpeg'
]);

const appRoot = __dirname;
const tmpRoot = path.resolve(process.env.APP_TMP_DIR || path.join(appRoot, 'tmp'));
const ffmpegPath = resolveBinary('ffmpeg', ffmpegInstaller.path);
const ffprobePath = resolveBinary('ffprobe', ffprobeInstaller.path);

const queueState = {
  jobs: [],
  activeJobIds: new Set(),
  nextId: 1,
  maxConcurrentJobs: Math.max(1, Math.min(5, Number(process.env.MAX_CONCURRENT_JOBS || 1)))
};

const PRESET_MAP = {
  cpu: { quality: 'slow', balanced: 'medium', speed: 'fast' },
  gpu: { quality: 'p5', balanced: 'p4', speed: 'p2' }
};

const previewState = {
  activeSession: null,
  nextId: 1
};

const cpuMetricsState = {
  ts: Date.now(),
  cpuTimes: readCpuTimesSnapshot(),
  processCpuUsage: process.cpuUsage(),
  cpuUsagePercent: 0,
  processCpuPercent: 0,
  processRssMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10
};

const cpuMetricsTimer = setInterval(() => {
  refreshCpuMetrics();
}, 2000);
if (typeof cpuMetricsTimer.unref === 'function') {
  cpuMetricsTimer.unref();
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(appRoot, 'public')));

function sendError(res, status, code, message) {
  return res.status(status).json({ code, error: message });
}

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    instanceId: SERVER_INSTANCE_ID,
    ffmpegPath,
    ffprobePath,
    activeJobId: [...queueState.activeJobIds][0] ?? null,
    activeJobCount: queueState.activeJobIds.size,
    queueLength: queueState.jobs.filter((job) => job.status === 'queued').length,
    maxConcurrentJobs: queueState.maxConcurrentJobs,
    cpuUsagePercent: Number(cpuMetricsState.cpuUsagePercent.toFixed(1)),
    processCpuPercent: Number(cpuMetricsState.processCpuPercent.toFixed(1)),
    processRssMB: Number(cpuMetricsState.processRssMB.toFixed(1))
  });
});

app.post('/api/scan', async (req, res) => {
  try {
    const sourcePath = String(req.body?.sourcePath || '').trim();
    if (!sourcePath) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak sourcePath.');
    }

    const normalizedSourcePath = path.resolve(sourcePath);
    const stat = await fsp.stat(normalizedSourcePath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return sendError(res, 400, 'INVALID_INPUT', 'Podana ścieżka nie jest katalogiem.');
    }

    const files = await scanForVideos(normalizedSourcePath);
    const enriched = await Promise.all(files.map(async (filePath) => {
      const fileStat = await fsp.stat(filePath);
      const probe = await ffprobe(filePath).catch(() => null);
      const durationSeconds = Number(probe?.format?.duration || 0);
      return {
        path: filePath,
        name: path.basename(filePath),
        sizeBytes: fileStat.size,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0
      };
    }));

    res.json({
      sourcePath: normalizedSourcePath,
      files: enriched
    });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Skanowanie nie powiodło się.');
  }
});

app.post('/api/suggest-quality', async (req, res) => {
  try {
    const filePath = String(req.body?.filePath || '').trim();
    if (!filePath) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak filePath.');
    }
    const normalizedPath = path.resolve(filePath);
    await assertVideoFileExists(normalizedPath);
    const probe = await ffprobe(normalizedPath);
    const suggestion = suggestQualityFromProbe(probe);
    res.json(suggestion);
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Analiza nie powiodła się.');
  }
});

app.post('/api/open-path', async (req, res) => {
  try {
    if (!FILE_OPEN_ENABLED) {
      return sendError(res, 400, 'UNAVAILABLE', 'Otwieranie plikow jest wylaczone w tym trybie uruchomienia.');
    }

    const filePath = path.resolve(String(req.body?.filePath || '').trim());
    if (!filePath) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak filePath.');
    }

    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return sendError(res, 400, 'INVALID_INPUT', 'Plik nie istnieje.');
    }

    await open(filePath, { wait: false });
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się otworzyć pliku.');
  }
});

app.get('/api/jobs/:jobId/stream', async (req, res) => {
  try {
    const jobId = Number(req.params.jobId);
    const job = queueState.jobs.find((item) => item.id === jobId);
    if (!job) {
      return sendError(res, 404, 'JOB_NOT_FOUND', 'Zadanie nie znalezione.');
    }

    const outputPath = String(job.outputPath || '').trim();
    if (!outputPath) {
      return sendError(res, 400, 'INVALID_STATE', 'Plik wyjściowy nie jest ustawiony dla tego zadania.');
    }

    const stat = await fsp.stat(outputPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return sendError(res, 404, 'FILE_NOT_FOUND', 'Plik wyjściowy nie istnieje.');
    }

    const ext = path.extname(outputPath).toLowerCase();
    const contentTypeMap = {
      '.mkv': 'video/x-matroska',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.flv': 'video/x-flv',
      '.m4v': 'video/x-m4v',
      '.mpg': 'video/mpeg',
      '.mpeg': 'video/mpeg',
      '.ts': 'video/mp2t',
      '.wmv': 'video/x-ms-wmv'
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.sendFile(outputPath);
  } catch (error) {
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się streamować pliku.');
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const sourceFiles = Array.isArray(req.body?.sourceFiles) ? req.body.sourceFiles : [];
    const settings = normalizeSettings(req.body?.settings || {});

    if (!sourceFiles.length) {
      return sendError(res, 400, 'INVALID_INPUT', 'Wybierz przynajmniej jeden plik video.');
    }

    const createdJobs = [];
    for (const sourceFile of sourceFiles) {
      const normalizedSourceFile = path.resolve(String(sourceFile));
      await assertVideoFileExists(normalizedSourceFile);
      const job = createQueuedJob(normalizedSourceFile, settings);
      queueState.jobs.push(job);
      createdJobs.push(toClientJob(job));

      void prepareJobForQueue(job).catch((error) => {
        if (job.status === 'cancelled') {
          return;
        }
        job.status = 'failed';
        job.error = error.message || 'Nie udało się przygotować zadania.';
        job.finishedAt = new Date().toISOString();
      });
    }

    res.status(201).json({ jobs: createdJobs });
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się dodać zadań do kolejki.');
  }
});

app.get('/api/jobs', (_req, res) => {
  res.json({
    jobs: queueState.jobs.map(toClientJob),
    summary: getQueueSummary(queueState.jobs),
    config: {
      maxConcurrentJobs: queueState.maxConcurrentJobs
    }
  });
});

app.get('/api/queue/config', (_req, res) => {
  res.json({
    maxConcurrentJobs: queueState.maxConcurrentJobs
  });
});

app.post('/api/queue/config', async (req, res) => {
  const requested = Number(req.body?.maxConcurrentJobs);
  if (!Number.isFinite(requested)) {
    return sendError(res, 400, 'INVALID_INPUT', 'Brak maxConcurrentJobs.');
  }

  queueState.maxConcurrentJobs = Math.max(1, Math.min(5, Math.floor(requested)));
  enforceConcurrencyLimit();
  runNextJob().catch((error) => {
    console.error('Queue runner failed:', error);
  });

  return res.json({
    maxConcurrentJobs: queueState.maxConcurrentJobs,
    jobs: queueState.jobs.map(toClientJob),
    summary: getQueueSummary(queueState.jobs)
  });
});

app.post('/api/jobs/:jobId/cancel', async (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = queueState.jobs.find((item) => item.id === jobId);
  if (!job) {
    return sendError(res, 404, 'JOB_NOT_FOUND', 'Nie znaleziono zadania.');
  }

  if (job.status === 'queued' || job.status === 'preparing') {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    runNextJob().catch((error) => {
      console.error('Queue runner failed:', error);
    });
    return res.json({ job: toClientJob(job) });
  }

  if (job.status === 'paused' && job.process) {
    job.cancelRequested = true;
    try {
      job.process.kill('SIGCONT');
    } catch (_error) {
      // ignore
    }
    job.process.kill('SIGTERM');
    return res.json({ job: toClientJob(job) });
  }

  if (job.status === 'processing' && job.process) {
    job.cancelRequested = true;
    job.process.kill('SIGTERM');
    return res.json({ job: toClientJob(job) });
  }

  return sendError(res, 400, 'INVALID_STATE', 'Tego zadania nie można już anulować.');
});

app.post('/api/jobs/:jobId/resume', async (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = queueState.jobs.find((item) => item.id === jobId);
  if (!job) {
    return sendError(res, 404, 'JOB_NOT_FOUND', 'Nie znaleziono zadania.');
  }

  if (job.status === 'paused' && job.process) {
    const resumed = resumePausedJob(job);
    if (!resumed) {
      return sendError(res, 400, 'INVALID_STATE', 'Nie udało się wznowić procesu ffmpeg.');
    }
    runNextJob().catch((error) => {
      console.error('Queue runner failed:', error);
    });
    return res.json({ job: toClientJob(job) });
  }

  if (job.status === 'cancelled' || job.status === 'failed') {
    await resetJobForResume(job);
    runNextJob().catch((error) => {
      console.error('Queue runner failed:', error);
    });
    return res.json({ job: toClientJob(job) });
  }

  return sendError(res, 400, 'INVALID_STATE', 'To zadanie nie może zostać wznowione.');
});

app.post('/api/queue/resume-all', async (_req, res) => {
  let resumedCount = 0;

  for (const job of queueState.jobs) {
    if (job.status === 'cancelled' || job.status === 'failed') {
      await resetJobForResume(job);
      resumedCount += 1;
    }
  }

  if (resumedCount > 0) {
    runNextJob().catch((error) => {
      console.error('Queue runner failed:', error);
    });
  }

  res.json({
    resumedCount,
    summary: getQueueSummary(queueState.jobs),
    jobs: queueState.jobs.map(toClientJob)
  });
});

app.post('/api/queue/stop-all', async (_req, res) => {
  let stoppedCount = 0;

  for (const job of queueState.jobs) {
    const wasStopped = stopJob(job);
    if (wasStopped) {
      stoppedCount += 1;
    }
  }

  res.json({
    stoppedCount,
    summary: getQueueSummary(queueState.jobs),
    jobs: queueState.jobs.map(toClientJob)
  });
});

app.delete('/api/queue', async (_req, res) => {
  const snapshot = [...queueState.jobs];
  const cleanupTasks = [];

  for (const job of snapshot) {
    const shouldRemoveOutput = job.status !== 'completed';
    if (shouldRemoveOutput) {
      job.deleteOutputOnFinish = true;
    }

    stopJob(job);

    if (shouldRemoveOutput && !isProcessingJob(job)) {
      cleanupTasks.push(removeOutputFile(job.outputPath));
    }
  }

  await Promise.allSettled(cleanupTasks);

  queueState.jobs = [];
  queueState.activeJobIds.clear();

  res.json({
    cleared: true,
    summary: getQueueSummary(queueState.jobs),
    jobs: []
  });
});

app.post('/api/preview/meta', async (req, res) => {
  try {
    const sourceFile = path.resolve(String(req.body?.sourceFile || ''));
    if (!sourceFile) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak sourceFile.');
    }

    await assertVideoFileExists(sourceFile);
    const probe = await ffprobe(sourceFile);
    const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');

    return res.json({
      sourceFile,
      durationSeconds: Number(probe.format?.duration || 0),
      width: Number(videoStream?.width || 0),
      height: Number(videoStream?.height || 0)
    });
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się odczytać metadanych podglądu.');
  }
});

app.get('/api/preview/frame', async (req, res) => {
  try {
    const sourceFile = path.resolve(String(req.query.sourceFile || '').trim());
    const requestedTime = Number(req.query.timeSeconds || 0);

    if (!sourceFile) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak sourceFile.');
    }

    await assertVideoFileExists(sourceFile);
    const safeTimeSeconds = Number.isFinite(requestedTime) ? Math.max(0, requestedTime) : 0;

    const frameBuffer = await extractPreviewFrameBuffer(sourceFile, safeTimeSeconds);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return res.status(200).send(frameBuffer);
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się wygenerować podglądu klatki.');
  }
});

app.post('/api/preview/compare', async (req, res) => {
  try {
    const sourceFile = path.resolve(String(req.body?.sourceFile || ''));
    const encodedFile = path.resolve(String(req.body?.encodedFile || ''));
    const requestedStart = Number(req.body?.startSeconds || 0);
    const requestedDuration = Number(req.body?.durationSeconds || 60);

    if (!sourceFile || !encodedFile) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak sourceFile lub encodedFile.');
    }

    await assertVideoFileExists(sourceFile);
    await assertVideoFileExists(encodedFile);

    const probe = await ffprobe(sourceFile);
    const sourceDurationSeconds = Math.max(0, Number(probe.format?.duration || 0));
    const durationSeconds = clampNumber(requestedDuration, 10, 90, 60);
    const maxStart = Math.max(0, sourceDurationSeconds - durationSeconds);
    const startSeconds = Math.min(maxStart, Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0));

    await replaceActivePreviewSession();

    const sessionId = String(previewState.nextId++);
    const sessionTmpDir = path.join(tmpRoot, `preview_${sessionId}`);
    const originalPath = path.join(sessionTmpDir, 'original_preview.mp4');
    const encodedPath = path.join(sessionTmpDir, 'encoded_preview.mp4');

    const session = {
      id: sessionId,
      sourceFile,
      encodedFile,
      startSeconds,
      durationSeconds,
      sourceDurationSeconds,
      createdAt: new Date().toISOString(),
      status: 'generating',
      stage: 'extract-original',
      stageProgressPercent: 0,
      progressPercent: 0,
      etaSeconds: null,
      error: null,
      process: null,
      tmpDir: sessionTmpDir,
      originalPath,
      encodedPath
    };

    previewState.activeSession = session;
    void generateCompareSession(session);

    return res.status(202).json({
      sessionId,
      status: session.status,
      progressPercent: session.progressPercent,
      stage: session.stage,
      durationSeconds,
      startSeconds
    });
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się uruchomić porównania.');
  }
});

app.post('/api/preview/direct/meta', async (req, res) => {
  try {
    const sourceFile = path.resolve(String(req.body?.sourceFile || ''));
    const encodedFile = path.resolve(String(req.body?.encodedFile || ''));
    if (!sourceFile || !encodedFile) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak sourceFile lub encodedFile.');
    }

    await assertVideoFileExists(sourceFile);
    await assertVideoFileExists(encodedFile);
    const sourceProbe = await ffprobe(sourceFile);
    const encodedProbe = await ffprobe(encodedFile);
    const sourceVideo = (sourceProbe.streams || []).find((stream) => stream.codec_type === 'video');
    const encodedVideo = (encodedProbe.streams || []).find((stream) => stream.codec_type === 'video');

    return res.json({
      sourceFile,
      encodedFile,
      sourceDurationSeconds: Number(sourceProbe.format?.duration || 0),
      encodedDurationSeconds: Number(encodedProbe.format?.duration || 0),
      sourceSizeBytes: Number(sourceProbe.format?.size || 0),
      encodedSizeBytes: Number(encodedProbe.format?.size || 0),
      sourceWidth: Number(sourceVideo?.width || 0),
      sourceHeight: Number(sourceVideo?.height || 0),
      encodedWidth: Number(encodedVideo?.width || 0),
      encodedHeight: Number(encodedVideo?.height || 0)
    });
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się odczytać metadanych porównania.');
  }
});

app.get('/api/preview/direct/video', async (req, res) => {
  try {
    const filePath = path.resolve(String(req.query.filePath || '').trim());
    if (!filePath) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak filePath.');
    }

    await assertVideoFileExists(filePath);

    const stat = await fsp.stat(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.ts': 'video/mp2t', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.webm': 'video/webm' };
    const contentType = mimeMap[ext] || 'video/mp4';

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 10 * 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      return fileStream.pipe(res);
    }

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się wysłać pliku podglądu.');
  }
});

app.post('/api/preview/start', async (req, res) => {
  try {
    const sourceFile = path.resolve(String(req.body?.sourceFile || ''));
    const settings = normalizeSettings(req.body?.settings || {});
    const requestedStart = Number(req.body?.startSeconds || 0);
    const requestedDuration = Number(req.body?.durationSeconds || 60);
    const prepMode = normalizePreviewPrepMode(req.body?.prepMode);

    if (!sourceFile) {
      return sendError(res, 400, 'INVALID_INPUT', 'Brak sourceFile.');
    }

    await assertVideoFileExists(sourceFile);

    const probe = await ffprobe(sourceFile);
    const sourceDurationSeconds = Math.max(0, Number(probe.format?.duration || 0));
    const durationSeconds = clampNumber(requestedDuration, 30, 60, 60);
    const maxStart = Math.max(0, sourceDurationSeconds - durationSeconds);
    const startSeconds = Math.min(maxStart, Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0));

    await replaceActivePreviewSession();

    const sessionId = String(previewState.nextId++);
    const sessionTmpDir = path.join(tmpRoot, `preview_${sessionId}`);
    const originalPath = path.join(sessionTmpDir, 'original_preview.mp4');
    const encodedPath = path.join(sessionTmpDir, 'encoded_preview.mp4');

    const session = {
      id: sessionId,
      sourceFile,
      settings,
      prepMode,
      startSeconds,
      durationSeconds,
      sourceDurationSeconds,
      createdAt: new Date().toISOString(),
      status: 'generating',
      stage: 'extract-original',
      stageProgressPercent: 0,
      progressPercent: 0,
      etaSeconds: null,
      error: null,
      process: null,
      tmpDir: sessionTmpDir,
      originalPath,
      encodedPath
    };

    previewState.activeSession = session;
    void generatePreviewSession(session);

    return res.status(202).json({
      sessionId,
      status: session.status,
      progressPercent: session.progressPercent,
      stage: session.stage,
      prepMode,
      durationSeconds,
      startSeconds
    });
  } catch (error) {
    if (isVideoInputError(error)) {
      return sendError(res, 400, 'INVALID_INPUT', error.message);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Nie udało się uruchomić podglądu.');
  }
});

app.get('/api/preview/:sessionId/status', (req, res) => {
  const session = previewState.activeSession;
  if (!session || session.id !== String(req.params.sessionId)) {
    return sendError(res, 404, 'PREVIEW_SESSION_NOT_FOUND', 'Sesja podglądu nie istnieje.');
  }

  return res.json({
    sessionId: session.id,
    status: session.status,
    stage: session.stage,
    stageProgressPercent: session.stageProgressPercent,
    progressPercent: session.progressPercent,
    etaSeconds: session.etaSeconds,
    error: session.error,
    startSeconds: session.startSeconds,
    durationSeconds: session.durationSeconds,
    sourceDurationSeconds: session.sourceDurationSeconds,
    originalUrl: session.status === 'ready' ? `/api/preview/${session.id}/video/original` : null,
    encodedUrl: session.status === 'ready' ? `/api/preview/${session.id}/video/encoded` : null
  });
});

app.get('/api/preview/:sessionId/video/:kind', (req, res) => {
  const session = previewState.activeSession;
  const sessionId = String(req.params.sessionId);
  const kind = String(req.params.kind || '').toLowerCase();

  if (!session || session.id !== sessionId || session.status !== 'ready') {
    return sendError(res, 404, 'PREVIEW_NOT_AVAILABLE', 'Podgląd nie jest dostępny.');
  }

  const filePath = kind === 'original' ? session.originalPath : kind === 'encoded' ? session.encodedPath : null;
  if (!filePath || !fs.existsSync(filePath)) {
    return sendError(res, 404, 'PREVIEW_FILE_MISSING', 'Plik podglądu nie istnieje.');
  }

  return res.sendFile(filePath);
});

app.delete('/api/preview/:sessionId', async (req, res) => {
  const session = previewState.activeSession;
  const sessionId = String(req.params.sessionId);

  if (!session || session.id !== sessionId) {
    return sendError(res, 404, 'PREVIEW_SESSION_NOT_FOUND', 'Sesja podglądu nie istnieje.');
  }

  await replaceActivePreviewSession();
  return res.json({ cleared: true });
});

const httpServer = app.listen(PORT, HOST, async () => {
  await fsp.mkdir(tmpRoot, { recursive: true });
  const url = `http://${HOST}:${PORT}`;
  console.log(`x265 converter running at ${url}`);
  console.log(`x265 converter temp dir: ${tmpRoot}`);
  if (!process.env.ELECTRON_RUN && AUTO_OPEN_BROWSER) {
    try {
      await open(PUBLIC_URL);
    } catch (error) {
      console.warn(`Cannot auto-open browser: ${error.message}`);
    }
  }
});

httpServer.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[server] Port ${HOST}:${PORT} jest już zajęty.`);
    // In Electron mode another instance may already be serving the app.
    process.exit(process.env.ELECTRON_RUN ? 0 : 1);
    return;
  }

  console.error('[server] Nie udało się uruchomić serwera:', error?.message || error);
  process.exit(1);
});

function resolveBinary(name, bundledPath) {
  const envValue = process.env[`${name.toUpperCase()}_PATH`];
  if (envValue && fs.existsSync(envValue)) {
    return envValue;
  }

  const pathMatch = findBinaryInPath(name);
  if (pathMatch) {
    return pathMatch;
  }

  return bundledPath;
}

function findBinaryInPath(binaryName) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  const candidates = process.platform === 'win32'
    ? [`${binaryName}.exe`, `${binaryName}.cmd`, `${binaryName}.bat`]
    : [binaryName];

  for (const entry of pathEntries) {
    if (!entry) {
      continue;
    }

    for (const candidate of candidates) {
      const candidatePath = path.join(entry, candidate);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

async function generateCompareSession(session) {
  const buildClipArgs = (inputFile, outputFile, startSeconds, durationSeconds) => [
    '-y',
    '-hide_banner',
    '-progress', 'pipe:1',
    '-nostats',
    '-ss', String(startSeconds),
    '-i', inputFile,
    '-t', String(durationSeconds),
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'mp4',
    '-movflags', 'faststart',
    outputFile
  ];

  try {
    await fsp.mkdir(session.tmpDir, { recursive: true });

    session.status = 'generating';
    session.stage = 'extract-original';
    session.stageProgressPercent = 0;
    session.progressPercent = 0;
    session.etaSeconds = null;

    await runFfmpegWithProgress(
      session,
      buildClipArgs(session.sourceFile, session.originalPath, session.startSeconds, session.durationSeconds),
      (ffmpegState) => {
        session.stage = 'extract-original';
        session.stageProgressPercent = Number(Math.min(100, ffmpegState.progress * 100).toFixed(1));
        session.progressPercent = Number(Math.min(45, ffmpegState.progress * 45).toFixed(1));
        const eta1 = estimateEtaSeconds(session.durationSeconds, ffmpegState.progress, ffmpegState.speed);
        const eta2 = estimateEtaSeconds(session.durationSeconds, 0, ffmpegState.speed);
        session.etaSeconds = eta1 == null ? null : Math.max(0, eta1 + (eta2 == null ? 0 : eta2));
      }
    );

    if (previewState.activeSession?.id !== session.id) {
      return;
    }

    session.stage = 'extract-encoded';
    session.stageProgressPercent = 0;
    session.progressPercent = 45;

    await runFfmpegWithProgress(
      session,
      buildClipArgs(session.encodedFile, session.encodedPath, session.startSeconds, session.durationSeconds),
      (ffmpegState) => {
        session.stage = 'extract-encoded';
        session.stageProgressPercent = Number(Math.min(100, ffmpegState.progress * 100).toFixed(1));
        session.progressPercent = Number(Math.min(100, 45 + ffmpegState.progress * 55).toFixed(1));
        session.etaSeconds = estimateEtaSeconds(session.durationSeconds, ffmpegState.progress, ffmpegState.speed);
      }
    );

    if (previewState.activeSession?.id !== session.id) {
      return;
    }

    session.status = 'ready';
    session.stage = 'done';
    session.stageProgressPercent = 100;
    session.progressPercent = 100;
    session.etaSeconds = 0;
    session.process = null;
  } catch (error) {
    if (previewState.activeSession?.id !== session.id) {
      return;
    }
    session.status = 'failed';
    session.stage = 'failed';
    session.stageProgressPercent = 0;
    session.error = error.message || 'Generowanie porównania nie powiodło się.';
    session.etaSeconds = null;
    session.process = null;
  }
}

async function generatePreviewSession(session) {
  try {
    await fsp.mkdir(session.tmpDir, { recursive: true });

    session.status = 'generating';
    session.stage = 'extract-original';
    session.stageProgressPercent = 0;
    session.progressPercent = 0;
    session.etaSeconds = null;

    const originalArgs = [
      '-y',
      '-hide_banner',
      '-progress', 'pipe:1',
      '-nostats',
      '-ss', String(session.startSeconds),
      '-i', session.sourceFile,
      '-t', String(session.durationSeconds),
      '-map', '0:v:0',
      '-map', '0:a?'
    ];

    if (session.prepMode === 'accurate') {
      originalArgs.push(
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '4',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k'
      );
    } else {
      originalArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '10',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k'
      );
    }

    originalArgs.push('-movflags', '+faststart');

    originalArgs.push(session.originalPath);

    await runFfmpegWithProgress(session, originalArgs, (ffmpegState) => {
      const stageProgress = Math.max(0, Math.min(100, ffmpegState.progress * 100));
      session.stage = 'extract-original';
      session.stageProgressPercent = Number(stageProgress.toFixed(1));
      session.progressPercent = Math.min(45, Number((ffmpegState.progress * 45).toFixed(1)));
      const stageEta = estimateEtaSeconds(session.durationSeconds, ffmpegState.progress, ffmpegState.speed);
      const nextStageEstimate = estimateEtaSeconds(session.durationSeconds, 0, ffmpegState.speed);
      session.etaSeconds = stageEta == null
        ? null
        : Math.max(0, stageEta + (nextStageEstimate == null ? 0 : nextStageEstimate));
    });

    if (previewState.activeSession?.id !== session.id) {
      return;
    }

    const probe = await ffprobe(session.originalPath);
    const sourceSizeBytes = Number(probe.format?.size || 0);
    const durationSeconds = Math.max(1, Number(probe.format?.duration || session.durationSeconds || 60));
    const targetSizeBytes = Math.max(1, Math.round(sourceSizeBytes * (session.settings.targetPercent / 100)));

    const previewJob = {
      sourceFile: session.originalPath,
      outputPath: session.encodedPath,
      settings: session.settings,
      probe,
      metrics: {
        durationSeconds,
        sourceDurationSeconds: durationSeconds,
        sourceSizeBytes,
        targetSizeBytes,
        estimatedOutputSizeBytes: targetSizeBytes,
        currentSizeBytes: 0,
        progressPercent: 0,
        fps: 0,
        etaSeconds: null,
        speed: 0
      }
    };

    const encodedArgs = buildFfmpegArgs(previewJob);
    const outputIndex = encodedArgs.lastIndexOf(session.encodedPath);
    if (outputIndex >= 0) {
      encodedArgs.splice(outputIndex, 0, '-an');
    }

    await runFfmpegWithProgress(session, encodedArgs, (ffmpegState) => {
      const stageProgress = Math.max(0, Math.min(100, ffmpegState.progress * 100));
      session.stage = 'encode-preview';
      session.stageProgressPercent = Number(stageProgress.toFixed(1));
      session.progressPercent = Math.min(100, Number((45 + ffmpegState.progress * 55).toFixed(1)));
      session.etaSeconds = estimateEtaSeconds(session.durationSeconds, ffmpegState.progress, ffmpegState.speed);
    });

    if (previewState.activeSession?.id !== session.id) {
      return;
    }

    session.status = 'ready';
    session.stage = 'done';
    session.stageProgressPercent = 100;
    session.progressPercent = 100;
    session.etaSeconds = 0;
    session.process = null;
  } catch (error) {
    if (previewState.activeSession?.id !== session.id) {
      return;
    }
    session.status = 'failed';
    session.stage = 'failed';
    session.stageProgressPercent = 0;
    session.error = error.message || 'Generowanie podglądu nie powiodło się.';
    session.etaSeconds = null;
    session.process = null;
  }
}

function runFfmpegWithProgress(session, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    session.process = child;

    child.stdout.on('data', (chunk) => {
      const progressState = parseProgressFromChunk(chunk.toString(), session.durationSeconds);
      if (progressState !== null) {
        onProgress(progressState);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (previewState.activeSession?.id !== session.id) {
        resolve();
        return;
      }

      session.process = null;
      if (code !== 0) {
        reject(new Error(stderr || `ffmpeg exited with ${code}`));
        return;
      }

      resolve();
    });
  });
}

function extractPreviewFrameBuffer(sourceFile, timeSeconds) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(timeSeconds),
      '-i', sourceFile,
      '-frames:v', '1',
      '-vf', 'scale=640:-1',
      '-q:v', '4',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ];

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks = [];
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `ffmpeg exited with ${code}`));
      }

      const output = Buffer.concat(chunks);
      if (!output.length) {
        return reject(new Error('ffmpeg nie zwrócił klatki podglądu.'));
      }

      resolve(output);
    });
  });
}

function parseProgressFromChunk(chunk, durationSeconds) {
  const lines = chunk.split(/\r?\n/).filter(Boolean);
  let outTimeSeconds = null;
  let speed = 0;

  for (const line of lines) {
    if (line.startsWith('out_time_ms=')) {
      const raw = line.slice('out_time_ms='.length);
      const parsedSeconds = Number(raw) / 1_000_000;
      if (Number.isFinite(parsedSeconds)) {
        outTimeSeconds = parsedSeconds;
      }
      continue;
    }

    if (line.startsWith('speed=')) {
      speed = parseSpeed(line.slice('speed='.length));
    }
  }

  if (!Number.isFinite(outTimeSeconds)) {
    return null;
  }

  const safeDuration = Math.max(1, Number(durationSeconds || 1));
  const progress = Math.max(0, Math.min(1, outTimeSeconds / safeDuration));
  return {
    progress,
    speed: Number.isFinite(speed) && speed > 0 ? speed : 0
  };
}

function estimateEtaSeconds(durationSeconds, progress, speed) {
  const safeDuration = Math.max(1, Number(durationSeconds || 1));
  const safeProgress = Math.max(0, Math.min(1, Number(progress || 0)));
  const safeSpeed = Number(speed || 0);

  if (!Number.isFinite(safeSpeed) || safeSpeed <= 0) {
    return null;
  }

  const remainingMediaSeconds = safeDuration * (1 - safeProgress);
  return Math.max(0, Math.round(remainingMediaSeconds / safeSpeed));

  return null;
}

async function replaceActivePreviewSession() {
  const session = previewState.activeSession;
  if (!session) {
    return;
  }

  previewState.activeSession = null;

  if (session.process && !session.process.killed) {
    try {
      session.process.kill('SIGTERM');
    } catch (_error) {
      // noop
    }
  }

  await removeDirectorySafe(session.tmpDir);
}

async function removeDirectorySafe(dirPath) {
  if (!dirPath) {
    return;
  }

  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch (_error) {
    // noop
  }
}

async function scanForVideos(rootDir) {
  const result = [];
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await scanForVideos(fullPath));
      continue;
    }

    if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      result.push(fullPath);
    }
  }

  return result.sort((left, right) => left.localeCompare(right, 'pl'));
}

async function assertVideoFileExists(filePath) {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`Plik nie istnieje: ${filePath}`);
  }
  if (!VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error(`Nieobsługiwane rozszerzenie: ${filePath}`);
  }
}

function isVideoInputError(error) {
  const message = String(error?.message || '');
  return message.startsWith('Plik nie istnieje:') || message.startsWith('Nieobsługiwane rozszerzenie:');
}

function normalizeSettings(input) {
  const encoder = input.encoder === 'gpu' ? 'gpu' : 'cpu';
  const targetPercent = clampNumber(Number(input.targetPercent), 20, 95, 55);
  const qualityPreset = normalizeQualityPreset(input.qualityPreset);
  const audioCodec = input.audioCodec === 'copy' ? 'copy' : 'opus';
  const audioBitrateKbps = clampNumber(Number(input.audioBitrateKbps), 32, 320, 96);
  const testClipEnabled = Boolean(input.testClipEnabled);
  const smartQuality = Boolean(input.smartQuality);
  const fpsMode = input.fpsMode === '24' ? '24' : 'source';

  return {
    encoder,
    targetPercent,
    qualityPreset,
    audioCodec,
    audioBitrateKbps,
    testClipEnabled,
    smartQuality,
    fpsMode
  };
}


function normalizePreviewPrepMode(value) {
  return value === 'accurate' ? 'accurate' : 'quick';
}

function normalizeQualityPreset(value) {
  if (value === 'speed' || value === 'balanced' || value === 'quality') {
    return value;
  }
  return 'quality';
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function suggestQualityFromProbe(probe) {
  const videoStream = (probe?.streams || []).find((stream) => stream.codec_type === 'video') || {};
  const width = Number(videoStream.width || 0);
  const height = Number(videoStream.height || 0);
  const pixels = Math.max(1, width * height);
  const codec = String(videoStream.codec_name || '').toLowerCase() || 'unknown';
  const fps = parseFps(videoStream.avg_frame_rate || videoStream.r_frame_rate);
  const sourceBitrate = Number(probe?.format?.bit_rate || videoStream.bit_rate || 0);
  const sourceKbps = Math.max(0, Math.round(sourceBitrate / 1000));
  const bppf = sourceBitrate > 0 && fps > 0 ? sourceBitrate / (pixels * fps) : 0;

  // Balanced target: typically 60-70% source size in practical HEVC transcode.
  let crf = 24;
  let preset = 'balanced';
  let audioBitrateKbps = 96;

  if (height >= 2160) {
    crf = 22;
    preset = 'quality';
    audioBitrateKbps = 128;
  } else if (height >= 1440) {
    crf = 23;
    preset = 'quality';
    audioBitrateKbps = 112;
  } else if (height >= 1080) {
    crf = 24;
    preset = 'balanced';
    audioBitrateKbps = 96;
  } else if (height >= 720) {
    crf = 25;
    preset = 'balanced';
    audioBitrateKbps = 96;
  } else {
    crf = 26;
    preset = 'speed';
    audioBitrateKbps = 80;
  }

  if (fps >= 50) {
    crf -= 1;
  }

  // If source is already very compressed, avoid aggressive compression.
  if (bppf > 0 && bppf < 0.08) {
    crf -= 1;
  }

  // If source is very high bitrate, we can compress a bit more safely.
  if (bppf > 0.16) {
    crf += 1;
  }

  // Small quality bias: slightly less compression by default.
  crf -= 1;

  const alreadyEfficientCodec = codec === 'hevc' || codec === 'h265' || codec === 'av1' || codec === 'vp9';
  const warning = alreadyEfficientCodec
    ? `Źródło jest już w wydajnym kodeku (${codec}). Zysk rozmiaru może być mały.`
    : null;

  crf = clampNumber(crf, 20, 30, 24);

  return {
    crf,
    preset,
    audioBitrateKbps,
    analysis: {
      width,
      height,
      fps,
      sourceKbps,
      codec,
      bppf: Number(bppf.toFixed(4))
    },
    estimatedRatio: '65-75%',
    warning
  };
}

function parseFps(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }

  if (text.includes('/')) {
    const [numRaw, denRaw] = text.split('/');
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }

  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return direct;
  }

  return 0;
}

async function createJob(sourceFile, settings) {
  const outputPath = buildOutputPath(sourceFile, settings);
  const isAlreadyConvertedByName = hasX265NameSuffix(sourceFile);

  if (isAlreadyConvertedByName) {
    const sourceStat = await fsp.stat(sourceFile);
    const sourceSizeBytes = Number(sourceStat.size || 0);
    return {
      id: queueState.nextId++,
      sourceFile,
      outputPath,
      settings,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: new Date().toISOString(),
      status: 'skipped',
      error: null,
      probe: null,
      suggestedQuality: null,
      metrics: {
        durationSeconds: 0,
        sourceDurationSeconds: 0,
        sourceSizeBytes,
        targetSizeBytes: sourceSizeBytes,
        estimatedOutputSizeBytes: sourceSizeBytes,
        currentSizeBytes: sourceSizeBytes,
        progressPercent: 100,
        fps: 0,
        etaSeconds: 0,
        speed: 0,
        conversionSeconds: null,
        sizeSavedBytes: null,
        sizeSavedPercent: null
      },
      videoCodec: null,
      audioCodec: null,
      process: null,
      cancelRequested: false,
      deleteOutputOnFinish: false,
      isHevcSource: false,
      isAlreadyConvertedByName: true,
      skipReason: 'Pominięto: nazwa pliku wskazuje, że to już wynik konwersji (--- x265).'
    };
  }

  const probe = await ffprobe(sourceFile);
  const sourceDurationSeconds = Number(probe.format?.duration || 0);
  const durationSeconds = settings.testClipEnabled
    ? Math.max(1, Math.min(60, sourceDurationSeconds || 60))
    : sourceDurationSeconds;
  const sourceSizeBytes = Number(probe.format?.size || 0);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStream = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
  const targetSizeBytes = Math.max(1, Math.round(sourceSizeBytes * (settings.targetPercent / 100)));
  const sourceCodec = String(videoStream?.codec_name || '').toLowerCase();
  const isHevcSource = isHevcLikeCodec(sourceCodec);

  const shouldUseSmartCrfMode = settings.smartQuality
    && !isHevcSource
    && Math.abs(Number(settings.targetPercent || 55) - 55) < 0.5;

  let suggestedQuality = shouldUseSmartCrfMode
    ? suggestQualityFromProbe(probe)
    : null;

  const job = {
    id: queueState.nextId++,
    sourceFile,
    outputPath,
    settings,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    status: 'queued',
    error: null,
    probe,
    suggestedQuality,
    metrics: {
      durationSeconds,
      sourceDurationSeconds,
      sourceSizeBytes,
      targetSizeBytes,
      estimatedOutputSizeBytes: targetSizeBytes,
      currentSizeBytes: 0,
      progressPercent: 0,
      fps: 0,
      etaSeconds: null,
      speed: 0,
      conversionSeconds: null,
      sizeSavedBytes: null,
      sizeSavedPercent: null
    },
    videoCodec: videoStream?.codec_name || null,
    audioCodec: audioStream?.codec_name || null,
    process: null,
    cancelRequested: false,
    deleteOutputOnFinish: false,
    isHevcSource,
    isAlreadyConvertedByName,
    skipReason: null
  };

  if (settings.smartQuality && suggestedQuality) {
    const optimized = await optimizeSmartQualityBySamples(job);
    if (optimized) {
      suggestedQuality = {
        ...suggestedQuality,
        ...optimized,
        preset: 'balanced'
      };
      job.suggestedQuality = suggestedQuality;
    }
  }

  return job;
}

function buildOutputPath(sourceFile, settings) {
  const parsed = path.parse(sourceFile);
  const suffix = settings.testClipEnabled ? ' --- x265 TEST-1m' : ' --- x265';
  return path.join(parsed.dir, `${parsed.name}${suffix}.mkv`);
}

function ffprobe(sourceFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-print_format', 'json',
      sourceFile
    ];

    const child = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe exited with ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function runNextJob() {
  enforceConcurrencyLimit();

  while (true) {
    const processingCount = queueState.jobs.filter((job) => job.status === 'processing').length;
    if (processingCount >= queueState.maxConcurrentJobs) {
      return;
    }

    const pausedJob = queueState.jobs.find((job) => job.status === 'paused' && job.process);
    if (pausedJob) {
      const resumed = resumePausedJob(pausedJob);
      if (!resumed) {
        return;
      }
      continue;
    }

    const nextJob = queueState.jobs.find((job) => job.status === 'queued');
    if (!nextJob) {
      return;
    }

    queueState.activeJobIds.add(nextJob.id);
    nextJob.status = 'processing';
    nextJob.startedAt = nextJob.startedAt || new Date().toISOString();

    runJob(nextJob)
      .then(() => {
        nextJob.status = nextJob.cancelRequested ? 'cancelled' : 'completed';
      })
      .catch((error) => {
        nextJob.status = nextJob.cancelRequested ? 'cancelled' : 'failed';
        nextJob.error = error.message;
      })
      .finally(() => {
        nextJob.finishedAt = new Date().toISOString();
        nextJob.process = null;
        queueState.activeJobIds.delete(nextJob.id);
        runNextJob().catch((error) => {
          console.error('Queue runner failed:', error);
        });
      });
  }
}

function enforceConcurrencyLimit() {
  while (true) {
    const processingJobs = queueState.jobs.filter((job) => job.status === 'processing' && job.process);
    if (processingJobs.length <= queueState.maxConcurrentJobs) {
      return;
    }

    // Przy zmniejszaniu limitu pauzuj zadanie z najmniejszym postępem.
    const toPause = processingJobs
      .slice()
      .sort((a, b) => Number(a.metrics?.progressPercent || 0) - Number(b.metrics?.progressPercent || 0))[0];

    if (!toPause) {
      return;
    }

    pauseProcessingJob(toPause);
  }
}

function pauseProcessingJob(job) {
  if (!job || job.status !== 'processing' || !job.process) {
    return false;
  }

  try {
    job.process.kill('SIGSTOP');
    job.status = 'paused';
    queueState.activeJobIds.delete(job.id);
    return true;
  } catch (_error) {
    return false;
  }
}

function resumePausedJob(job) {
  if (!job || job.status !== 'paused' || !job.process) {
    return false;
  }

  try {
    job.process.kill('SIGCONT');
    job.status = 'processing';
    queueState.activeJobIds.add(job.id);
    return true;
  } catch (_error) {
    return false;
  }
}

function runJob(job) {
  return new Promise(async (resolve, reject) => {
    const runStartedAt = Date.now();

    try {
      // Keep preparation lightweight; run sample optimization only for the active job.
      if (job.settings.smartQuality && job.suggestedQuality) {
        const optimized = await Promise.race([
          optimizeSmartQualityBySamples(job),
          new Promise((resolve) => setTimeout(() => resolve(null), 90_000))
        ]);
        if (optimized) {
          job.suggestedQuality = {
            ...job.suggestedQuality,
            ...optimized,
            preset: 'balanced'
          };
        }
      }

      const args = buildFfmpegArgs(job);
      await runFfmpegCommand(job, args);

      if (job.cancelRequested) {
        if (job.deleteOutputOnFinish) {
          await removeOutputFile(job.outputPath);
        }
        resolve();
        return;
      }

      const stat = await fsp.stat(job.outputPath);
      const sourceSize = Math.max(1, Number(job.metrics.sourceSizeBytes || 0));
      const outputSize = Number(stat.size || 0);
      const savedBytes = sourceSize - outputSize;
      const savedPercent = (savedBytes / sourceSize) * 100;
      job.metrics.currentSizeBytes = stat.size;
      job.metrics.estimatedOutputSizeBytes = stat.size;
      job.metrics.progressPercent = 100;
      job.metrics.etaSeconds = 0;
      job.metrics.conversionSeconds = Math.max(0, Math.round((Date.now() - runStartedAt) / 1000));
      job.metrics.sizeSavedBytes = savedBytes;
      job.metrics.sizeSavedPercent = Number(savedPercent.toFixed(2));
      resolve();
    } catch (error) {
      if (job.cancelRequested) {
        if (job.deleteOutputOnFinish) {
          await removeOutputFile(job.outputPath);
        }
        resolve();
        return;
      }

      if (job.deleteOutputOnFinish) {
        await removeOutputFile(job.outputPath);
      }
      reject(error);
    }
  });
}

function runFfmpegCommand(job, args) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    job.process = processHandle;

    processHandle.stdout.on('data', (chunk) => {
      parseFfmpegProgress(job, chunk.toString());
    });

    processHandle.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    processHandle.on('error', reject);
    processHandle.on('close', (code) => {
      if (job.cancelRequested) {
        resolve();
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr || `ffmpeg exited with ${code}`));
        return;
      }

      resolve();
    });
  });
}
function buildFfmpegArgs(job) {
  const { sourceFile, outputPath, settings, metrics, probe } = job;
  const duration = Math.max(1, metrics.sourceDurationSeconds || metrics.durationSeconds || 1);
  const cores = Math.max(1, (os.cpus() || []).length || 1);
  const threadLimit = cores;
  const videoStream = (probe?.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStream = (probe?.streams || []).find((stream) => stream.codec_type === 'audio');

  const encodedAudioBitrateBits = settings.audioCodec === 'opus'
    ? Math.max(32_000, Number(settings.audioBitrateKbps || 96) * 1000)
    : Math.max(0, Number(audioStream?.bit_rate || 0));

  const minimumVideoBitrate = 30_000;
  const minimumTotalBitrate = encodedAudioBitrateBits + minimumVideoBitrate;
  const targetTotalBitrate = Math.max(
    minimumTotalBitrate,
    Math.floor((Math.max(1, Number(metrics.targetSizeBytes || 1)) * 8) / duration)
  );
  const videoBitrate = Math.max(minimumVideoBitrate, Math.floor(targetTotalBitrate - encodedAudioBitrateBits));
  const sourceColorRange = normalizeColorRange(videoStream?.color_range);

  const presetMap = PRESET_MAP;

  const args = [
    '-y',
    '-hide_banner'
  ];

  args.push('-progress', 'pipe:1', '-nostats');

  args.push(
    '-threads', String(threadLimit),
    '-i', sourceFile,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-map', '0:s?',
    '-map_metadata', '0'
  );

  const conversionMode = job.suggestedQuality ? 'smart-crf' : 'bitrate-target';
  const effectivePreset = job.suggestedQuality?.preset || settings.qualityPreset || 'quality';
  const videoBitrateKbps = Math.max(1, Math.round(videoBitrate / 1000));
  const targetPercent = Math.max(1, Math.round(Number(settings.targetPercent || 55)));
  const readableMode = conversionMode === 'smart-crf'
    ? 'Smart CRF (próbki)'
    : 'Bitrate docelowy';
  const readableEncoder = settings.encoder === 'gpu' ? 'GPU / hevc_nvenc' : 'CPU / libx265';
  const readableAudio = settings.audioCodec === 'copy'
    ? 'copy bez zmian'
    : `Opus ${Math.round(Number(settings.audioBitrateKbps || 96))} kb/s`;
  const readableVideo = job.suggestedQuality
    ? `CRF ${job.suggestedQuality.crf}`
    : `Video ${videoBitrateKbps} kb/s`;
  const readableSummary = [
    'x265 Converter',
    `Tryb: ${readableMode}`,
    `Docelowy rozmiar: ${targetPercent}%`,
    `Silnik: ${readableEncoder}`,
    `Profil: ${effectivePreset}`,
    `Wideo: ${readableVideo}`,
    `Audio: ${readableAudio}`
  ].join(' | ');

  const metadataPairs = [
    ['title', `x265 Converter - ${targetPercent}%`],
    ['comment', readableSummary],
    ['description', readableSummary],
    ['encoded_by', 'x265 Converter'],
    ['x265_converter_mode', conversionMode],
    ['x265_converter_target_percent', String(targetPercent)],
    ['x265_converter_encoder', String(settings.encoder || 'cpu')],
    ['x265_converter_preset', String(effectivePreset)],
    ['x265_converter_audio_codec', String(settings.audioCodec || 'opus')],
    ['x265_converter_audio_bitrate_kbps', String(Math.round(Number(settings.audioBitrateKbps || 96)))],
    ['x265_converter_fps_mode', String(settings.fpsMode || 'source')]
  ];

  if (job.suggestedQuality?.crf != null) {
    metadataPairs.push(['x265_converter_crf', String(job.suggestedQuality.crf)]);
  } else {
    metadataPairs.push(['x265_converter_video_bitrate_kbps', String(videoBitrateKbps)]);
  }

  for (const [key, value] of metadataPairs) {
    args.push('-metadata', `${key}=${value}`);
  }

  // Smart Quality (CRF mode) vs standard bitrate mode
  if (job.suggestedQuality) {
    const sq = job.suggestedQuality;
    const cpuPreset = presetMap.cpu[sq.preset] || 'medium';
    const gpuPreset = presetMap.gpu[sq.preset] || 'p4';
    const effectiveAudioKbps = sq.audioBitrateKbps || settings.audioBitrateKbps;

    if (settings.encoder === 'gpu') {
      args.push(
        '-c:v', 'hevc_nvenc',
        '-preset', gpuPreset,
        '-rc', 'constqp',
        '-qp', String(sq.crf)
      );
    } else {
      args.push(
        '-c:v', 'libx265',
        '-preset', cpuPreset,
        '-crf', String(sq.crf),
        '-tag:v', 'hvc1'
      );
    }

    if (settings.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'libopus', '-b:a', `${effectiveAudioKbps}k`);
    }
  } else {
    if (settings.encoder === 'gpu') {
      args.push(
        '-c:v', 'hevc_nvenc',
        '-preset', presetMap.gpu[settings.qualityPreset],
        '-rc', 'vbr',
        '-b:v', String(videoBitrate),
        '-maxrate', String(Math.round(videoBitrate * 1.25)),
        '-bufsize', String(Math.round(videoBitrate * 2))
      );
    } else {
      const cpuPreset = presetMap.cpu[settings.qualityPreset];
      args.push(
        '-c:v', 'libx265',
        '-preset', cpuPreset,
        '-b:v', String(videoBitrate),
        '-maxrate', String(Math.round(videoBitrate * 1.25)),
        '-bufsize', String(Math.max(60_000, Math.round(videoBitrate * 2))),
        '-tag:v', 'hvc1'
      );
    }

    if (settings.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'libopus', '-b:a', `${settings.audioBitrateKbps}k`);
    }
  }

  if (sourceColorRange) {
    args.push('-color_range', sourceColorRange);
  }

  if (settings.testClipEnabled) {
    args.push('-t', '60');
  }

  if (settings.fpsMode === '24') {
    args.push('-r', '24');
  }

  args.push('-c:s', 'copy');

  args.push(outputPath);
  return args;
}

function isHevcLikeCodec(codec) {
  const normalized = String(codec || '').toLowerCase();
  return normalized === 'hevc' || normalized === 'h265' || normalized === 'x265';
}

function hasX265NameSuffix(filePath) {
  const baseName = path.parse(String(filePath || '')).name.toLowerCase();
  return baseName.endsWith(' --- x265') || baseName.endsWith(' --- x265 test-1m');
}

function normalizeColorRange(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'tv' || normalized === 'mpeg' || normalized === 'limited') {
    return 'tv';
  }

  if (normalized === 'pc' || normalized === 'jpeg' || normalized === 'full') {
    return 'pc';
  }

  return null;
}

function parseFfmpegProgress(job, chunk) {
  const lines = chunk.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    if (key === 'out_time_ms') {
      const outTimeSeconds = Number(rawValue) / 1_000_000;
      const duration = Math.max(1, job.metrics.durationSeconds || 1);
      job.metrics.progressPercent = Math.min(100, Number(((outTimeSeconds / duration) * 100).toFixed(2)));
      if (job.metrics.speed > 0) {
        const remainingSeconds = Math.max(0, duration - outTimeSeconds);
        job.metrics.etaSeconds = Math.round(remainingSeconds / job.metrics.speed);
      }
      continue;
    }

    if (key === 'fps') {
      job.metrics.fps = Number(rawValue) || 0;
      continue;
    }

    if (key === 'speed') {
      job.metrics.speed = parseSpeed(rawValue);
      continue;
    }

    if (key === 'total_size') {
      job.metrics.currentSizeBytes = Number(rawValue) || 0;
    }
  }
}

function parseSpeed(value) {
  if (!value) {
    return 0;
  }
  return Number(String(value).replace('x', '')) || 0;
}

function buildSampleStarts(durationSeconds) {
  const safeDuration = Math.max(1, Number(durationSeconds || 1));
  const sampleDuration = 10;
  const maxStart = Math.max(0, safeDuration - sampleDuration);
  // 5 samples spread between 10%-90% of video; skips opening/closing credits
  const anchors = [0.10, 0.30, 0.50, 0.70, 0.90];
  return anchors.map((point) => Number((Math.max(0, Math.min(maxStart, maxStart * point))).toFixed(2)));
}

async function optimizeSmartQualityBySamples(job) {
  // Adaptive candidates centred on the probe-suggested CRF (±2 steps, clamped to 20-30)
  const probeCrf = Math.round(Number(job.suggestedQuality?.crf || 24));
  const rawCandidates = [-2, -1, 0, 1, 2].map((d) => Math.max(20, Math.min(30, probeCrf + d)));
  const candidates = [...new Set(rawCandidates)];

  const starts = buildSampleStarts(job.metrics.sourceDurationSeconds);
  const sampleDuration = 10;
  const tmpDir = path.join(tmpRoot, `smart_${job.id}_${Date.now().toString(36)}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  try {
    const results = [];

    for (const crf of candidates) {
      let totalBytes = 0;
      let totalSsim = 0;
      let successCount = 0;

      for (let index = 0; index < starts.length; index += 1) {
        const start = starts[index];
        const output = path.join(tmpDir, `c${crf}_${index}.mkv`);
        const sampleResult = await encodeSampleAndScore(job, { start, duration: sampleDuration, crf, output });
        if (!sampleResult) {
          continue;
        }

        totalBytes += sampleResult.sizeBytes;
        totalSsim += sampleResult.ssim;
        successCount += 1;
      }

      if (!successCount) {
        continue;
      }

      results.push({
        crf,
        avgSsim: totalSsim / successCount,
        avgSizeBytes: totalBytes / successCount,
        sampleCount: successCount
      });
    }

    if (!results.length) {
      return null;
    }

    // Dynamic SSIM tolerance: tighter for high-quality sources, looser for difficult ones
    const bestQuality = Math.max(...results.map((item) => item.avgSsim));
    const ssimTolerance = Math.min(0.020, Math.max(0.005, 0.40 * (1.0 - bestQuality)));
    const qualifiedCandidates = results.filter((item) => item.avgSsim >= bestQuality - ssimTolerance);

    // Multi-criteria scoring among qualified candidates: 65% SSIM, 25% size saving, 10% stability
    const maxSize = Math.max(...qualifiedCandidates.map((r) => r.avgSizeBytes));
    const maxSamples = Math.max(...qualifiedCandidates.map((r) => r.sampleCount));
    for (const r of qualifiedCandidates) {
      const ssimScore = bestQuality > 0 ? r.avgSsim / bestQuality : 1;
      const sizeScore = maxSize > 0 ? 1 - r.avgSizeBytes / maxSize : 1;
      const stabilityScore = maxSamples > 0 ? r.sampleCount / maxSamples : 1;
      r._score = 0.65 * ssimScore + 0.25 * sizeScore + 0.10 * stabilityScore;
    }
    const winner = qualifiedCandidates.sort((a, b) => b._score - a._score)[0] || results[0];

    return {
      crf: winner.crf,
      sampleSummary: {
        mode: `${starts.length}x${sampleDuration}s`,
        avgSsim: Number(winner.avgSsim.toFixed(4)),
        avgSampleSizeBytes: Math.round(winner.avgSizeBytes),
        ssimTolerance: Number(ssimTolerance.toFixed(4)),
        evaluatedCandidates: results.map((item) => ({
          crf: item.crf,
          avgSsim: Number(item.avgSsim.toFixed(4)),
          avgSampleSizeBytes: Math.round(item.avgSizeBytes),
          sampleCount: item.sampleCount
        }))
      }
    };
  } finally {
    await removeDirectorySafe(tmpDir);
  }
}

function encodeSampleAndScore(job, options) {
  return new Promise((resolve, reject) => {
    const start = Number(options.start || 0);
    const duration = Number(options.duration || 10);
    const crf = Number(options.crf || 24);
    const output = String(options.output || '');

    const isGpu = job.settings?.encoder === 'gpu';
    const threadLimit = computeThreadLimit();
    const qualityPreset = job.settings?.qualityPreset || 'quality';
    const cpuPreset = PRESET_MAP.cpu[qualityPreset] || 'medium';
    const gpuPreset = PRESET_MAP.gpu[qualityPreset] || 'p4';

    const args = [
      '-y',
      '-hide_banner',
      '-threads', String(threadLimit),
      '-ss', String(start),
      '-i', job.sourceFile,
      '-t', String(duration),
      '-map', '0:v:0',
      '-map', '0:a?'
    ];

    if (isGpu) {
      args.push('-c:v', 'hevc_nvenc', '-preset', gpuPreset, '-rc', 'constqp', '-qp', String(crf));
    } else {
      args.push('-c:v', 'libx265', '-preset', cpuPreset, '-crf', String(crf), '-tag:v', 'hvc1');
    }

    if (job.settings.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      const abr = Math.max(32, Number(job.settings.audioBitrateKbps || 96));
      args.push('-c:a', 'libopus', '-b:a', `${abr}k`);
    }

    if (job.settings.fpsMode === '24') {
      args.push('-r', '24');
    }

    args.push(output);

    const encoder = spawn(ffmpegPath, args, { windowsHide: true });
    let encoderStderr = '';
    encoder.stderr.on('data', (chunk) => {
      encoderStderr += chunk.toString();
    });

    encoder.on('error', reject);
    encoder.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(encoderStderr || `sample encode exited with ${code}`));
        return;
      }

      try {
        const stat = await fsp.stat(output);
        const ssim = await measureSsim(job.sourceFile, output, start, duration);
        resolve({ sizeBytes: stat.size, ssim });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function measureSsim(sourceFile, encodedFile, start, duration) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-ss', String(start),
      '-t', String(duration),
      '-i', sourceFile,
      '-i', encodedFile,
      '-lavfi', 'ssim',
      '-f', 'null',
      '-'
    ];

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ssim exited with ${code}`));
        return;
      }

      const ssimValue = extractSsimScore(stderr);
      resolve(ssimValue);
    });
  });
}

function computeThreadLimit() {
  const cores = Math.max(1, (os.cpus() || []).length || 1);
  return cores;
}

function readCpuTimesSnapshot() {
  const cpus = os.cpus() || [];
  return cpus.reduce((acc, cpu) => {
    const times = cpu?.times || {};
    acc.idle += Number(times.idle || 0);
    acc.total += Number(times.user || 0)
      + Number(times.nice || 0)
      + Number(times.sys || 0)
      + Number(times.idle || 0)
      + Number(times.irq || 0);
    return acc;
  }, { idle: 0, total: 0 });
}

function refreshCpuMetrics() {
  const now = Date.now();
  const currentCpuTimes = readCpuTimesSnapshot();
  const currentProcessCpuUsage = process.cpuUsage();
  const cpuCount = Math.max(1, (os.cpus() || []).length || 1);

  const totalDelta = currentCpuTimes.total - cpuMetricsState.cpuTimes.total;
  const idleDelta = currentCpuTimes.idle - cpuMetricsState.cpuTimes.idle;
  if (totalDelta > 0) {
    const busyRatio = 1 - (idleDelta / totalDelta);
    cpuMetricsState.cpuUsagePercent = Math.max(0, Math.min(100, busyRatio * 100));
  }

  const previousProc = cpuMetricsState.processCpuUsage;
  const processDeltaMicros =
    (Number(currentProcessCpuUsage.user || 0) + Number(currentProcessCpuUsage.system || 0))
    - (Number(previousProc.user || 0) + Number(previousProc.system || 0));
  const elapsedMicrosAllCores = Math.max(1, (now - cpuMetricsState.ts) * 1000 * cpuCount);
  cpuMetricsState.processCpuPercent = Math.max(0, Math.min(100, (processDeltaMicros / elapsedMicrosAllCores) * 100));
  cpuMetricsState.processRssMB = process.memoryUsage().rss / (1024 * 1024);

  cpuMetricsState.ts = now;
  cpuMetricsState.cpuTimes = currentCpuTimes;
  cpuMetricsState.processCpuUsage = currentProcessCpuUsage;
}

function extractSsimScore(logText) {
  const match = /All:\s*([0-9.]+)/.exec(String(logText || ''));
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function stopJob(job) {
  if (job.status === 'queued' || job.status === 'preparing') {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    return true;
  }

  if ((job.status === 'processing' || job.status === 'paused') && job.process) {
    job.cancelRequested = true;
    if (job.status === 'paused') {
      try {
        job.process.kill('SIGCONT');
      } catch (_error) {
        // ignore
      }
    }
    job.process.kill('SIGTERM');
    return true;
  }

  return false;
}

async function resetJobForResume(job) {
  await removeOutputFile(job.outputPath);

  job.status = 'queued';
  job.error = null;
  job.startedAt = null;
  job.finishedAt = null;
  job.cancelRequested = false;
  job.deleteOutputOnFinish = false;
  job.process = null;

  job.metrics.progressPercent = 0;
  job.metrics.fps = 0;
  job.metrics.etaSeconds = null;
  job.metrics.speed = 0;
  job.metrics.currentSizeBytes = 0;
  job.metrics.conversionSeconds = null;
  job.metrics.sizeSavedBytes = null;
  job.metrics.sizeSavedPercent = null;
}

function createQueuedJob(sourceFile, settings) {
  const outputPath = buildOutputPath(sourceFile, settings);

  return {
    id: queueState.nextId++,
    sourceFile,
    outputPath,
    settings,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    status: 'preparing',
    error: null,
    probe: null,
    suggestedQuality: null,
    metrics: {
      durationSeconds: 0,
      sourceDurationSeconds: 0,
      sourceSizeBytes: 0,
      targetSizeBytes: Math.max(1, Math.round((settings.targetPercent / 100) * 1)),
      estimatedOutputSizeBytes: 0,
      currentSizeBytes: 0,
      progressPercent: 0,
      fps: 0,
      etaSeconds: null,
      speed: 0,
      conversionSeconds: null,
      sizeSavedBytes: null,
      sizeSavedPercent: null
    },
    videoCodec: null,
    audioCodec: null,
    process: null,
    cancelRequested: false,
    deleteOutputOnFinish: false,
    isHevcSource: false,
    isAlreadyConvertedByName: false,
    skipReason: null
  };
}

async function prepareJobForQueue(job) {
  try {
    const sourceStat = await fsp.stat(job.sourceFile);
    job.metrics.sourceSizeBytes = Number(sourceStat.size || 0);
    job.metrics.targetSizeBytes = Math.max(1, Math.round(job.metrics.sourceSizeBytes * (job.settings.targetPercent / 100)));
    job.metrics.estimatedOutputSizeBytes = job.metrics.sourceSizeBytes;

    const probe = await ffprobe(job.sourceFile);
    if (job.cancelRequested || job.status === 'cancelled') {
      return;
    }

    const sourceDurationSeconds = Number(probe.format?.duration || 0);
    const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
    const audioStream = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
    const isHevcSource = isHevcLikeCodec(videoStream?.codec_name);
    const shouldUseSmartCrfMode = job.settings.smartQuality
      && !isHevcSource
      && Math.abs(Number(job.settings.targetPercent || 55) - 55) < 0.5;

    job.probe = probe;
    job.videoCodec = videoStream?.codec_name || null;
    job.audioCodec = audioStream?.codec_name || null;
    job.isHevcSource = isHevcSource;
    job.metrics.sourceDurationSeconds = sourceDurationSeconds;
    job.metrics.durationSeconds = job.settings.testClipEnabled
      ? Math.max(1, Math.min(60, sourceDurationSeconds || 60))
      : sourceDurationSeconds;

    job.suggestedQuality = shouldUseSmartCrfMode
      ? suggestQualityFromProbe(probe)
      : null;

    if (job.cancelRequested || job.status === 'cancelled') {
      runNextJob().catch((runnerError) => {
        console.error('Queue runner failed:', runnerError);
      });
      return;
    }

    job.status = 'queued';
    runNextJob().catch((error) => {
      console.error('Queue runner failed:', error);
    });
  } catch (error) {
    if (job.cancelRequested || job.status === 'cancelled') {
      runNextJob().catch((runnerError) => {
        console.error('Queue runner failed:', runnerError);
      });
      return;
    }

    job.status = 'failed';
    job.error = error.message || 'Nie udało się przygotować zadania.';
    job.finishedAt = new Date().toISOString();
    runNextJob().catch((runnerError) => {
      console.error('Queue runner failed:', runnerError);
    });
  }
}

function getQueueSummary(jobs) {
  const summary = {
    total: jobs.length,
    preparing: 0,
    queued: 0,
    processing: 0,
    paused: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    overallProgressPercent: 0
  };

  let weightedProgressSum = 0;
  let weightedSizeSum = 0;

  for (const job of jobs) {
    const status = job.status;
    if (status === 'preparing') {
      summary.preparing += 1;
    } else if (status === 'queued') {
      summary.queued += 1;
    } else if (status === 'processing') {
      summary.processing += 1;
    } else if (status === 'paused') {
      summary.paused += 1;
    } else if (status === 'completed') {
      summary.completed += 1;
    } else if (status === 'skipped') {
      summary.skipped += 1;
    } else if (status === 'failed') {
      summary.failed += 1;
    } else if (status === 'cancelled') {
      summary.cancelled += 1;
    }

    const sourceSize = Math.max(1, Number(job.metrics?.sourceSizeBytes || 0));
    let progressFactor = 0;
    if (status === 'completed' || status === 'skipped') {
      progressFactor = 1;
    } else if (status === 'processing' || status === 'paused') {
      progressFactor = Math.min(1, Math.max(0, Number(job.metrics?.progressPercent || 0) / 100));
    }

    weightedSizeSum += sourceSize;
    weightedProgressSum += sourceSize * progressFactor;
  }

  if (weightedSizeSum > 0) {
    summary.overallProgressPercent = Number(((weightedProgressSum / weightedSizeSum) * 100).toFixed(2));
  }

  return summary;
}

function toClientJob(job) {
  const sourceSize = Number(job.metrics?.sourceSizeBytes || 0);
  const outputSize = Number(job.metrics?.currentSizeBytes || 0);
  const sizeDeltaBytes = sourceSize > 0 ? sourceSize - outputSize : null;
  const sizeSavedPercent = sourceSize > 0 ? Number((((sourceSize - outputSize) / sourceSize) * 100).toFixed(2)) : null;

  return {
    id: job.id,
    sourceFile: job.sourceFile,
    outputPath: job.outputPath,
    settings: job.settings,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    status: job.status,
    error: job.error,
    skipReason: job.skipReason,
    isHevcSource: Boolean(job.isHevcSource),
    videoCodec: job.videoCodec,
    audioCodec: job.audioCodec,
    suggestedQuality: job.suggestedQuality,
    metrics: job.metrics,
    sizeDeltaBytes,
    sizeSavedPercent
  };
}

function isProcessingJob(job) {
  return job.status === 'processing' && Boolean(job.process);
}

async function removeOutputFile(outputPath) {
  try {
    await fsp.unlink(outputPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    if (error && error.code === 'EBUSY') {
      return;
    }
  }
}

process.on('exit', () => {
  void replaceActivePreviewSession();
});

process.on('SIGINT', () => {
  void replaceActivePreviewSession();
  process.exit(0);
});

process.on('SIGTERM', () => {
  void replaceActivePreviewSession();
  process.exit(0);
});