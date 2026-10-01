// =====================================================
// ImageGallery Yahoo版: Yahoo!ショッピング商品一覧の取得スクリプト
// GitHub Actions (.github/workflows/yahoo-sync.yml) から実行される。Node 20 以上・依存パッケージなし。
//
// やること:  Yahoo商品検索API (V3 itemSearch) でストアの商品一覧を取り、
//            data/{SHOP_ID}/yahoo-products.json に書き出す (コミットはワークフロー側)。
// やらないこと: gallery.json には一切触れない。
//            gallery.json への反映(マージ)はツール(ブラウザ)側の「取り込む」で行う。
//            Actions が gallery.json を書くと、ブラウザの保存と競合して画像やタグが消える恐れがあるため。
//
// 環境変数:
//   YAHOO_CLIENT_ID  … Yahoo!デベロッパーネットワークの Client ID (GitHub Secrets)
//   SHOP_ID          … ツールのショップID (shop_xxxx)。空なら「過去に取得したショップ全部」を取り直す (定期実行用)
//   SELLER_ID        … YahooストアID (seller_id)。SHOP_ID を指定したときは必須
//   YAHOO_API_BASE   … テスト用。省略時は本番API
//
// APIの制約と対処:
//   ・1回の検索で取れるのは start + results ≤ 1,000 まで (= 最大999件)。
//     → 価格帯 (price_from / price_to、両端を含む) で検索を分割し、どの区切りも999件以下にしてから全ページを取る。
//   ・1クエリ/秒。超えると一時的に利用不可 (HTTP 429)。→ 1.1秒間隔で直列に呼ぶ。429 は待って再試行。
//   ・hits[].code は「ストアID_商品コード」形式。ストアIDの接頭辞を外したものを商品コードとする。
// =====================================================
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API = process.env.YAHOO_API_BASE || 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
const PER_PAGE = 50;          // 1回の最大件数
const REACHABLE = 999;        // start + results ≤ 1000 なので、1つの検索条件で取れるのは999件まで
const WAIT_MS = Number(process.env.YAHOO_WAIT_MS || 1100);   // 1クエリ/秒の制限に対する間隔
const PRICE_MAX = 100_000_000;
const OUT_NAME = 'yahoo-products.json';

const CLIENT_ID = (process.env.YAHOO_CLIENT_ID || '').trim();
const ID_RE = /^[A-Za-z0-9_-]+$/;

// GitHub Actions の注釈。ツール側の「失敗理由」にこの文言がそのまま出る。
const ghError = (msg) => console.log(`::error::${msg}`);
const ghWarn = (msg) => console.log(`::warning::${msg}`);
const mask = (s) => String(s).split(CLIENT_ID || '\u0000').join('***').replace(/(appid=)[^&\s]+/gi, '$1***');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class FatalError extends Error {}

let lastCallAt = 0;
let requestCount = 0;

