// 問題バンク生成: アプリ本体(index.html)の出題処理(生成→重複除去→検算)をそのまま使い、
// 結果を bank/<分野ID>.json に追記する。
// 使い方: GEMINI_API_KEY=... node tools/generate-bank.mjs <分野ID> [目標問数=50]
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 既存のバンクを「過去に解いた履歴」としてアプリに渡し、重複除去とテーマの偏り防止を効かせる
function seedHistory(field, questions) {
  const history = [];
  for (let i = 0; i < questions.length && history.length < 20; i += 25) {
    const qs = questions.slice(i, i + 25).map(q => ({ ...q, userAnswer: q.answer, isRight: true }));
    history.push({
      id: 'bank' + i, date: new Date().toISOString(), field, fieldName: '', fieldIcon: '',
      count: qs.length, correct: qs.length, questions: qs,
    });
  }
  return { history, totalAnswered: 0, totalCorrect: 0 };
}

async function runBatch({ html, apiKey, fetchImpl, field, count, existing, timeoutMs }) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://bank.local/', pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('pmi_gemini_key', apiKey); // アプリ本体と同じキー名（PMI PMR 専用）
      w.localStorage.setItem('pmi_live', '1');
      w.localStorage.setItem('pmi_verify', '1');
      w.localStorage.setItem('pmi_quiz_v1', JSON.stringify(seedHistory(field, existing)));
      w.fetch = fetchImpl;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
      w.Element.prototype.scrollIntoView = () => {};
    },
  });
  const w = dom.window, d = w.document;
  try {
    await sleep(50);
    w.openConfig(field);
    w.selectCount(count);
    d.getElementById('start-btn').click();
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(250);
      const toast = [...d.querySelectorAll('[role=alert]')].map(e => e.textContent).join('|');
      const prog = w.localStorage.getItem('pmi_quiz_progress_v1');
      if (prog) {
        // 検算に失敗した問題はバンクに入れない（混雑などは待てば戻るので、失敗として再試行する）
        if (/検算できませんでした/.test(toast)) return { error: '検算できなかったため破棄' };
        return { questions: JSON.parse(prog).questions };
      }
      if (toast) return { error: toast, quota: /無料枠/.test(toast) };
    }
    return { error: 'timeout' };
  } finally { w.close(); }
}

