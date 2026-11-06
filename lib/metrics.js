'use strict';

function toNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (typeof value.toNumber === 'function') return value.toNumber();
  return Number(value);
}

function cleanSample(sample) {
  if (!sample || sample.value == null) return null;
  return {
    value: Number(sample.value),
    confidence: sample.confidence == null ? null : Number(sample.confidence),
    stable: sample.stable === true,
    timestamp: toNumber(sample.timestamp),
  };
}

class MetricsState {
  constructor() { this.reset(); }

  reset() {
    this.latest = {
      pulse: null,
      breathing: null,
      breathingTrace: null,
      arterial: null,
      hrv: null,
    };
    this.packets = 0;
    this.firstSignalAt = null;
  }

  ingest(metrics) {
    if (!metrics || Buffer.isBuffer(metrics)) return null;
    this.packets += 1;
    const fields = {
      pulse: metrics.cardio?.pulseRate?.at(-1),
      breathing: metrics.breathing?.rate?.at(-1),
      breathingTrace: metrics.breathing?.upperTrace?.at(-1),
      arterial: metrics.cardio?.arterialPressureTrace?.at(-1),
      hrv: metrics.cardio?.hrv?.at(-1),
    };
    for (const [name, raw] of Object.entries(fields)) {
      const sample = name === 'hrv'
        ? (raw ? { ...raw, value: raw.rmssd, timestamp: raw.timestamp } : null)
        : raw;
      const cleaned = cleanSample(sample);
      if (cleaned) {
        if (name === 'hrv') cleaned.rmssd = Number(raw.rmssd);
        this.latest[name] = cleaned;
      }
    }
    if (this.firstSignalAt === null && (this.latest.pulse || this.latest.arterial || this.latest.breathingTrace)) {
      this.firstSignalAt = Date.now();
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      packets: this.packets,
      firstSignalAt: this.firstSignalAt,
      ...this.latest,
    };
  }
}

function gardenParameters(metrics, baselinePulse = null) {
  const pulse = metrics?.pulse?.value ?? null;
  const confidence = metrics?.pulse?.confidence ?? 0;
  const arterial = metrics?.arterial?.value ?? 0;
  const breath = metrics?.breathingTrace?.value ?? 0;
  const reference = baselinePulse ?? pulse ?? 70;
  const delta = pulse == null ? 0 : Math.max(-25, Math.min(25, pulse - reference));
  return {
    pulse,
    confidence,
    energy: Math.max(0.15, Math.min(1.5, 0.45 + Math.abs(arterial) * 2.4 + Math.abs(breath) * 0.4)),
    hue: Math.max(195, Math.min(345, 285 + delta * 3.2)),
    sway: Math.max(-0.45, Math.min(0.45, arterial * 1.6)),
    bloom: Math.max(0.65, Math.min(1.4, 0.95 + delta / 50)),
  };
}

module.exports = { MetricsState, gardenParameters, cleanSample, toNumber };
