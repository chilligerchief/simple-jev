import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../docs.html', import.meta.url), 'utf8');

test('API beta pricing lists all eight models in the requested order', () => {
  const pricing = html.split('<h3>Beta pricing</h3>')[1].split('</table>')[0];
  const rows = [...pricing.matchAll(/<tr>\s*<td>\s*<code>([^<]+)<\/code>\s*<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g)]
    .map(([, model, price, vision]) => [model, price, vision]);
  assert.deepEqual(rows, [
    ['featherless-ai/Qwen3.6-35B-A3B-classifier', '$0.28', 'Supported'],
    ['featherless-ai/Qwen3.8-27B-classifier', '$0.30', 'Supported'],
    ['featherless-ai/Qwen3.5-4B-classifier', '$0.03', 'Supported'],
    ['featherless-ai/gemma-4-26B-A4B-classifier', '$0.28', 'Supported'],
    ['featherless-ai/gemma-4-12B-it-classifier', '$0.24', 'Supported'],
    ['featherless-ai/RWKV-std-classifier', '$0.20', 'Text only'],
    ['featherless-ai/RWKV-mid-classifier', '$0.10', 'Text only'],
    ['featherless-ai/RWKV-small-classifier', '$0.03', 'Text only'],
  ]);
  assert.match(pricing, /Input token price \(per million\)/);
  const experimental = pricing.split('scope="rowgroup">Experimental</th>')[1];
  assert.equal([...experimental.matchAll(/<code>/g)].length, 3);
  assert.doesNotMatch(experimental, /Qwen|gemma/);
});