export async function generate({ field, target = 50, apiKey, fetchImpl = fetch, outDir = path.join(ROOT, 'bank'),
  htmlPath = path.join(ROOT, 'index.html'), batch = 10, timeoutMs = 1200000, failureWaitMs = 60000, log = console.log }) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  // 自動生成は待たされても困らないので、1回の呼び出しの待ち時間の上限を延ばす
  const TIMEOUT_DECL = 'const REQUEST_TIMEOUT_MS = 90000;';
  if (!html.includes(TIMEOUT_DECL)) throw new Error('REQUEST_TIMEOUT_MS の宣言が見つかりません');
  html = html.replace(TIMEOUT_DECL, 'const REQUEST_TIMEOUT_MS = 300000;');
  // 使うモデルを環境変数 GEMINI_MODELS（カンマ区切り）で差し替えられる
  const MODELS_RE = /const MODELS\s*=\s*\[[^\]]*\];/;
  if (process.env.GEMINI_MODELS) {
    if (!MODELS_RE.test(html)) throw new Error('MODELS の宣言が見つかりません');
    const list = process.env.GEMINI_MODELS.split(',').map(x => x.trim()).filter(Boolean);
    html = html.replace(MODELS_RE, `const MODELS = ${JSON.stringify(list)};`);
    log('使用モデル: ' + list.join(', '));
  }
  // API呼び出しごとの所要時間とトークン数を記録（遅さの原因調べ用）
  const rawFetch = fetchImpl;
  fetchImpl = async (url, opts) => {
    const t = Date.now();
    const name = String(url).split('/').pop().split('?')[0];
    try {
      const res = await rawFetch(url, opts);
      let extra = '';
      try {
        const u = (await res.clone().json()).usageMetadata;
        if (u) extra = ` 出力${u.candidatesTokenCount ?? '?'}トークン 思考${u.thoughtsTokenCount ?? 0}トークン`;
      } catch {}
      log(`API ${name} → ${res.status} ${((Date.now() - t) / 1000).toFixed(0)}秒${extra}`);
      if (!res.ok) { // 失敗の原因調べ用に、エラー内容の先頭を記録（APIキーは含まれない）
        try {
          const e = (await res.clone().json()).error || {};
          const quota = (e.details || []).flatMap(d => (d.violations || []).map(v => `${v.quotaMetric || ''}/${v.quotaId || ''}`)).join(',');
          log(`  エラー内容: ${String(e.message || '').slice(0, 300).replace(/\n/g, ' ')}${quota ? ' [' + quota + ']' : ''}`);
        } catch {}
      }
      return res;
    } catch (e) {
      log(`API ${name} → エラー(${e.name}) ${((Date.now() - t) / 1000).toFixed(0)}秒`);
      throw e;
    }
  };
  const file = path.join(outDir, `${field}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  let bank = { field, updatedAt: null, questions: [] };
  try { bank = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let failures = 0, stopped = '';
  while (bank.questions.length < target && failures < 5) {
    const res = await runBatch({ html, apiKey, fetchImpl, field, count: batch, existing: bank.questions, timeoutMs });
    if (res.quota) { stopped = '無料枠に達したため中断'; break; }
    if (res.error) { failures++; log(`失敗(${failures}/5): ${res.error}`);
      await sleep(failureWaitMs); // 混雑・1分あたりの上限は待てば戻る
      continue; }
    failures = 0;
    const now = new Date().toISOString().slice(0, 10);
    for (const q of res.questions) {
      bank.questions.push({ q: q.q, choices: q.choices, answer: q.answer, explanation: q.explanation, topic: q.topic, volatile: !!q.volatile, createdAt: now });
    }
    bank.updatedAt = now;
    fs.writeFileSync(file, JSON.stringify(bank, null, 1) + '\n');
    log(`${field}: ${bank.questions.length}/${target}問`);
  }
  if (!stopped && failures >= 5) stopped = '失敗が続いたため中断';
  return { count: bank.questions.length, stopped };
}

// 自動モード: 分野のうち問題数が一番少ないものから順に、目標に届くまで1バッチずつ追加する
export async function generateAuto({ target = 50, outDir = path.join(ROOT, 'bank'), htmlPath = path.join(ROOT, 'index.html'),
  batch = 10, log = console.log, ...rest }) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const fields = [...html.matchAll(/\{ id: '([\w-]+)',\s+icon: '[^']+',\s+name: '[^']+',\s+sub: '[^']+',/g)]
    .map(m => ({ id: m[1] }))
    .filter(f => f.id !== 'random');
  const countOf = f => {
    try { return JSON.parse(fs.readFileSync(path.join(outDir, `${f.id}.json`), 'utf8')).questions.length; } catch { return 0; }
  };
  let total = 0, stopped = '';
  for (;;) {
    const next = fields.map(f => ({ ...f, n: countOf(f) })).filter(f => f.n < target).sort((a, b) => a.n - b.n)[0];
    if (!next) break;
    const r = await generate({ field: next.id, target: next.n + batch, outDir, htmlPath, batch, log, ...rest });
    total += r.count - next.n;
    if (r.stopped) { stopped = r.stopped; break; }
    if (r.count <= next.n) { stopped = '問題が増えなかったため中断'; break; }
  }
  return { added: total, stopped, status: fields.map(f => `${f.id}: ${countOf(f)}`) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.GEMINI_API_KEY;
  // 1回の生成で作る問題数（環境変数 BATCH。多いほど、同じ呼び出し回数で問題が増える）
  const BATCH = Math.min(40, Math.max(5, Number(process.env.BATCH) || 10));
  if (process.argv[2] === 'auto') {
    // 使い方: GEMINI_API_KEY=... node tools/generate-bank.mjs auto [目標問数=50]
    if (!apiKey) { console.error('GEMINI_API_KEY がありません'); process.exit(2); }
    const r = await generateAuto({ target: Number(process.argv[3]) || 50, batch: BATCH, apiKey });
    console.log(r.status.join('\n'));
    console.log(`完了: ${r.added}問追加${r.stopped ? '（' + r.stopped + '）' : ''}`);
  } else {
    const [field, target] = process.argv.slice(2);
    if (!field || !apiKey) { console.error('使い方: GEMINI_API_KEY=... node tools/generate-bank.mjs <分野ID> [問数]'); process.exit(2); }
    const r = await generate({ field, target: Number(target) || 50, batch: BATCH, apiKey });
    console.log(`完了: ${r.count}問${r.stopped ? '（' + r.stopped + '）' : ''}`);
  }
}
