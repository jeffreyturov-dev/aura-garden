'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MetricsState, gardenParameters, cleanSample, toNumber } = require('../lib/metrics');

test('cleanSample preserves real values and Long-like timestamps', () => {
  const sample = cleanSample({ value: 80.1, confidence: 53, stable: true, timestamp: { toNumber: () => 123456 } });
  assert.deepEqual(sample, { value: 80.1, confidence: 53, stable: true, timestamp: 123456 });
  assert.equal(toNumber('42'), 42);
  assert.equal(cleanSample(null), null);
});

test('MetricsState ingests real SmartSpectra payload shape without inventing missing metrics', () => {
  const state = new MetricsState();
  state.ingest({ cardio: { arterialPressureTrace: [{ value: -0.08, confidence: 53, stable: true, timestamp: '500' }] } });
  assert.equal(state.packets, 1);
  assert.equal(state.latest.arterial.value, -0.08);
  assert.equal(state.latest.pulse, null);
  assert.equal(state.latest.breathing, null);
  state.ingest({ cardio: { pulseRate: [{ value: 80.1, confidence: 53, stable: true, timestamp: '600' }] } });
  assert.equal(state.latest.pulse.value, 80.1);
  assert.equal(state.latest.arterial.value, -0.08, 'last real waveform is preserved across windowed packets');
  state.reset();
  assert.equal(state.packets, 0);
  assert.equal(state.latest.pulse, null);
  assert.equal(state.firstSignalAt, null);
});

test('garden responds to pulse relative to baseline and clamps visual output', () => {
  const metrics = { pulse: { value: 90, confidence: 70 }, arterial: { value: 0.1 }, breathingTrace: null };
  const p = gardenParameters(metrics, 70);
  assert.equal(p.pulse, 90);
  assert.equal(p.hue, 345, 'positive delta is clamped to the warm end of the palette');
  assert.ok(p.energy > 0.45);
  assert.ok(p.bloom > 1);
  const extreme = gardenParameters({ pulse: { value: 200, confidence: 90 }, arterial: { value: 100 } }, 70);
  assert.equal(extreme.hue, 345);
  assert.equal(extreme.energy, 1.5);
});

test('UI starts no camera or SDK before explicit consent and has no third-party assets', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /type="checkbox" id="consent"/);
  assert.match(html, /id="start-camera" class="primary" disabled/);
  assert.match(html, /id="start-demo" class="secondary" disabled/);
  assert.doesNotMatch(html, /https:\/\/fonts|<script[^>]+src="https:/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /audio: false/);
  assert.match(app, /End session|stopSession/);
});
