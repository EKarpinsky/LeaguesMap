import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function settled(page: Page) {
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
  await page.evaluate(() => document.fonts.ready);
  await pause(800); // Allow Leaflet's pan and zoom transitions to finish.
  const changelog = page.getByRole('button', { name: 'Got it', exact: true });
  if (await changelog.isVisible()) await changelog.click();
}

async function openFilters(page: Page) {
  const toggle = page.locator('.filters-region .accordion-head');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const tasks = page.locator('.tasks-region .accordion-head');
  if (await tasks.getAttribute('aria-expanded') === 'true') await tasks.click();
}

async function chooseRegion(page: Page) {
  const region = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Region', exact: true }) });
  await region.getByRole('button', { name: 'None', exact: true }).click();
  assert.equal(await page.locator('.osrs-pin').count(), 0, 'Clearing regions must remove pins');
  await pause(400);
  await page.locator('.rtile.region-varlamore').click();
  await page.waitForFunction(() => document.querySelectorAll('.osrs-pin').length > 0);
  assert.equal(await page.locator('.rtile[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.rtile.region-varlamore').getAttribute('aria-pressed'), 'true');
}

async function clickVisiblePin(page: Page) {
  // Use a real, unobstructed marker near the map center, without reaching into
  // Leaflet or React state. This stays usable when task coordinates change.
  const point = await page.locator('.osrs-pin').evaluateAll(pins => {
    const map = document.querySelector('.map-root')!.getBoundingClientRect();
    return pins.map(pin => {
      const rect = pin.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return { x, y, visible: pin.contains(document.elementFromPoint(x, y)),
        distance: Math.hypot(x - (map.x + map.width * 0.55), y - map.height * 0.6) };
    }).filter(pin => pin.visible && pin.y > 250 && pin.y < map.bottom - 150)
      .sort((a, b) => a.distance - b.distance)[0];
  });
  assert.ok(point, 'Expected a visible, clickable task pin');
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await pause(300);
  await page.mouse.click(point.x, point.y);
  await page.locator('.pin-popup').waitFor();
  await settled(page);
}

async function screenshot(page: Page, file: string) {
  await settled(page);
  const raw = await page.screenshot({ animations: 'disabled' });
  await sharp(raw).png({ palette: true, colours: 256, dither: 0.5 }).toFile(file);
  assert.ok((await stat(file)).size < 1_000_000, `${file} exceeds 1 MB`);
}

async function recordGif(page: Page, scratch: string, output: string) {
  const frames: { file: string; time: number }[] = [];
  let recording = true;
  const started = performance.now();
  const capture = (async () => {
    while (recording) {
      const file = `frame-${String(frames.length).padStart(4, '0')}.jpg`;
      const time = (performance.now() - started) / 1000;
      await page.screenshot({ path: join(scratch, file), type: 'jpeg', quality: 85 });
      frames.push({ file, time });
      await pause(100);
    }
  })();
  let taskId: string;
  let taskName: string;
  let location: string;
  try {
    await pause(700);
    await chooseRegion(page);
    await pause(900);
    await clickVisiblePin(page);
    location = await page.locator('.pin-popup-name').innerText();
    const row = page.locator('.pin-popup .task-line').first();
    taskId = (await row.getAttribute('data-task-id'))!;
    taskName = await row.locator('.task-name').innerText();
    await pause(900);
    await row.locator('.task-line-check').click();
    await page.waitForFunction(id => {
      const progress = JSON.parse(localStorage.getItem('lm.completed.v1') || '{}');
      return progress.completed?.includes(id);
    }, taskId);
    assert.ok(await page.locator(`.pin-popup [data-task-id="${taskId}"] input`).isChecked());
    await pause(1700);
  } finally {
    recording = false;
    await capture;
  }
  const duration = (performance.now() - started) / 1000;
  assert.ok(duration < 14.5, `Demo took ${duration.toFixed(2)}s; retry on a quieter machine`);
  const concat = frames.map((frame, i) =>
    `file '${frame.file}'\nduration ${((frames[i + 1]?.time ?? duration) - frame.time).toFixed(3)}`
  ).join('\n') + `\nfile '${frames.at(-1)!.file}'\n`;
  await writeFile(join(scratch, 'frames.txt'), concat);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-filter_complex_threads', '1', '-f', 'concat', '-safe', '0',
    '-i', join(scratch, 'frames.txt'), '-filter_complex',
    'fps=10,scale=1120:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', output]);
  assert.ok((await stat(output)).size < 5_000_000, 'GIF exceeds 5 MB');
  const gifDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', output], { encoding: 'utf8' }).trim());
  assert.ok(gifDuration < 15, 'GIF must be shorter than 15 seconds');
  await page.reload();
  await settled(page);
  assert.ok(await page.evaluate(id => JSON.parse(localStorage.getItem('lm.completed.v1')!).completed.includes(id), taskId));
  assert.equal(await page.locator('.rtile.region-varlamore').getAttribute('aria-pressed'), 'true');
  return { location, taskId, taskName, gifDuration, frames: frames.length, completionSurvivesReload: true };
}

export async function captureDemo() {
  const { values } = parseArgs({ options: {
    url: { type: 'string', default: 'http://127.0.0.1:4173' },
    'artifacts-dir': { type: 'string' },
  } });
  const docs = resolve('docs');
  await mkdir(docs, { recursive: true });
  const scratch = await mkdtemp(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), 'leaguesmap-capture-'));
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const filenames = ['screenshot.png', 'desktop-1440.png', 'mobile-390.png', 'mobile-filters-390.png', 'demo.gif'];
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(values.url!, { waitUntil: 'networkidle' });
    await settled(page);
    await openFilters(page);
    const initialPins = await page.locator('.osrs-pin').count();
    await chooseRegion(page);
    const filteredPins = await page.locator('.osrs-pin').count();
    assert.ok(filteredPins > 0 && filteredPins < initialPins);
    await screenshot(page, join(docs, 'screenshot.png'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot(page, join(docs, 'desktop-1440.png'));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); // Apply the app's normal mobile initial state.
    await screenshot(page, join(docs, 'mobile-390.png'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'Mobile layout overflows');
    await openFilters(page);
    await page.locator('.rtile.region-varlamore').scrollIntoViewIfNeeded();
    await screenshot(page, join(docs, 'mobile-filters-390.png'));

    // New context gives the recording a clean visitor profile, with no seeded
    // progress or synthetic task data. Every change happens through the UI.
    await context.close();
    const demoContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    demoContext.setDefaultTimeout(15_000);
    const demo = await demoContext.newPage();
    demo.on('pageerror', error => errors.push(error.message));
    demo.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await demo.goto(values.url!, { waitUntil: 'networkidle' });
    await settled(demo);
    await openFilters(demo);
    const interaction = await recordGif(demo, scratch, join(docs, 'demo.gif'));
    assert.deepEqual(errors, [], 'Browser errors or failed requests');
    const report = { url: values.url,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      browser: browser.version(), initialPins, filteredPins, ...interaction, errors,
      assets: await Promise.all(filenames.map(async file => ({ file, bytes: (await stat(join(docs, file))).size }))) };
    await writeFile(join(docs, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
    if (values['artifacts-dir']) {
      const artifacts = resolve(values['artifacts-dir']);
      await mkdir(artifacts, { recursive: true });
      for (const file of [...filenames, 'capture-report.json']) await copyFile(join(docs, file), join(artifacts, file));
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
