'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  PixelFormat,
  FrameTransform,
  breathingMetrics,
  cardioMetrics,
} = require('@smartspectra/node-sdk');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { MetricsState } = require('./lib/metrics');

const PORT = Number(process.env.PORT || 8894);
const API_KEY = process.env.SMARTSPECTRA_API_KEY;
const DEMO_FILE = path.resolve(process.env.AURA_DEMO_FILE || path.join(__dirname, 'test-assets/ucla-avatar-1.mp4'));
const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const statusNames = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k]));
const validationNames = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k]));
let sdk = null;
let metricsState = new MetricsState();
let mode = null;
let starting = false;

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, sdkVersion: SmartSpectraSDK.version, active: Boolean(sdk), mode, packets: metricsState.packets });
});
app.get('/demo-video', (_req, res) => {
  res.sendFile(DEMO_FILE, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Recorded demo clip not found. See README setup.' });
  });
});

app.post('/api/session/start', async (req, res) => {
  const requestedMode = req.body?.mode;
  if (!['camera', 'file'].includes(requestedMode)) return res.status(400).json({ error: 'mode must be camera or file' });
  if (!API_KEY) return res.status(503).json({ error: 'SMARTSPECTRA_API_KEY is not configured on the local server' });
  if (sdk || starting) return res.status(409).json({ error: 'A measurement is already active' });
  starting = true;
  metricsState = new MetricsState();
  mode = requestedMode;
  try {
    sdk = new SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics],
      enableAccumulatedOutput: true,
      enableTelemetry: false,
    });
    sdk.on('processingStatus', (status) => {
      broadcast({ type: 'status', status, name: statusNames[status] || String(status), mode });
    });
    sdk.on('validationStatus', (code, timestampUs, hint) => {
      broadcast({ type: 'validation', code, name: validationNames[code] || String(code), hint: hint || '', timestampUs });
    });
    sdk.on('metrics', (buf, timestampUs) => {
      try {
        const state = metricsState.ingest(decodeMetrics(buf));
        broadcast({ type: 'metrics', timestampUs: Number(timestampUs), ...state });
      } catch (error) {
        broadcast({ type: 'warning', message: `A metrics packet could not be decoded: ${error.message}` });
      }
    });
    sdk.on('accumulatedMetrics', (buf) => {
      try {
        const state = metricsState.ingest(decodeMetrics(buf));
        broadcast({ type: 'metrics', accumulated: true, ...state });
      } catch {}
    });
    sdk.on('error', (code, message, retryable) => {
      broadcast({ type: 'error', code, message, retryable });
    });

    if (requestedMode === 'file') {
      sdk.useFile(DEMO_FILE, { interframeDelayMs: 33 });
    } else {
      sdk.useCustomInput(FrameTransform.kNone);
    }
    sdk.start();
    broadcast({ type: 'status', status: ProcessingStatus.kStarting, name: 'kStarting', mode });
    res.json({ ok: true, mode });
  } catch (error) {
    broadcast({ type: 'error', code: error.code ?? 'JS', message: error.message, retryable: false });
    try { if (sdk) await sdk.destroy(); } catch {}
    sdk = null;
    mode = null;
    res.status(500).json({ error: error.message });
  } finally {
    starting = false;
  }
});

app.post('/api/session/stop', async (_req, res) => {
  const current = sdk;
  sdk = null;
  mode = null;
  if (current) {
    try { await current.stopAsync(); } catch {}
    try { await current.destroy(); } catch {}
  }
  metricsState = new MetricsState();
  broadcast({ type: 'status', status: ProcessingStatus.kIdle, name: 'kIdle', mode: null });
  res.json({ ok: true, erased: true });
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', active: Boolean(sdk), mode, ...metricsState.snapshot() }));
  ws.on('message', (data, isBinary) => {
    if (!isBinary || !sdk || mode !== 'camera') return;
    // 16-byte header: AURA magic, RGBA width/height, monotonic capture timestamp in microseconds.
    if (data.length < 16 || data.readUInt32BE(0) !== 0x41555241) return;
    const width = data.readUInt16BE(4);
    const height = data.readUInt16BE(6);
    const timestampUs = Number(data.readBigUInt64BE(8));
    const pixels = data.subarray(16);
    if (width < 1 || height < 1 || pixels.length !== width * height * 4) return;
    try {
      sdk.sendFrame(pixels, width, height, width * 4, PixelFormat.kRGBA, timestampUs);
    } catch (error) {
      ws.send(JSON.stringify({ type: 'warning', message: `Frame rejected: ${error.message}` }));
    }
  });
});

async function shutdown() {
  const current = sdk;
  sdk = null;
  if (current) {
    try { await current.stopAsync(); } catch {}
    try { await current.destroy(); } catch {}
  }
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`Aura is ready at http://${HOST}:${PORT}`);
  console.log(`SmartSpectra SDK ${SmartSpectraSDK.version}; telemetry opt-out enabled`);
});
