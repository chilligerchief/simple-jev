// Optional browser integration checks (not part of the dependency-free node:test suite).
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node website/tests/evaluations.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Invalid path');
    const body = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'text/plain' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${url}/evaluations.html`);
  await page.waitForSelector('#leaderboard tr');
  assert.equal(await page.locator('#leaderboard tr').count(), 6);
  const jevRow = page.locator('#leaderboard .reference-row');
  assert.match(await jevRow.innerText(), /200 — 86.58%/);
  assert.doesNotMatch(await jevRow.innerText(), /published/i);
  assert.match(await jevRow.innerText(), /Native/);
  assert.equal(await page.locator('#leaderboard .winner-row').count(), 3);
  assert.equal(await page.locator('#leaderboard .comparison-win').count(), 6);
  assert.equal(await page.locator('#leaderboard .comparison-loss').count(), 4);
  assert.equal(await jevRow.locator('.comparison-baseline').count(), 2);
  assert.equal(await jevRow.locator('.comparison-win').count(), 0);
  assert.equal(await jevRow.locator('.score-fill').first().evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(133, 140, 134)');
  assert.equal(await page.locator('#leaderboard .comparison-win .score-fill').first().evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(57, 130, 47)');
  assert.equal(requests.some(r => r.includes('public-examples.json')), false, 'Public examples must load lazily');
  await page.click('[data-sort="decisionScore"]');
  assert.equal(await page.locator('#decision-heading').getAttribute('aria-sort'), 'descending');
  assert.equal(await page.locator('#public-heading').getAttribute('aria-sort'), 'none');
  await page.click('[data-sort="visionScore"]');
  assert.match(await page.locator('#leaderboard tr').first().innerText(), /Qwen3.6-35B-A3B/);
  assert.equal(await jevRow.locator('td').first().innerText(), '—');
  assert.equal(await jevRow.locator('td').last().innerText(), '—\nNot evaluated');
  assert.equal(await page.locator('#leaderboard .vision-leader-row').count(), 1);
  await page.click('[data-sort="decisionScore"]');
  await page.screenshot({ path: '/tmp/simple-jev-evaluations-desktop.png', fullPage: true });
  await page.click('a[href="#public-set"]');
  await page.waitForSelector('#public-example tbody tr');
  assert.equal(await page.locator('#example-id option').count(), 231);
  assert.equal(await page.locator('#public-example tbody tr').count(), 6);
  await page.selectOption('#public-dimension', 'family');
  assert.equal(await page.locator('#public-breakdown tbody tr').count(), 18);
  assert.equal(await page.locator('#public-breakdown .comparison-baseline').count(), 18);
  assert.ok(await page.locator('#public-breakdown .comparison-win').count() > 0);
  assert.ok(await page.locator('#public-breakdown .comparison-loss').count() > 0);
  assert.ok(await page.locator('#public-breakdown .comparison-tie').count() > 0);
  assert.match(await page.locator('#public-breakdown thead th').nth(1).innerText(), /Jev.*baseline/);
  assert.equal(await page.locator('#public-example .comparison-baseline').count(), 1);
  await page.selectOption('#example-tier', 'easy');
  await page.selectOption('#example-type', 'score');
  assert.equal(await page.locator('#example-id option').count(), 0);
  assert.equal(await page.locator('#next-example').isDisabled(), true);
  await page.selectOption('#example-tier', 'hard');
  await page.selectOption('#example-type', 'noul');
  await page.selectOption('#example-outcome', 'miss');
  assert.ok(await page.locator('#example-id option').count() > 0);
  const previous = await page.locator('#example-id').inputValue();
  await page.click('#next-example');
  assert.notEqual(await page.locator('#example-id').inputValue(), previous);
  await page.click('#previous-example');
  assert.equal(await page.locator('#example-id').inputValue(), previous);
  await page.click('#public-example details summary');
  assert.equal(await page.locator('#public-example details').getAttribute('open'), '');

  await page.click('a[href="#decision-set"]');
  assert.equal(await page.locator('#decision-items > details').count(), 26);
  await page.selectOption('#decision-category', 'legal');
  assert.equal(await page.locator('#decision-items > details').count(), 3);
  await page.fill('#decision-search', 'contract');
  assert.equal(await page.locator('#decision-items > details').count(), 1);
  await page.locator('#decision-items > details > summary').click();
  assert.equal(await page.locator('#decision-items tbody tr').count(), 6);
  assert.equal(await page.locator('#decision-items .comparison-baseline').count(), 1);
  assert.equal(await page.locator('#decision-items .comparison-label').count(), 6);
  assert.equal(await page.locator('#category-breakdown .comparison-baseline').count(), 6);
  assert.ok(await page.locator('#category-breakdown .comparison-win').count() > 0);
  assert.match(await page.locator('#decision-items').innerText(), /Dataset gold answer/);
  await page.fill('#decision-search', 'not-a-benchmark');
  assert.equal(await page.locator('#decision-items > details').count(), 0);
  await page.fill('#decision-search', '');

  await page.click('a[href="#vision-set"]');
  assert.equal(await page.locator('#vision-breakdown tbody tr').count(), 7);
  assert.equal(await page.locator('#vision-items > details').count(), 7);
  assert.equal(await page.locator('#vision-items .comparison-win, #vision-items .comparison-loss').count(), 0);
  await page.locator('#vision-items > details > summary').first().click();
  await page.locator('#vision-items img').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const image = document.querySelector('#vision-items img'); return image.complete && image.naturalWidth > 0; });
  assert.equal(await page.locator('#vision-items > details').first().locator('tbody tr').count(), 6);
  await page.locator('#vision-items > details > summary').nth(2).click();
  assert.match(await page.locator('#vision-items > details').nth(2).innerText(), /Native MME \/ 2,000/);

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${url}/evaluations.html#decision-set`);
    await page.waitForSelector('#leaderboard tr');
    assert.ok(await page.locator('#decision-set').evaluate(e => e.open));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow at ${width}px`);
  }
  await page.goto(`${url}/evaluations.html`);
  await page.waitForSelector('#leaderboard tr');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/simple-jev-evaluations-mobile.png', fullPage: true });
  await page.locator('#public-set > summary').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#public-example tbody tr');
  assert.ok(await page.locator('#public-set').evaluate(e => e.open));

  // Errors are explicit and retryable; no made-up success state.
  const failed = await browser.newPage();
  await failed.route('**/results.json', route => route.abort(), { times: 1 });
  await failed.goto(`${url}/evaluations.html`);
  await failed.waitForSelector('#load-status button');
  assert.equal(await failed.locator('#leaderboard tr').count(), 0);
  await failed.click('#load-status button');
  await failed.waitForSelector('#leaderboard tr');
  await failed.route('**/public-examples.json', route => route.abort(), { times: 1 });
  await failed.click('#public-set > summary');
  await failed.waitForSelector('#examples-status button');
  await failed.click('#examples-status button');
  await failed.waitForSelector('#public-example tbody tr');

  // Dataset strings are text, not active HTML, even inside hidden disclosures.
  const malicious = await browser.newPage();
  await malicious.route('**/public-examples.json', async route => {
    const response = await route.fetch(); const rows = await response.json();
    rows[0].state = '<img src=x onerror="window.injected=true">';
    rows[0].question.instructions = '<script>window.injected=true</script>';
    await route.fulfill({ json: rows });
  });
  await malicious.goto(`${url}/evaluations.html#public-set`);
  await malicious.waitForSelector('#public-example tbody tr');
  assert.equal(await malicious.locator('#public-example img, #public-example script').count(), 0);
  assert.equal(await malicious.evaluate(() => window.injected), undefined);
  assert.match(await malicious.locator('#public-example').textContent(), /<script>/);
  assert.deepEqual(errors, []);
  assert.ok(requests.every(r => r.startsWith(url)), 'No external / inference calls');
  console.log('Browser checks passed: desktop/mobile, sorting, disclosures, filters, all outcomes, empty states, retries, deep links, keyboard and inert dataset text.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