async function callApi(params) {
  const qs = new URLSearchParams({ appid: CLIENT_ID, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const url = `${API}?${qs}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastCallAt + WAIT_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    requestCount++;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'imagegallery-yahoo-sync' } });
    } catch (e) {
      console.log(`通信エラー (${attempt + 1}回目): ${mask(e.message)}`);
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      console.log(`HTTP ${res.status} → ${5 * (attempt + 1)}秒待って再試行`);
      await sleep(5000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 下でまとめて扱う */ }
    if (!res.ok) {
      const apiMsg = json && (json.Error?.Message || json.error?.message || json.message);
      if (res.status === 401 || res.status === 403) {
        throw new FatalError(`Yahoo APIが認証を拒否しました (HTTP ${res.status})。Secrets の YAHOO_CLIENT_ID が正しいか確認してください${apiMsg ? '：' + mask(apiMsg) : ''}`);
      }
      throw new FatalError(`Yahoo APIがエラーを返しました (HTTP ${res.status})${apiMsg ? '：' + mask(apiMsg) : '：' + mask(text.slice(0, 200))}`);
    }
    if (!json) throw new FatalError(`Yahoo APIの応答がJSONではありません：${mask(text.slice(0, 200))}`);
    return json;
  }
  throw new FatalError('Yahoo APIへの接続が5回続けて失敗しました（レート制限または障害）。しばらく待ってから再実行してください');
}

// 1件を正規化。商品コードを取り出せないものは null
function normalizeHit(hit, sellerId) {
  if (!hit) return null;
  const seller = String(sellerId).toLowerCase();
  const hitSeller = String(hit.seller?.sellerId || '').toLowerCase();
  if (hitSeller && hitSeller !== seller) return { foreign: true };   // 念のため他店の商品は除外
  const rawCode = String(hit.code || '');
  let code = '';
  if (rawCode.toLowerCase().startsWith(seller + '_')) code = rawCode.slice(seller.length + 1);
  if (!code && hit.url) {
    const m = String(hit.url).match(/store\.shopping\.yahoo\.co\.jp\/[^/]+\/([^/?#]+?)\.html/i);
    if (m) code = decodeURIComponent(m[1]);
  }
  code = code.trim();
  if (!code) return null;
  const img = hit.image || {};
  return {
    code,
    name: String(hit.name || '').trim(),
    price: Number.isFinite(Number(hit.price)) ? Number(hit.price) : null,
    url: hit.url || '',
    image: img.medium || img.small || '',
    yahooId: rawCode || `${seller}_${code}`,
    inStock: typeof hit.inStock === 'boolean' ? hit.inStock : null
  };
}

async function fetchStore(sellerId) {
  const items = new Map();   // 小文字の商品コード → 商品
  const stat = { skipped: 0, foreign: 0, truncated: false, totalAvailable: null };

  const addHits = (hits) => {
    (hits || []).forEach(h => {
      const it = normalizeHit(h, sellerId);
      if (!it) { stat.skipped++; return; }
      if (it.foreign) { stat.foreign++; return; }
      const k = it.code.toLowerCase();
      if (!items.has(k)) items.set(k, it);
    });
  };

  const search = (lo, hi, start, results) => callApi({
    seller_id: sellerId, price_from: lo, price_to: hi, sort: '+price', results, start
  });

  // 価格帯 [lo, hi] の商品を全部取る。999件を超える帯は半分に割って再帰する。
  async function fetchRange(lo, hi, depth) {
    const first = await search(lo, hi, 1, PER_PAGE);
    const total = Number(first.totalResultsAvailable || 0);
    if (depth === 0) stat.totalAvailable = total;
    if (total === 0) return;
    if (total > REACHABLE && hi > lo) {
      const mid = Math.floor((lo + hi) / 2);
      console.log(`  ${lo}〜${hi}円: ${total}件 → 分割`);
      await fetchRange(lo, mid, depth + 1);
      await fetchRange(mid + 1, hi, depth + 1);
      return;
    }
    if (total > REACHABLE) {
      stat.truncated = true;
      ghWarn(`${lo}円ちょうどの商品が${total}件あり、APIの上限で${REACHABLE}件までしか取れませんでした。CSVからの取り込みを併用してください`);
    }
    addHits(first.hits);
    const last = Math.min(total, REACHABLE);
    for (let start = 1 + PER_PAGE; start <= last; start += PER_PAGE) {
      const results = Math.min(PER_PAGE, 1000 - start, last - start + 1);
      if (results <= 0) break;
      const page = await search(lo, hi, start, results);
      addHits(page.hits);
    }
    console.log(`  ${lo}〜${hi}円: ${total}件 取得済み (累計${items.size}件)`);
  }

  await fetchRange(0, PRICE_MAX, 0);
  return { items: [...items.values()].sort((a, b) => a.code.localeCompare(b.code, 'ja', { numeric: true })), ...stat };
}

async function syncOne(shopId, sellerId) {
  if (!ID_RE.test(shopId)) throw new FatalError(`ショップIDの形式が正しくありません: ${shopId}`);
  if (!ID_RE.test(sellerId)) throw new FatalError(`ストアIDの形式が正しくありません（英数字・-・_ のみ）: ${sellerId}`);
  sellerId = sellerId.toLowerCase();
  console.log(`▶ ${shopId} / ストアID: ${sellerId}`);
  const started = Date.now();
  const r = await fetchStore(sellerId);

  if (r.items.length === 0) {
    // 0件は「成功」にしない。空の一覧を書き出すと、取り込み時に混乱するので書かずに失敗させる。
    throw new FatalError(`ストアID「${sellerId}」の商品が0件でした。ストアIDが正しいか（ストアURLの store.shopping.yahoo.co.jp/○○/ の部分）確認してください`);
  }

  const dir = path.join('data', shopId);
  const file = path.join(dir, OUT_NAME);
  let prevCount = null;
  if (existsSync(file)) {
    try { prevCount = (JSON.parse(await readFile(file, 'utf8')).items || []).length; } catch (e) { /* 壊れていれば上書き */ }
  }
  if (prevCount && r.items.length < prevCount * 0.5) {
    ghWarn(`取得件数が前回(${prevCount}件)の半分未満(${r.items.length}件)です。Yahoo側の一時的な不調の可能性があります。取り込み前に件数を確認してください`);
  }

  const out = {
    version: 1,
    shopId,
    sellerId,
    fetchedAt: new Date().toISOString(),
    api: 'ShoppingWebService V3 itemSearch',
    totalAvailable: r.totalAvailable,
    count: r.items.length,
    skipped: r.skipped,
    truncated: r.truncated,
    requests: requestCount,
    items: r.items
  };
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 1) + '\n', 'utf8');

  const secs = Math.round((Date.now() - started) / 1000);
  const line = `${sellerId}: ${r.items.length}件を取得（Yahoo上の総件数 ${r.totalAvailable}件 / 飛ばした ${r.skipped}件 / ${secs}秒）`;
  console.log(`✔ ${line} → ${file}`);
  if (r.totalAvailable && r.items.length < r.totalAvailable) {
    ghWarn(`総件数 ${r.totalAvailable}件のうち ${r.items.length}件しか取得できませんでした`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
  }
}

async function main() {
  if (!CLIENT_ID) {
    throw new FatalError('Client IDが未登録です。リポジトリの Settings → Secrets and variables → Actions に YAHOO_CLIENT_ID を登録してください');
  }
  const shopId = (process.env.SHOP_ID || '').trim();
  const sellerId = (process.env.SELLER_ID || '').trim();

  if (shopId) {
    if (!sellerId) throw new FatalError('ストアID (seller_id) が指定されていません。ツールの⚙️設定でショップにストアIDを入力してください');
    await syncOne(shopId, sellerId);
    return;
  }

  // 定期実行: 過去に取得したことのあるショップ (data/*/yahoo-products.json) を全部取り直す
  const targets = [];
  if (existsSync('data')) {
    for (const d of await readdir('data', { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = path.join('data', d.name, OUT_NAME);
      if (!existsSync(f)) continue;
      try {
        const j = JSON.parse(await readFile(f, 'utf8'));
        if (j.sellerId) targets.push([d.name, j.sellerId]);
      } catch (e) { ghWarn(`${f} を読めませんでした`); }
    }
  }
  if (targets.length === 0) {
    console.log('取り直す対象のショップがありません（一度ツールから「Yahooから同期」を実行すると対象になります）');
    return;
  }
  let failed = 0;
  for (const [sid, seller] of targets) {
    try { await syncOne(sid, seller); }
    catch (e) { failed++; ghError(`${sid}: ${mask(e.message)}`); }
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => {
  ghError(mask(e instanceof FatalError ? e.message : `予期しないエラー: ${e && e.stack || e}`));
  process.exitCode = 1;
});
