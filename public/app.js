'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const ui = {
    consent: $('consent'), camera: $('start-camera'), demo: $('start-demo'), stop: $('stop'),
    status: $('status'), guidance: $('guidance'), pulse: $('pulse'), confidence: $('confidence'),
    packets: $('packets'), pulseNote: $('pulse-note'), waiting: $('waiting'), mode: $('mode-label'),
    time: $('session-time'), privacy: $('privacy-state'), privacyPill: document.querySelector('.privacy-pill'),
    liveDot: document.querySelector('.live-dot'), cameraPreview: $('camera-preview'), demoPreview: $('demo-preview'),
    frameCanvas: $('frame-canvas'), wave: $('wave'),
  };
  let ws;
  let active = false;
  let stream = null;
  let frameTimer = null;
  let timer = null;
  let startedAt = 0;
  let mode = null;
  let filePlaybackEnded = false;
  let completed = false;
  let arterialHistory = [];
  let lastArrival = 0;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'metrics') onMetrics(msg);
      else if (msg.type === 'status') onStatus(msg);
      else if (msg.type === 'validation') onValidation(msg);
      else if (msg.type === 'error') onError(msg);
      else if (msg.type === 'warning') ui.guidance.textContent = msg.message;
      else if (msg.type === 'hello' && msg.packets) onMetrics(msg);
    };
    ws.onclose = () => {
      if (active) ui.guidance.textContent = 'Local connection lost. Reconnecting; no session data has been sent elsewhere.';
      setTimeout(connect, 1200);
    };
  }

  function opened() {
    if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local WebSocket connection timed out')), 8000);
      ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Local WebSocket unavailable')); }, { once: true });
    });
  }

  function setConsentState() {
    ui.camera.disabled = !ui.consent.checked || active || completed;
    ui.demo.disabled = !ui.consent.checked || active || completed;
  }

  function formatTime(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }

  function onMetrics(msg) {
    lastArrival = performance.now();
    AuraGarden.setMetrics(msg);
    ui.packets.textContent = String(msg.packets || 0);
    ui.waiting.classList.add('hidden');
    ui.liveDot.classList.add('live');
    if (msg.pulse) {
      ui.pulse.textContent = msg.pulse.value.toFixed(1);
      ui.confidence.textContent = msg.pulse.confidence == null ? '—' : `${Math.round(msg.pulse.confidence)}%`;
      ui.pulseNote.textContent = `${msg.pulse.stable ? 'Stable' : 'Stabilizing'} · measured by SmartSpectra`;
    }
    if (msg.arterial) {
      const previous = arterialHistory.at(-1);
      if (!previous || previous.timestamp !== msg.arterial.timestamp) {
        arterialHistory.push(msg.arterial);
        if (arterialHistory.length > 100) arterialHistory = arterialHistory.slice(-100);
        const path = arterialHistory.map((sample, i) => {
          const x = i * 300 / Math.max(1, arterialHistory.length - 1);
          const y = Math.max(5, Math.min(67, 36 - sample.value * 180));
          return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(' ');
        ui.wave.setAttribute('d', path);
      }
    }
  }

  function onStatus(msg) {
    ui.status.textContent = (msg.name || 'Unknown').replace(/^k/, '');
    if (msg.name === 'kRunning') {
      ui.guidance.textContent = mode === 'file'
        ? 'Replaying the consented research clip through the real SDK. Values are measured, never scripted.'
        : 'Camera live. Sit still, face the lens and use soft, even light. No microphone is requested.';
    }
    if (msg.name === 'kIdle' && active && mode === 'file' && filePlaybackEnded) {
      active = false;
      completed = true;
      clearInterval(frameTimer);
      clearInterval(timer);
      ui.mode.textContent = 'REPLAY COMPLETE · SESSION DATA REMAINS IN THIS TAB';
      ui.guidance.textContent = 'Replay complete. End & erase to clear all metrics before another session.';
      setConsentState();
    }
  }

  function onValidation(msg) {
    if (!active) return;
    const label = (msg.name || '').replace(/^k/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    ui.guidance.textContent = msg.hint ? `${label}: ${msg.hint}` : label;
  }

  function onError(msg) {
    ui.status.textContent = 'Error';
    ui.guidance.textContent = `SmartSpectra ${msg.code}: ${msg.message}${msg.retryable ? ' You can stop and retry.' : ''}`;
  }

  async function post(path) {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function beginUI(nextMode) {
    active = true;
    mode = nextMode;
    filePlaybackEnded = false;
    completed = false;
    startedAt = Date.now();
    arterialHistory = [];
    ui.pulse.textContent = '—'; ui.confidence.textContent = '—'; ui.packets.textContent = '0';
    ui.wave.setAttribute('d', 'M0 36H300');
    ui.waiting.classList.remove('hidden');
    ui.stop.hidden = false;
    ui.mode.textContent = nextMode === 'file' ? 'RECORDED CAMERA CLIP · LIVE SDK PIPELINE' : 'LIVE CAMERA · ON-DEVICE PROCESSING';
    ui.privacy.textContent = nextMode === 'file' ? 'Recorded clip processing · memory only' : 'Camera on · memory only';
    ui.privacyPill.classList.add('active');
    ui.guidance.textContent = 'Starting SmartSpectra and authenticating the local session…';
    timer = setInterval(() => { ui.time.textContent = formatTime((Date.now() - startedAt) / 1000); }, 500);
    setConsentState();
  }

  async function startWithMode(nextMode) {
    beginUI(nextMode);
    try {
      await opened();
      const response = await fetch('/api/session/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: nextMode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (nextMode === 'file') {
        ui.demoPreview.hidden = false;
        ui.demoPreview.src = `/demo-video?t=${Date.now()}`;
        ui.demoPreview.currentTime = 0;
        await ui.demoPreview.play();
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 25, max: 30 } }, audio: false,
        });
        ui.cameraPreview.hidden = false;
        ui.cameraPreview.srcObject = stream;
        await ui.cameraPreview.play();
        pumpFrames();
      }
    } catch (error) {
      ui.guidance.textContent = error.message;
      ui.status.textContent = 'Start failed';
      await stopSession(false);
    }
  }

  function pumpFrames() {
    const ctx = ui.frameCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    frameTimer = setInterval(() => {
      if (!active || !stream || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 8_000_000) return;
      ctx.drawImage(ui.cameraPreview, 0, 0, 640, 360);
      const pixels = ctx.getImageData(0, 0, 640, 360).data;
      const packet = new Uint8Array(16 + pixels.length);
      const view = new DataView(packet.buffer);
      view.setUint32(0, 0x41555241, false);
      view.setUint16(4, 640, false); view.setUint16(6, 360, false);
      view.setBigUint64(8, BigInt(Math.round(performance.now() * 1000)), false);
      packet.set(pixels, 16);
      ws.send(packet);
    }, 40);
  }

  async function stopSession(erased = true) {
    active = false;
    completed = false;
    clearInterval(frameTimer); clearInterval(timer);
    frameTimer = null; timer = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    ui.cameraPreview.srcObject = null; ui.cameraPreview.hidden = true;
    ui.demoPreview.pause(); ui.demoPreview.removeAttribute('src'); ui.demoPreview.load(); ui.demoPreview.hidden = true;
    try { await post('/api/session/stop'); } catch {}
    ui.stop.hidden = true;
    ui.privacy.textContent = 'Camera off · nothing captured';
    ui.privacyPill.classList.remove('active');
    ui.liveDot.classList.remove('live');
    ui.time.textContent = '00:00';
    ui.mode.textContent = erased ? 'GARDEN IDLE · SESSION ERASED' : 'GARDEN IDLE';
    if (erased) {
      ui.pulse.textContent = '—'; ui.confidence.textContent = '—'; ui.packets.textContent = '0';
      ui.pulseNote.textContent = 'Needs ~12 seconds of clean video';
      ui.wave.setAttribute('d', 'M0 36H300');
      ui.waiting.classList.remove('hidden');
      ui.guidance.textContent = 'Session erased. Camera released; metrics and waveform cleared from this tab.';
      arterialHistory = [];
      AuraGarden.reset();
    }
    setConsentState();
  }

  ui.consent.addEventListener('change', setConsentState);
  ui.camera.addEventListener('click', () => startWithMode('camera'));
  ui.demo.addEventListener('click', () => startWithMode('file'));
  ui.stop.addEventListener('click', () => stopSession(true));
  ui.demoPreview.addEventListener('ended', () => {
    filePlaybackEnded = true;
    if (active && mode === 'file') {
      ui.guidance.textContent = 'Clip finished; waiting for the SDK to drain the final metrics…';
      if (ui.status.textContent === 'Idle') onStatus({ name: 'kIdle' });
    }
  });
  window.addEventListener('beforeunload', () => {
    if (stream) for (const track of stream.getTracks()) track.stop();
    if (active) navigator.sendBeacon('/api/session/stop', '{}');
  });

  connect();
})();
