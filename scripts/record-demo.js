'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const output = path.resolve(process.argv[2] || 'test-artifacts/demo');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    recordVideo: { dir: output, size: { width: 1440, height: 1100 } },
  });
  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));
  const samples = [];
  await page.goto('http://127.0.0.1:8894/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  if (await page.locator('#start-demo').isEnabled()) throw new Error('Demo started enabled before consent');
  await page.screenshot({ path: path.join(output, '00-consent.png'), fullPage: true });
  await page.locator('#consent').check();
  await page.locator('#start-demo').click();
  const start = Date.now();
  for (let second = 0; second <= 62; second += 2) {
    const sample = await page.evaluate(() => ({
      status: document.querySelector('#status').textContent,
      pulse: document.querySelector('#pulse').textContent,
      confidence: document.querySelector('#confidence').textContent,
      packets: document.querySelector('#packets').textContent,
      guidance: document.querySelector('#guidance').textContent,
      mode: document.querySelector('#mode-label').textContent,
      waitingHidden: document.querySelector('#waiting').classList.contains('hidden'),
    }));
    samples.push({ elapsedSeconds: (Date.now() - start) / 1000, ...sample });
    console.log(JSON.stringify(samples.at(-1)));
    if (second === 20 || second === 44) {
      await page.screenshot({ path: path.join(output, `${second}-live.png`), fullPage: true });
    }
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: path.join(output, '99-final.png'), fullPage: true });
  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  await browser.close();
  const result = { samples, consoleMessages, videoPath };
  fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify(result, null, 2));
  fs.copyFileSync(videoPath, path.join(output, 'aura-demo.webm'));
  const successfulPackets = samples.some((s) => Number(s.packets) > 100);
  const realPulse = samples.some((s) => Number.isFinite(Number(s.pulse)) && Number(s.pulse) > 0);
  console.log(JSON.stringify({ videoPath, successfulPackets, realPulse, consoleMessages }, null, 2));
  if (!successfulPackets || !realPulse) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exit(1); });
