'use strict';

// Run a recorded, consented camera clip through the real SmartSpectra SDK.
// Usage: SMARTSPECTRA_API_KEY=... node scripts/file-measurement.js test-assets/face.mp4 output.json

const fs = require('node:fs');
const path = require('node:path');
const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
} = require('@smartspectra/node-sdk');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const input = process.argv[2];
const output = process.argv[3] || 'measurement.json';
if (!input || !process.env.SMARTSPECTRA_API_KEY) {
  console.error('Usage: SMARTSPECTRA_API_KEY=... node scripts/file-measurement.js <clip.mp4> [output.json]');
  process.exit(2);
}

const statusNames = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k]));
const validationNames = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k]));
const report = {
  input: path.basename(input),
  sdkVersion: SmartSpectraSDK.version,
  startedAt: new Date().toISOString(),
  statuses: [],
  validation: {},
  hints: {},
  errors: [],
  metricPackets: 0,
  latest: null,
  signalSamples: [],
  accumulated: null,
};

const sdk = new SmartSpectraSDK({
  apiKey: process.env.SMARTSPECTRA_API_KEY,
  requestedMetrics: process.env.AURA_FACE === '1'
    ? [...breathingMetrics, ...cardioMetrics, ...faceMetrics]
    : [...breathingMetrics, ...cardioMetrics],
  enableAccumulatedOutput: true,
  enableTelemetry: false,
});

function simplify(metrics) {
  if (!metrics || Buffer.isBuffer(metrics)) return null;
  const last = (rows) => rows?.at(-1) || null;
  return {
    breathingRate: last(metrics.breathing?.rate),
    breathingTrace: last(metrics.breathing?.upperTrace),
    pulseRate: last(metrics.cardio?.pulseRate),
    arterialPressureTrace: last(metrics.cardio?.arterialPressureTrace),
    hrv: last(metrics.cardio?.hrv),
    expression: last(metrics.face?.expression),
    blinking: last(metrics.face?.blinking),
    talking: last(metrics.face?.talking),
  };
}

sdk.on('processingStatus', (status) => {
  report.statuses.push({ at: new Date().toISOString(), status, name: statusNames[status] });
  console.log('status', statusNames[status] || status);
});
sdk.on('validationStatus', (code, _ts, hint) => {
  const name = validationNames[code] || String(code);
  report.validation[name] = (report.validation[name] || 0) + 1;
  if (hint) report.hints[hint] = (report.hints[hint] || 0) + 1;
});
sdk.on('metrics', (buf) => {
  report.metricPackets += 1;
  try {
    report.latest = simplify(decodeMetrics(buf));
    if (report.latest && (report.latest.pulseRate || report.latest.breathingRate || report.latest.breathingTrace)) {
      report.signalSamples.push(report.latest);
    }
    if (report.metricPackets % 30 === 0) console.log('metric packets', report.metricPackets);
  } catch (error) {
    report.errors.push({ stage: 'decode', message: error.message });
  }
});
sdk.on('accumulatedMetrics', (buf) => {
  try { report.accumulated = simplify(decodeMetrics(buf)); } catch (error) {
    report.errors.push({ stage: 'decodeAccumulated', message: error.message });
  }
});
sdk.on('error', (code, message, retryable) => {
  report.errors.push({ code, message, retryable });
  console.error('SDK error', code, message, 'retryable=', retryable);
});

async function main() {
  sdk.useFile(path.resolve(input), { interframeDelayMs: 33 });
  sdk.start();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (sdk.processingStatus === ProcessingStatus.kIdle || sdk.processingStatus === ProcessingStatus.kError) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (sdk.processingStatus !== ProcessingStatus.kIdle && sdk.processingStatus !== ProcessingStatus.kError) {
    await sdk.stopAsync();
  }
  await sdk.destroy();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    output,
    metricPackets: report.metricPackets,
    signalSampleCount: report.signalSamples.length,
    latest: report.latest,
    errors: report.errors,
    validation: report.validation,
  }, null, 2));
  if (report.errors.length || report.metricPackets === 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  try { await sdk.destroy(); } catch {}
  process.exit(1);
});
