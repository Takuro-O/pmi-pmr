// 問題バンクの検査。使い方: node tools/validate-bank.mjs <分野ID>
// 手本（アプリ内）と同じ基準：形・topic の固定リスト・旧名称・重複（2-gram Jaccard 0.55 以上）。
// それに加えて、正解位置の偏り・正解だけ長い問題・同じ正解の重複も見る。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const field = process.argv[2];
if (!field) { console.error('使い方: node tools/validate-bank.mjs <分野ID>'); process.exit(2); }
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'bank', field + '.json'), 'utf8'));

// index.html から、分野の topic リストと旧名称の正規表現を取り出す
const fm = html.match(new RegExp(`id: '${field}',[\\s\\S]*?topics: (\\[[^\\]]*\\])`));
if (!fm) { console.error('index.html に ' + field + ' が見つかりません'); process.exit(2); }
const topics = new Function('return ' + fm[1])();
const om = html.match(/const OLD_NAME_RE = \/(.+)\/([a-z]*);/);
const oldRe = new RegExp(om[1], om[2]);

const grams = (q, ch) => {
  const t = (String(q) + ch.join('')).normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
  const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g;
};
const jac = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

const errs = [], warns = [];
const qs = bank.questions;
const G = qs.map(q => grams(q.q, q.choices));
qs.forEach((q, i) => {
  const id = `#${i + 1}`;
  if (typeof q.q !== 'string' || q.q.length < 10) errs.push(id + ' 問題文が不正');
  if (!Array.isArray(q.choices) || q.choices.length !== 4 || new Set(q.choices.map(c => c.normalize('NFKC').trim())).size !== 4) errs.push(id + ' 選択肢が4つの異なる文字列ではない');
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errs.push(id + ' answer が不正');
  if (!q.explanation || q.explanation.length < 30) errs.push(id + ' 解説が短い');
  if (!topics.includes(q.topic)) errs.push(id + ` topic が固定リストにない: ${q.topic}`);
  if (typeof q.volatile !== 'boolean') errs.push(id + ' volatile が boolean ではない');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.createdAt || '')) errs.push(id + ' createdAt が不正');
  if (oldRe.test(q.q) || q.choices.some(c => oldRe.test(c))) errs.push(id + ' 問題文・選択肢に旧名称がある');
  if (/すべて正しい|該当なし|上記のいずれも/.test(q.choices.join(''))) errs.push(id + ' 「すべて正しい」系の選択肢がある');
  if (/^\s*([A-DＡ-Ｄ][.．)）:：]|[ア-エ][.．)）:：])/.test(q.choices.join('\n'))) errs.push(id + ' 選択肢の先頭に記号がある');
  const lens = q.choices.map(c => c.length), max = Math.max(...lens);
  if (lens[q.answer] === max && lens.filter(l => l === max).length === 1 && max > 1.4 * (lens.reduce((a, b) => a + b) - max) / 3) warns.push(id + ' 正解だけ明らかに長い');
  for (let j = 0; j < i; j++) { const s = jac(G[i], G[j]); if (s >= 0.55) errs.push(`${id} が #${j + 1} と重複（類似度 ${s.toFixed(2)}）`); else if (s >= 0.4) warns.push(`${id} と #${j + 1} がやや近い（${s.toFixed(2)}）`); }
});
const ans = qs.map(q => q.choices[q.answer].normalize('NFKC'));
ans.forEach((a, i) => { const j = ans.indexOf(a); if (j !== i) errs.push(`#${i + 1} の正解が #${j + 1} と同じ`); });
const pos = [0, 0, 0, 0]; qs.forEach(q => pos[q.answer]++);
if (qs.length >= 8 && Math.max(...pos) > Math.ceil(qs.length * 0.4)) warns.push('正解位置が偏っている: ' + pos.join('/'));
const tc = {}; qs.forEach(q => tc[q.topic] = (tc[q.topic] || 0) + 1);

console.log(`${field}: ${qs.length}問 / 正解位置 A-D = ${pos.join('/')} / topic ${Object.keys(tc).length}種`);
warns.forEach(w => console.log('注意: ' + w));
errs.forEach(e => console.log('NG: ' + e));
console.log(errs.length ? `→ NG ${errs.length}件` : '→ OK');
process.exit(errs.length ? 1 : 0);
