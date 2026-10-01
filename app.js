// =====================================================
// ImageGallery (Yahoo!ショッピング版)
// Yahoo!ショッピングの自社商品画像を商品ごとに保管するLP制作支援ツール
// 複製元: 楽天版 kaiyoshida0318/imagegallery v1.11.41
// =====================================================
const APP_VERSION = 'Yahoo v1.0.2';
// ⚠️ 楽天版と同じドメイン (kaiyoshida0318.github.io) で動くため、localStorage / sessionStorage は楽天版と共有になる。
//    キーは必ず imagegallery_yahoo_ で始めること。楽天版と同じキーを使うと、
//    楽天版の設定(リポジトリ名・ショップ一覧)を読んでしまい、保存すると楽天版の設定を上書きする。

// グローバルエラーハンドラ - エラーを画面に表示
window.addEventListener('error', (e) => {
  showFatalError(e.message + ' at ' + (e.filename||'') + ':' + (e.lineno||''));
});
window.addEventListener('unhandledrejection', (e) => {
  showFatalError('Promise rejected: ' + (e.reason?.message || e.reason));
});
function showFatalError(msg) {
  console.error('FATAL:', msg);
  let el = document.getElementById('fatalError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatalError';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:white;padding:12px 20px;font-family:monospace;font-size:12px;z-index:99999;white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);max-height:50vh;overflow-y:auto;';
    document.body && document.body.appendChild(el);
  }
  el.textContent = '⚠️ ERROR: ' + msg;
}

// ----- 設定キー -----
const LS_AUTH = 'imagegallery_yahoo_auth_v1';
const LS_CURRENT_SHOP = 'imagegallery_yahoo_current_shop_v1';
const LS_CURRENT_CAT = 'imagegallery_yahoo_current_cat_v1';

// ----- 状態 -----
let auth = {
  pat: '',
  owner: '',
  repo: '',
  branch: 'main'
};
let shops = [];        // [{id, name, mall:'yahoo', shopCode(=YahooストアID/seller_id), appId, accessKey}] ※appId/accessKeyはYahoo版では未使用(Client IDはGitHub Secrets)
let currentShopId = null;
let currentCategory = 'product';  // 'product' | 'product_unsure' | 'product_all' | 'material' | 'boost'
let dataCache = {};    // {shopId: {products: [...], materials: [...], boosts: [...], shaMap: {}}}
let currentProductId = null;     // open product modal target
let currentImageId = null;       // open image detail target
let searchQuery = '';
let filterUnregistered = false;
let sortKey = 'manage';  // デフォルト: 商品管理番号
let sortDir = 'desc';    // デフォルト: 降順
const LS_SORT_KEY = 'imagegallery_yahoo_sort_key_v1';
const LS_SORT_DIR = 'imagegallery_yahoo_sort_dir_v1';
let filterTagIds = new Set();
// v1.11.27: フィルタ選択の永続化 & 閲覧者向け自動更新
const LS_FILTER_TAGS = 'imagegallery_yahoo_filter_tags_v1';
let _autoRefreshTimer = null;
let openTagPickerProductId = null;
let viewMode = 'images';  // 'images' (画像全体, 既定) | 'basic' (基礎情報) | 'delete' (削除)
const LS_VIEW_MODE = 'imagegallery_yahoo_view_mode_v1';
// v1.11.17: 表示切替 (商品ごと / 画像一覧)
const LS_GALLERY_VIEW = 'imagegallery_yahoo_gallery_view_v1';
let galleryViewMode = 'product'; // 'product' (商品ごと) | 'imagelist' (画像一覧)
let _imageListUrls = [];         // 画像一覧モードのライトボックス用URL配列
let _tagMgr = null;              // v1.11.22: タグ管理モーダルの作業状態

// v1.11.15: 項目管理(列幅ドラッグ調整)
const LS_COL_WIDTHS = 'imagegallery_yahoo_col_widths_v1';
const DEFAULT_COL_WIDTHS = { number: 110, manage: 120, name: 240, actions: 96 };
let colWidths = { ...DEFAULT_COL_WIDTHS };
let colResizeMode = false;
let _colDrag = null;

// v1.11.37: 同期(取得)の履歴。「🔄 更新」モーダルで「いつ・手動か自動か・何が増減したか」を見せる。
const LS_SYNC_LOG = 'imagegallery_yahoo_sync_log_v1';
const SYNC_LOG_MAX = 20;
let syncLog = [];   // [{at, shopId, mode, failed, changed, diff, total, note}]

// v1.11.40: 診断ログ。エラー・警告・失敗した通信を溜めて、更新モーダルから丸ごとコピーできるようにする。
const LS_DIAG_LOG = 'imagegallery_yahoo_diag_log_v1';
const DIAG_LOG_MAX = 120;
const DIAG_MSG_MAX = 500;        // 1行が長すぎるとlocalStorageを圧迫するので切る
let diagLog = [];                // [{at, level, msg}]
let _diagHooksInstalled = false;

let deleteSelection = new Set();  // 削除予約された画像ID (img.id)
let productDeleteSelection = new Set();  // v1.11.29: 削除予約された商品ID (p.id)
let pendingStatusChanges = new Map();  // 保存待ちのステータス変更: productId -> 'active'|'unsure'

// エクスポートモード関連 (v1.8.4)
const SS_EXPORT_MODE = 'imagegallery_yahoo_export_mode_v1';
const SS_EXPORT_SELECTION = 'imagegallery_yahoo_export_selection_v1';
let exportMode = false;
let exportSelection = new Set();  // 選択された商品ID

// タグ用カラーパレット
const TAG_COLORS = [
  { id: 'gray',   bg: '#e5e7eb', fg: '#374151' },
  { id: 'red',    bg: '#fecaca', fg: '#991b1b' },
  { id: 'orange', bg: '#fed7aa', fg: '#9a3412' },
  { id: 'amber',  bg: '#fde68a', fg: '#92400e' },
  { id: 'green',  bg: '#bbf7d0', fg: '#166534' },
  { id: 'teal',   bg: '#99f6e4', fg: '#115e59' },
  { id: 'blue',   bg: '#bfdbfe', fg: '#1e40af' },
  { id: 'indigo', bg: '#c7d2fe', fg: '#3730a3' },
  { id: 'purple', bg: '#e9d5ff', fg: '#6b21a8' },
  { id: 'pink',   bg: '#fbcfe8', fg: '#9d174d' }
];
let newTagSelectedColor = 'amber';

// =====================================================
// 起動
// =====================================================
// v1.11.37: index.html 側がキャッシュ対策で app.js を動的に読み込む場合、
//   読み込み完了時には既に DOMContentLoaded が終わっていることがある。
//   その場合はイベントを待たずに起動する (待つと永久に起動しない)。
// v1.11.38: ただし「その場で init() を呼ぶ」のは厳禁。
//   init() は最初の await までを同期実行するため、スクリプト評価の途中で走ってしまい、
//   ファイル後半で const/let 宣言している定数がまだ初期化されておらず
//   「Cannot access '…' before initialization」で静かに壊れる。
//   setTimeout(…, 0) にして、スクリプト全体の評価が終わってから起動させる。
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 0);
}

async function init() {
  // Service Worker登録 (v1.11.6): 画像を長期キャッシュして表示高速化
  registerServiceWorker();
  loadAuth();
  loadSyncLog();            // v1.11.37: 取得履歴を復元
  loadDiagLog();            // v1.11.40: 診断ログを復元
  installDiagHooks();       // v1.11.40: エラー/警告/通信失敗を拾い始める
  loadCurrentSelections();
  applyShopFromUrl();       // v1.11.38: URLの ?shop= を localStorage より優先
  // エクスポートモード状態をsessionStorageから復元
  try {
    exportMode = sessionStorage.getItem(SS_EXPORT_MODE) === '1';
    const sel = sessionStorage.getItem(SS_EXPORT_SELECTION);
    if (sel) exportSelection = new Set(JSON.parse(sel));
  } catch (e) { console.warn('export state load failed', e); }
  bindEvents();
  injectImageTagStyles();
  injectMallBadge();         // Yahoo v1.0.0: ロゴ横に「Yahoo!ショッピング版」
  injectColManageButton();   // v1.11.15: 上部に「項目管理」ボタン
  injectTagManagerButton();  // v1.11.22: 上部に「タグ編集」ボタン
  injectShareButton();       // v1.11.25: 上部に「共有」ボタン
  injectRefreshButton();     // v1.11.27: 上部に「更新」ボタン
  injectProductDeleteUI();   // v1.11.29: 「削除」→「画像削除」改称 + 「商品削除」追加
  moveAddButton();           // v1.11.30: 「+追加」を ver と 更新 の間へ移動
  injectAddPartButton();     // v1.11.33: 「+部品追加」ボタン
  // v1.11.37: 「更新」を最右端へ / ⚙️に「設定」ラベル
  //   ⚠️ moveAddButton() は「更新」の直前に +追加 を差し込むので、必ずその後に呼ぶこと。
  //      先に呼ぶと +追加/+部品追加 まで右端へ連れて行かれる。
  moveRefreshButtonToEnd();
  moveStorageButtonIntoSettings();  // v1.11.37: 「📊」→「容量確認」にして設定モーダルへ
  injectPartsTab();          // v1.11.33: 「部品」タブを 全体 の右に追加
  injectNoImageTab();        // v1.11.34: 「商品(未設定)」タブを 全体 と 部品 の間に追加
  injectYahooThumbTab();     // v1.11.35: 「サムネ台」(旧Yahoo用サムネ)タブを 部品 の右に追加
  setupYahooHub();           // Yahoo v1.0.0: ＋商品追加モーダルに Yahoo同期 / 商品CSV / 取得済み一覧 を用意
  setupCsvModalExtras();     // v1.11.31: 商品名称一括更新モーダルに基礎情報DL+D&Dを統合
  relabelCategoryTabs();     // v1.11.15: 現役→選択分
  injectUntaggedTab();       // v1.11.19: 「未選択分」タブを追加
  syncCategoryActiveTab();   // v1.11.19: 現在カテゴリに合わせて active 同期
  applyColWidths();          // v1.11.15: 保存済みの列幅を適用
  setupFilterRow();          // v1.11.17: 検索の上に「切替ボタン+タグチップ」の行を作る
  renderVersion();
  // 表示モードのボタンを初期化
  document.querySelectorAll('.view-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === viewMode));
  renderShopTabs();
  await loadCurrentShopData();
  render();
  startAutoRefresh();        // v1.11.27: 閲覧者向けに一定間隔で自動更新

  // v1.11.38: 戻る/進むでショップを切り替えられるようにする
  window.addEventListener('popstate', () => {
    const s = findShopBySlug(readShopFromUrl());
    if (s && s.id !== currentShopId) switchShop(s.id, { fromUrl: true });
  });
  // URLに知らないショップが指定されていた場合は黙って無視せず知らせる
  if (_unknownShopSlug) {
    toast(`URLのショップ「${_unknownShopSlug}」は、このブラウザに登録されていません。⚙️設定から追加するか、🔗共有コードを読み込んでください`, 'error');
  }
}

// v1.11.8: 画像単位タグ用の最小CSSを一度だけ注入 (style.css を変更せず app.js だけで完結させる)
function injectImageTagStyles() {
  if (document.getElementById('imgTagStyles')) return;
  const st = document.createElement('style');
  st.id = 'imgTagStyles';
  st.textContent = `
    .product-row-images { align-items: flex-start; }
    .img-tag-cell { display: inline-flex; flex-direction: column; align-items: stretch; gap: 3px; vertical-align: top; }
    .img-tag-select {
      max-width: 96px; font-size: 11px; line-height: 1.3; padding: 2px 4px;
      border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; color: #334155;
      cursor: pointer; box-sizing: border-box;
    }
    .img-tag-select[data-has="1"] { font-weight: 700; }
    .img-tag-select:hover { border-color: #94a3b8; }
    /* v1.11.11: 画像全体/基礎情報の切替UIを廃止 */
    .view-mode-toggle { display: none !important; }
    /* v1.11.12: 素材/盛り上げタブを廃止 */
    .cat-btn[data-cat="material"], .cat-btn[data-cat="boost"] { display: none !important; }
    /* v1.11.12: 情報モーダルの「ステータス(現役/微妙)」欄を廃止 */
    #productEditModal .form-row:has(input[name="productEditStatus"]) { display: none !important; }
    /* v1.11.15: 微妙タブを廃止 (選択分/全体の2つに) */
    .cat-btn[data-cat="product_unsure"] { display: none !important; }
    /* v1.11.15: タグ・操作の「画像/情報」を縦2段に */
    .col-actions .edit-btn-group { flex-direction: column !important; }
    /* v1.11.15: 項目管理(列幅ドラッグ) */
    #btnColManage.active { background: #f5d0fe; border-color: #e879f9; }
    .product-table-header.mode-images.colresize > div { position: relative; }
    .col-resize-handle { position: absolute; top: 0; width: 10px; height: 100%; cursor: col-resize; z-index: 6; }
    .col-resize-handle.right { right: -5px; }
    .col-resize-handle.left { left: -5px; }
    .col-resize-handle::after { content: ''; position: absolute; top: 12%; height: 76%; width: 3px; left: 3px; background: #c026d3; border-radius: 2px; opacity: .55; }
    .col-resize-handle:hover::after { opacity: 1; }
    /* 列幅(grid-template-columns)は applyColWidths() が #colWidthStyles に動的注入 */
    /* v1.11.17: 検索の上の「切替+タグチップ」行 */
    .filter-chip-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 16px 0; }
    .gallery-mode-seg { display: inline-flex; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; overflow: hidden; flex-shrink: 0; }
    .gallery-mode-seg button { border: none; background: #fff; color: #475569; font-size: 12px; padding: 6px 12px; cursor: pointer; }
    .gallery-mode-seg button + button { border-left: 1px solid var(--border, #e2e8f0); }
    .gallery-mode-seg button.active { background: #7c3aed; color: #fff; font-weight: 700; }
    .filter-chip-row #tagFilterInline { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
    /* v1.11.17: 画像一覧グリッド */
    .image-list-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; padding: 12px 16px; }
    .image-list-tile { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .image-list-tile .ilt-thumb { width: 100%; height: 170px; background: #fff; border: 1px solid var(--border-light, #eef2f7); overflow: hidden; cursor: zoom-in; }
    .image-list-tile .ilt-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .image-list-tile .ilt-thumb:hover { outline: 2px solid var(--primary, #7c3aed); outline-offset: -2px; }
    .image-list-tile .img-tag-select { max-width: 100%; width: 100%; }
    .image-list-tile .ilt-meta { font-size: 10px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* v1.11.20: ライトボックスをカルーセル化 (中央大 / 左右うっすら) */
    .lightbox { padding: 0 !important; }
    .lb-stage { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .lb-current { max-width: 54vw !important; max-height: 90vh !important; object-fit: contain; z-index: 2; cursor: pointer; box-shadow: 0 8px 50px rgba(0,0,0,.7); background: #fff; }
    .lb-peek { position: absolute; top: 50%; transform: translateY(-50%); max-height: 72vh; max-width: 24vw; object-fit: contain; opacity: .32; z-index: 1; cursor: pointer; transition: opacity .15s; filter: brightness(.6); background: #fff; }
    .lb-peek:hover { opacity: .6; }
    .lb-peek-prev { left: 3vw; }
    .lb-peek-next { right: 3vw; }
    /* v1.11.22: 分類タグ管理モーダル */
    #tagMgrModal .modal { max-width: 640px; width: 92%; }
    #tagMgrModal .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 0 2px; }
    .tagmgr-hint { font-size: 12px; color: #64748b; margin-bottom: 10px; }
    .tagmgr-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid #eef2f7; }
    .tagmgr-reorder { display: flex; flex-direction: column; gap: 2px; }
    .tagmgr-reorder button { width: 24px; height: 16px; line-height: 1; font-size: 9px; border: 1px solid #e2e8f0; background: #fff; border-radius: 4px; cursor: pointer; padding: 0; }
    .tagmgr-reorder button:disabled { opacity: .3; cursor: default; }
    .tagmgr-preview { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 12px; white-space: nowrap; min-width: 64px; text-align: center; flex-shrink: 0; }
    .tagmgr-name { flex: 1; min-width: 70px; font-size: 13px; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; }
    .tagmgr-colors { display: flex; gap: 3px; flex-wrap: wrap; }
    .tagmgr-dot { width: 18px; height: 18px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; box-sizing: border-box; }
    .tagmgr-dot.sel { border-color: #0f172a; }
    .tagmgr-del { border: none; background: transparent; cursor: pointer; font-size: 15px; padding: 2px 4px; }
    .tagmgr-add-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 2px solid #e2e8f0; flex-wrap: wrap; }
    .tagmgr-add-row #tagMgrNewName { flex: 1; min-width: 120px; padding: 6px 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; }
    /* v1.11.33: 部品追加モーダルの画像プレビュー */
    .part-preview { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .part-thumb { position: relative; width: 72px; height: 92px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; background: #fff; }
    .part-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .part-thumb-x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border: none; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 12px; line-height: 1; cursor: pointer; padding: 0; }
    #addPartModal .form-row { margin-bottom: 14px; }
    #addPartModal .form-row > label { display: block; font-weight: 700; font-size: 13px; margin-bottom: 5px; }
    #addPartModal #partName, #addPartModal #partTagSelect { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; }
    /* v1.11.32: 同期(更新)モーダル */
    #syncModal .modal { max-width: 460px; width: 92%; }
    .sync-opt { display: block; width: 100%; text-align: left; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 12px; background: #fff; cursor: pointer; }
    .sync-opt:hover { border-color: #7c3aed; background: #faf5ff; }
    .sync-opt-title { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
    .sync-opt-desc { font-size: 12px; color: #64748b; line-height: 1.5; }
    /* v1.11.31: 商品名称一括更新モーダル内のステップ表示 */
    #csvImportModal .csv-step { margin-bottom: 14px; }
    #csvImportModal .csv-step-label { font-weight: 700; font-size: 13px; margin: 8px 0 6px; }
    /* v1.11.29: 商品削除モード */
    .product-table-header.mode-productdelete,
    .product-row.mode-productdelete { display: grid; align-items: center; grid-template-columns: 56px 120px 120px 220px minmax(0, 1fr); border-bottom: 1px solid var(--border-light, #eef2f7); }
    .product-row.mode-productdelete { cursor: pointer; }
    .product-row.mode-productdelete:hover { background: #fef2f2; }
    .product-row.mode-productdelete.pd-selected { background: #fee2e2; outline: 2px solid #ef4444; outline-offset: -2px; }
    .col-pd-check { display: flex; align-items: center; justify-content: center; font-size: 20px; color: #ef4444; user-select: none; }
    .product-row.mode-productdelete .product-row-thumb { pointer-events: none; }
    /* v1.11.25: 共有モーダル */
    #shareModal .modal { max-width: 560px; width: 92%; }
    .share-sec { margin-bottom: 18px; }
    .share-label { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
    #shareModal textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px; resize: vertical; word-break: break-all; }
    #shareModal .btn-mini { margin-top: 8px; }
    /* ===== v1.11.37: 更新モーダル「ダウンロード」内の最終取得表示 ===== */
    .sync-opt-meta {
      font-size: 12px; line-height: 1.6; color: #334155;
      margin: 4px 0 6px; padding: 6px 9px;
      background: #f1f5f9; border-radius: 7px;
    }
    .sync-opt-meta strong { font-variant-numeric: tabular-nums; }
    .sync-changed { color: #15803d; font-weight: 700; }
    .sync-muted { color: #94a3b8; }
    .sync-note { color: #64748b; font-size: 11px; margin-top: 3px; }
    .sync-warn { color: #b45309; font-size: 11.5px; margin-top: 4px; }
    .sync-pill {
      display: inline-block; font-size: 10.5px; font-weight: 700; line-height: 1.5;
      padding: 1px 7px; border-radius: 999px; vertical-align: 1px;
    }
    .sync-pill-auto    { background: #dbeafe; color: #1e40af; }
    .sync-pill-manual  { background: #e9d5ff; color: #6b21a8; }
    .sync-pill-initial { background: #e2e8f0; color: #475569; }
    /* ===== v1.11.38: ショップ切替ドロップダウン ===== */
    .shop-select {
      padding: 7px 28px 7px 12px; border-radius: var(--radius-sm, 8px);
      border: 1px solid var(--border, #e2e8f0); background: #fff; color: var(--text, #1e293b);
      font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer;
      max-width: 220px; appearance: none;
      background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath fill='%2364748b' d='M0 0h10L5 6z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 10px center;
    }
    .shop-select:hover { border-color: #a78bfa; }
    .shop-select:focus { outline: none; border-color: #7c3aed; }
    .shop-slug {
      font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace;
      white-space: nowrap; align-self: center; margin-left: 2px;
    }
    /* 設定 → ショップ管理 に、ショップごとの専用URLを出す */
    .shop-row-url { font-size: 11px; color: #64748b; margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .shop-row-url code { font-family: ui-monospace, monospace; background: #f1f5f9; padding: 1px 6px; border-radius: 5px; color: #475569; }
    .shop-url-copy {
      font-size: 10.5px; padding: 2px 8px; border-radius: 5px; cursor: pointer;
      border: 1px solid #cbd5e1; background: #fff; color: #475569; font-family: inherit;
    }
    .shop-url-copy:hover { border-color: #a78bfa; color: #6d28d9; }
    /* ===== v1.11.40: 更新モーダル内の診断ログ ===== */
    .diag-box { margin-top: 16px; border: 1px solid var(--border, #e2e8f0); border-radius: 10px; overflow: hidden; }
    .diag-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
      padding: 8px 10px; background: #f8fafc; border-bottom: 1px solid var(--border, #e2e8f0);
    }
    .diag-title { font-size: 12.5px; font-weight: 700; color: #475569; }
    .diag-count { font-size: 11px; color: #94a3b8; font-weight: 400; }
    .diag-actions { display: flex; gap: 6px; }
    .diag-btn {
      font-size: 11.5px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
      border: 1px solid #cbd5e1; background: #fff; color: #475569; font-family: inherit; white-space: nowrap;
    }
    .diag-btn:hover { border-color: #94a3b8; }
    .diag-btn.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; font-weight: 700; }
    .diag-btn.primary:hover { background: #6d28d9; }
    .diag-list { max-height: 190px; overflow-y: auto; background: #fff; }
    .diag-row {
      display: flex; gap: 8px; align-items: flex-start; font-size: 11.5px;
      padding: 5px 10px; border-bottom: 1px solid #f1f5f9; border-left: 3px solid transparent;
    }
    .diag-row.err  { border-left-color: #ef4444; background: #fef2f2; }
    .diag-row.warn { border-left-color: #f59e0b; background: #fffbeb; }
    .diag-time { flex: 0 0 96px; color: #64748b; font-variant-numeric: tabular-nums; }
    .diag-msg { flex: 1 1 auto; min-width: 0; color: #334155; word-break: break-word; white-space: pre-wrap; font-family: ui-monospace, monospace; }
    .diag-empty { padding: 16px 10px; text-align: center; color: #94a3b8; font-size: 12px; }
    .diag-note { padding: 7px 10px; font-size: 10.5px; color: #64748b; background: #f8fafc; border-top: 1px solid var(--border, #e2e8f0); }
    .diag-fallback {
      display: none; width: 100%; box-sizing: border-box; height: 140px; margin-top: 8px;
      font-family: ui-monospace, monospace; font-size: 11px; padding: 8px;
      border: 1px solid #cbd5e1; border-radius: 8px; resize: vertical;
    }
    /* ===== v1.11.35: Yahoo用サムネ (3列ボード) ===== */
    .yt-board { padding: 12px 16px 40px; }
    .yt-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .yt-add-row {
      background: #7c3aed; color: #fff; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 700; padding: 8px 16px; cursor: pointer;
    }
    .yt-add-row:hover { background: #6d28d9; }
    .yt-add-row:disabled { opacity: .45; cursor: not-allowed; }
    .yt-hint { font-size: 12px; color: #64748b; }
    .yt-table { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; overflow: hidden; background: #fff; }
    .yt-head, .yt-row {
      display: grid;
      grid-template-columns: 150px 190px 190px minmax(260px, 1fr) 104px;
      align-items: stretch;
    }
    .yt-head { background: #f8fafc; border-bottom: 1px solid var(--border, #e2e8f0); position: sticky; top: 0; z-index: 4; }
    .yt-th { font-size: 12px; font-weight: 700; color: #475569; padding: 10px 10px; border-left: 1px solid var(--border-light, #eef2f7); }
    .yt-th:first-child { border-left: none; }
    .yt-th-dl { text-align: center; }
    .yt-row { border-bottom: 1px solid var(--border-light, #eef2f7); }
    .yt-row:last-child { border-bottom: none; }
    .yt-row:hover { background: #fcfcfd; }
    .yt-col { padding: 10px; border-left: 1px solid var(--border-light, #eef2f7); min-width: 0; }
    .yt-col:first-child { border-left: none; }
    .yt-no { display: flex; flex-direction: column; gap: 6px; justify-content: flex-start; }
    .yt-no-badge { font-size: 12px; font-weight: 700; color: #7c3aed; }
    .yt-name-input {
      width: 100%; box-sizing: border-box; font-size: 12px; padding: 5px 7px;
      border: 1px solid #cbd5e1; border-radius: 6px; color: #334155; background: #fff;
    }
    .yt-name-input:focus { outline: none; border-color: #a78bfa; }
    .yt-row-del {
      align-self: flex-start; background: none; border: none; color: #ef4444;
      font-size: 11px; padding: 2px 0; cursor: pointer; text-decoration: underline;
    }
    .yt-cell {
      min-height: 108px; border: 2px dashed #d8dee9; border-radius: 8px; background: #fbfcfe;
      padding: 8px; cursor: pointer; transition: border-color .12s, background .12s;
      display: flex; flex-direction: column; gap: 6px;
    }
    .yt-cell:hover { border-color: #a78bfa; background: #faf7ff; }
    .yt-cell.yt-dragover { border-color: #7c3aed; background: #f3e8ff; }
    .yt-thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
    .yt-cell-multi .yt-thumbs { gap: 6px; }
    .yt-thumb {
      position: relative; width: 72px; height: 72px; border-radius: 6px; overflow: hidden;
      border: 1px solid #e2e8f0; background: #fff; flex: 0 0 auto;
    }
    .yt-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; background: #fff; }
    .yt-thumb-x {
      position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 16px;
      border-radius: 50%; border: none; background: rgba(15,23,42,.62); color: #fff;
      font-size: 12px; cursor: pointer; padding: 0; text-align: center;
    }
    .yt-thumb-x:hover { background: #ef4444; }
    .yt-drop-hint { font-size: 11px; color: #94a3b8; text-align: center; margin-top: auto; }
    .yt-cell.has-img .yt-drop-hint { opacity: .75; }
    .yt-dl { display: flex; align-items: center; justify-content: center; }
    .yt-dl-btn {
      background: #0ea5e9; color: #fff; border: none; border-radius: 8px;
      font-size: 12px; font-weight: 700; padding: 10px 12px; cursor: pointer; white-space: nowrap;
    }
    .yt-dl-btn:hover { background: #0284c7; }
    .yt-dl-btn:disabled { opacity: .4; cursor: not-allowed; }
    .yt-empty { padding: 40px 20px; text-align: center; color: var(--text-light, #94a3b8); font-size: 13px; }
    /* Yahoo用サムネタブでは検索/タグフィルタ行は使わないので隠す */
    body.yt-mode .search-row, body.yt-mode .filter-chip-row { display: none !important; }

    /* ===== Yahoo v1.0.0 ===== */
    /* 楽天版と並べて開いても取り違えないよう、ロゴの横に「Yahoo!ショッピング版」バッジ */
    /* Yahoo v1.0.2: ロゴの右上 (「Gallery」の上) に重ね、右端を「Gallery」の文字の右端に揃える。
       logo-header.png は右側に透明な余白が画像幅の約23.2% (720px中167px) あるので、その分だけ内側に寄せる。
       ヘッダーの横幅を使わない＝ボタンが押し出されない */
    .mall-badge {
      position: absolute; right: 23.2%; top: -9px; padding: 1px 7px;
      border-radius: 999px; background: #ff0033; color: #fff; font-size: 10px; font-weight: 700;
      line-height: 1.5; letter-spacing: .02em; white-space: nowrap; cursor: default; pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,.15);
    }
    .app-header .logo { position: relative; }
    .toast { max-width: min(720px, calc(100vw - 32px)); line-height: 1.6; cursor: pointer; text-align: left; }
    .yimp-price { color: var(--text-light, #94a3b8); margin-left: 6px; font-size: 12px; }
    /* 商品取り込み確認画面 */
    .yimp-source {
      background: var(--bg, #f8fafc); border: 1px solid var(--border, #e5e7eb); border-radius: 8px;
      padding: 10px 12px; margin-bottom: 12px; font-size: 13px; line-height: 1.7;
    }
    .yimp-warn {
      margin-top: 6px; padding: 6px 10px; border-radius: 6px; background: #fef3c7; color: #92400e; font-size: 12px;
    }
  `;
  document.head.appendChild(st);
}

// Yahoo v1.0.0: 楽天版と取り違えないためのバッジ (タブのタイトルにも付ける)
function injectMallBadge() {
  const logo = document.querySelector('.app-header .logo');
  if (logo && !document.getElementById('mallBadge')) {
    const b = document.createElement('span');
    b.id = 'mallBadge';
    b.className = 'mall-badge';
    b.textContent = 'Yahoo!ショッピング版';
    logo.appendChild(b);
  }
  if (!/Yahoo/.test(document.title)) document.title = 'ImageGallery Yahoo';
}

// v1.11.15: 保存済みの列幅を grid-template-columns として動的適用
function applyColWidths() {
  let st = document.getElementById('colWidthStyles');
  if (!st) { st = document.createElement('style'); st.id = 'colWidthStyles'; document.head.appendChild(st); }
  const n = colWidths.number, m = colWidths.manage, nm = colWidths.name, a = colWidths.actions;
  st.textContent = `
    .product-table-header.mode-images,
    .product-row.mode-images { grid-template-columns: ${n}px ${m}px ${nm}px minmax(0, 1fr) ${a}px; }
    .product-table-header.mode-images.with-export,
    .product-row.mode-images.with-export { grid-template-columns: 40px ${n}px ${m}px ${nm}px minmax(0, 1fr) ${a}px; }
  `;
}

function saveColWidths() {
  try { localStorage.setItem(LS_COL_WIDTHS, JSON.stringify(colWidths)); } catch (e) { /* ignore */ }
}

// v1.11.15: 上部ツールバーに「項目管理」ボタンを差し込む (商品名称一括更新の左)
function injectColManageButton() {
  if (document.getElementById('btnColManage')) return;
  const ref = document.getElementById('btnImportCsv');
  if (!ref || !ref.parentNode) return;
  const btn = document.createElement('button');
  btn.id = 'btnColManage';
  btn.className = 'btn-icon';
  btn.title = '列の幅を調整 (境界をドラッグ)';
  btn.innerHTML = '<span class="icon">📐</span><span class="label">列幅調整</span>';
  btn.addEventListener('click', toggleColResizeMode);
  ref.parentNode.insertBefore(btn, ref);
}

// v1.11.15: 現役タブを「選択分」に改称
function relabelCategoryTabs() {
  const pb = document.querySelector('.cat-btn[data-cat="product"]');
  if (pb && pb.firstChild && pb.firstChild.nodeType === 3) pb.firstChild.nodeValue = '商品(選択分)';
}

// v1.11.19: 「商品(未選択分)」タブを 選択分 と 全体 の間に追加 (全画像がタグ無しの商品)
function injectUntaggedTab() {
  if (document.querySelector('.cat-btn[data-cat="product_untagged"]')) return;
  const allBtn = document.querySelector('.cat-btn[data-cat="product_all"]');
  if (!allBtn || !allBtn.parentNode) return;
  const btn = document.createElement('button');
  btn.className = 'cat-btn';
  btn.dataset.cat = 'product_untagged';
  btn.textContent = '商品(未選択分)';
  btn.addEventListener('click', () => {
    currentCategory = 'product_untagged';
    localStorage.setItem(LS_CURRENT_CAT, 'product_untagged');
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
  allBtn.parentNode.insertBefore(btn, allBtn);
}

// v1.11.19: 読み込み時のカテゴリに合わせてタブの active 状態を同期
function syncCategoryActiveTab() {
  document.querySelectorAll('.cat-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cat === currentCategory));
}

// 商品の全画像がタグ無しか (未選択分の判定)
function isUntaggedProduct(p) {
  return !(p.images || []).some(im => im.tagId);
}

// ===== v1.11.22: 分類タグ管理 (並び替え / 色編集 / 追加 / 削除) =====
function injectTagManagerButton() {
  if (document.getElementById('btnTagManager')) return;
  const ref = document.getElementById('btnColManage') || document.getElementById('btnImportCsv');
  if (!ref || !ref.parentNode) return;
  const btn = document.createElement('button');
  btn.id = 'btnTagManager';
  btn.className = 'btn-icon';
  btn.title = '分類タグの並び替え・色・追加';
  btn.innerHTML = '<span class="icon">🏷️</span><span class="label">タグ編集</span>';
  btn.addEventListener('click', openTagManager);
  ref.parentNode.insertBefore(btn, ref);
}

function ensureTagManagerModal() {
  if (document.getElementById('tagMgrModal')) return;
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.id = 'tagMgrModal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>分類タグの管理</h2>
        <button class="btn-close" data-tagmgr-close aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="tagmgr-hint">▲▼で並び替え / 色をクリックで変更 / 名前は直接編集できます。</div>
        <div id="tagMgrList"></div>
        <div class="tagmgr-add-row">
          <input type="text" id="tagMgrNewName" placeholder="新しいタグ名を入力">
          <div id="tagMgrNewColors" class="tagmgr-colors"></div>
          <button class="btn-secondary btn-mini" id="tagMgrAddBtn">+ 追加</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" data-tagmgr-close>キャンセル</button>
        <button class="btn-primary" id="tagMgrSaveBtn">保存</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-tagmgr-close]').forEach(b => b.addEventListener('click', closeTagManager));
  m.querySelector('#tagMgrAddBtn').addEventListener('click', tagMgrAdd);
  m.querySelector('#tagMgrSaveBtn').addEventListener('click', saveTagManager);
  const list = m.querySelector('#tagMgrList');
  list.addEventListener('click', (e) => {
    const up = e.target.closest('[data-tm-up]'); if (up) { tagMgrMove(+up.dataset.tmUp, -1); return; }
    const dn = e.target.closest('[data-tm-down]'); if (dn) { tagMgrMove(+dn.dataset.tmDown, 1); return; }
    const del = e.target.closest('[data-tm-del]'); if (del) { tagMgrDelete(+del.dataset.tmDel); return; }
    const dot = e.target.closest('[data-tm-color]'); if (dot) { const [i, c] = dot.dataset.tmColor.split(':'); _tagMgr.list[+i].color = c; renderTagManagerList(); return; }
  });
  list.addEventListener('input', (e) => {
    const nm = e.target.closest('[data-tm-name]'); if (nm) { _tagMgr.list[+nm.dataset.tmName].name = nm.value; }
  });
}

function openTagManager() {
  if (!currentShopId || !dataCache[currentShopId]) { toast('ショップが選択されていません', 'error'); return; }
  ensureTagManagerModal();
  const favId = getFavoriteTagId();
  const classTags = getCurrentTags().filter(t => t.id !== favId);
  _tagMgr = {
    list: classTags.map(t => ({ id: t.id, name: t.name, color: t.color || 'gray' })),
    originalIds: classTags.map(t => t.id),
    newColor: 'blue',
  };
  renderTagManagerList();
  renderTagMgrNewColors();
  document.getElementById('tagMgrModal').style.display = 'flex';
}

function closeTagManager() {
  const m = document.getElementById('tagMgrModal');
  if (m) m.style.display = 'none';
  _tagMgr = null;
}

function renderTagManagerList() {
  const wrap = document.getElementById('tagMgrList');
  if (!wrap || !_tagMgr) return;
  const last = _tagMgr.list.length - 1;
  wrap.innerHTML = _tagMgr.list.map((t, i) => {
    const col = getTagColor(t.color);
    const dots = TAG_COLORS.map(c => `<span class="tagmgr-dot ${c.id === t.color ? 'sel' : ''}" data-tm-color="${i}:${c.id}" style="background:${c.bg}" title="${c.id}"></span>`).join('');
    return `<div class="tagmgr-row">
      <div class="tagmgr-reorder">
        <button type="button" data-tm-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" data-tm-down="${i}" ${i === last ? 'disabled' : ''}>▼</button>
      </div>
      <span class="tagmgr-preview" style="background:${col.bg};color:${col.fg}">${escapeHtml(t.name || '（名称）')}</span>
      <input type="text" class="tagmgr-name" data-tm-name="${i}" value="${escapeHtml(t.name)}">
      <div class="tagmgr-colors">${dots}</div>
      <button type="button" class="tagmgr-del" data-tm-del="${i}" title="削除">🗑</button>
    </div>`;
  }).join('') || '<div class="tagmgr-hint">タグがありません。下から追加してください。</div>';
}

function renderTagMgrNewColors() {
  const wrap = document.getElementById('tagMgrNewColors');
  if (!wrap || !_tagMgr) return;
  wrap.innerHTML = TAG_COLORS.map(c => `<span class="tagmgr-dot ${c.id === _tagMgr.newColor ? 'sel' : ''}" data-tm-newcolor="${c.id}" style="background:${c.bg}" title="${c.id}"></span>`).join('');
  wrap.querySelectorAll('[data-tm-newcolor]').forEach(d =>
    d.addEventListener('click', () => { _tagMgr.newColor = d.dataset.tmNewcolor; renderTagMgrNewColors(); }));
}

function tagMgrMove(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _tagMgr.list.length) return;
  const tmp = _tagMgr.list[i]; _tagMgr.list[i] = _tagMgr.list[j]; _tagMgr.list[j] = tmp;
  renderTagManagerList();
}
function tagMgrDelete(i) {
  const t = _tagMgr.list[i];
  if (!t) return;
  if (!confirm(`タグ「${t.name}」を削除します。よろしいですか?\n(このタグを付けた画像はタグなしに戻ります)`)) return;
  _tagMgr.list.splice(i, 1);
  renderTagManagerList();
}
function tagMgrAdd() {
  const input = document.getElementById('tagMgrNewName');
  const name = (input.value || '').trim();
  if (!name) { toast('タグ名を入力してください', 'error'); return; }
  if (_tagMgr.list.some(t => t.name === name)) { toast('同じ名前のタグが既にあります', 'error'); return; }
  _tagMgr.list.push({ id: 'tag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name, color: _tagMgr.newColor });
  input.value = '';
  renderTagManagerList();
}

async function saveTagManager() {
  const data = dataCache[currentShopId];
  if (!data || !_tagMgr) return;
  const names = _tagMgr.list.map(t => (t.name || '').trim());
  if (names.some(n => !n)) { toast('空のタグ名があります', 'error'); return; }
  if (new Set(names).size !== names.length) { toast('同じ名前のタグが重複しています', 'error'); return; }

  const favId = getFavoriteTagId();
  const favTag = getCurrentTags().find(t => t.id === favId);
  const keepIds = new Set(_tagMgr.list.map(t => t.id));
  const deletedIds = _tagMgr.originalIds.filter(id => !keepIds.has(id));

  const newTags = _tagMgr.list.map(t => {
    const existing = getCurrentTags().find(x => x.id === t.id);
    return { id: t.id, name: t.name.trim(), color: t.color || 'gray', createdAt: (existing && existing.createdAt) || new Date().toISOString() };
  });
  if (favTag) newTags.push(favTag);

  // 削除タグを画像から除去 (失敗時に戻せるよう記録)
  const removed = [];
  if (deletedIds.length) {
    const delSet = new Set(deletedIds);
    (data.products || []).forEach(p => (p.images || []).forEach(im => {
      if (im.tagId && delSet.has(im.tagId)) { removed.push({ im, tagId: im.tagId }); delete im.tagId; }
    }));
    deletedIds.forEach(id => filterTagIds.delete(id));
  }

  const backup = data.tags;
  data.tags = newTags;
  try {
    await saveShopData(currentShopId, 'edit tags (order/color/add/delete)');
    closeTagManager();
    renderTagFilterInline();
    render();
    toast('タグを保存しました', 'success');
  } catch (e) {
    data.tags = backup;
    removed.forEach(r => { r.im.tagId = r.tagId; });
    toast('保存失敗: ' + e.message, 'error');
  }
}

// ===== v1.11.25: ショップ共有 (共有コードの発行 / 読み込み) =====
function _b64encUtf8(str) { return btoa(String.fromCharCode.apply(null, Array.from(new TextEncoder().encode(str)))); }
function _b64decUtf8(b) { return new TextDecoder().decode(Uint8Array.from(atob(b.trim()), c => c.charCodeAt(0))); }

function injectShareButton() {
  if (document.getElementById('btnShareShop')) return;
  const ref = document.getElementById('btnTagManager') || document.getElementById('btnColManage') || document.getElementById('btnImportCsv');
  if (!ref || !ref.parentNode) return;
  const btn = document.createElement('button');
  btn.id = 'btnShareShop';
  btn.className = 'btn-icon';
  btn.title = 'このショップを他の人と共有';
  btn.innerHTML = '<span class="icon">🔗</span><span class="label">共有</span>';
  btn.addEventListener('click', openShareModal);
  ref.parentNode.insertBefore(btn, ref);
}

function ensureShareModal() {
  if (document.getElementById('shareModal')) return;
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.id = 'shareModal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>ショップを共有</h2>
        <button class="btn-close" data-share-close aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="share-sec">
          <div class="share-label">① このショップの共有コード</div>
          <textarea id="shareCodeOut" readonly rows="3" onclick="this.select()"></textarea>
          <button class="btn-secondary btn-mini" id="shareCopyBtn">コピー</button>
          <div class="tagmgr-hint">相手にこのコードを渡してください。相手はこのサイトを開いて②の欄に貼り「読み込む」を押すと、同じ画像が見られます（公開リポジトリなので閲覧にPATは不要です）。</div>
        </div>
        <div class="share-sec">
          <div class="share-label">② 共有コードから読み込む</div>
          <textarea id="shareCodeIn" rows="3" placeholder="受け取った共有コードをここに貼り付け"></textarea>
          <button class="btn-primary btn-mini" id="shareImportBtn">読み込む</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-share-close]').forEach(b => b.addEventListener('click', () => { m.style.display = 'none'; }));
  m.querySelector('#shareCopyBtn').addEventListener('click', shareCopyCode);
  m.querySelector('#shareImportBtn').addEventListener('click', importShareCode);
}

function openShareModal() {
  ensureShareModal();
  const m = document.getElementById('shareModal');
  const out = document.getElementById('shareCodeOut');
  const shop = (typeof getCurrentShop === 'function') ? getCurrentShop() : (shops.find(s => s.id === currentShopId) || null);
  if (shop && auth.owner && auth.repo) {
    out.value = _b64encUtf8(JSON.stringify({
      v: 1, id: shop.id, owner: auth.owner, repo: auth.repo, branch: auth.branch || 'main',
      name: shop.name || '', mall: shop.mall || 'yahoo', shopCode: shop.shopCode || ''
    }));
  } else {
    out.value = '（共有できるショップがありません。⚙️設定でショップを登録してください）';
  }
  document.getElementById('shareCodeIn').value = '';
  m.style.display = 'flex';
}

function shareCopyCode() {
  const out = document.getElementById('shareCodeOut');
  const text = out.value;
  const done = () => toast('共有コードをコピーしました', 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { out.select(); document.execCommand('copy'); done(); });
  } else {
    out.select(); document.execCommand('copy'); done();
  }
}

function importShareCode() {
  const raw = (document.getElementById('shareCodeIn').value || '').trim();
  if (!raw) { toast('共有コードを貼り付けてください', 'error'); return; }
  let d;
  try { d = JSON.parse(_b64decUtf8(raw)); } catch (e) { toast('共有コードが正しくありません', 'error'); return; }
  if (!d || !d.id || !d.owner || !d.repo) { toast('共有コードが正しくありません', 'error'); return; }
  const a = JSON.parse(localStorage.getItem(LS_AUTH) || '{}');
  a.owner = d.owner; a.repo = d.repo; a.branch = d.branch || 'main';
  if (typeof a.pat !== 'string') a.pat = ''; // 閲覧はPAT不要
  a.shops = Array.isArray(a.shops) ? a.shops : [];
  const shopObj = { id: d.id, name: d.name || '共有ショップ', mall: d.mall || 'yahoo', shopCode: d.shopCode || '', appId: '', accessKey: '' };
  const idx = a.shops.findIndex(s => s.id === d.id);
  if (idx >= 0) a.shops[idx] = shopObj; else a.shops.push(shopObj);
  localStorage.setItem(LS_AUTH, JSON.stringify(a));
  localStorage.setItem(LS_CURRENT_SHOP, d.id);
  toast('読み込みました。ページを再読み込みします…', 'success');
  setTimeout(() => location.reload(), 700);
}

// ===== v1.11.27: 最新データの自動反映 (リロード不要) =====
// データの軽量シグネチャ (商品数/画像数/タグ付き数/sha/タグ構成) で変化を検知
// v1.11.37: データの内訳スナップショット (同期履歴の差分計算用)
function _syncSnapshot(d) {
  if (!d) return null;
  const products = d.products || [];
  let images = 0;
  products.forEach(p => { images += (p.images || []).length; });
  let ytRows = 0, ytImgs = 0;
  (d.yahooThumbs || []).forEach(r => {
    ytRows++;
    ytImgs += (r.generated || []).length + (r.original || []).length + (r.materials || []).length;
  });
  return { products: products.length, images, tags: (d.tags || []).length, ytRows, ytImgs };
}

const SYNC_DIFF_LABELS = {
  products: ['商品', '件'],
  images:   ['画像', '枚'],
  tags:     ['タグ', '個'],
  ytRows:   ['サムネ台', '行'],
  ytImgs:   ['サムネ台画像', '枚']
};

function _syncDiff(a, b) {
  const out = {};
  if (!a || !b) return out;
  Object.keys(SYNC_DIFF_LABELS).forEach(k => {
    const v = (b[k] || 0) - (a[k] || 0);
    if (v !== 0) out[k] = v;
  });
  return out;
}

function loadSyncLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SYNC_LOG) || '[]');
    if (Array.isArray(raw)) syncLog = raw;
  } catch (e) { syncLog = []; }
}

// ===== v1.11.40: 診断ログ =====
// 認証情報は絶対に残さない。PAT / accessKey / Authorizationトークンは伏せ字にする。
function maskSecrets(text) {
  let s = String(text == null ? '' : text);
  try {
    s = s
      .replace(/(accessKey=)[^&\s"']+/gi, '$1***')
      .replace(/(appid=)[^&\s"']+/gi, '$1***')                    // Yahoo Client ID
      .replace(/(applicationId=)([^&\s"']{0,8})[^&\s"']*/gi, '$1$2***')
      .replace(/\bpk_[A-Za-z0-9_-]+/g, 'pk_***')
      .replace(/\bgh[pousr]_[A-Za-z0-9_-]+/g, 'ghp_***')
      .replace(/\bgithub_pat_[A-Za-z0-9_-]+/g, 'github_pat_***')
      .replace(/(token\s+)[A-Za-z0-9_-]+/gi, '$1***')
      .replace(/("?(?:pat|accessKey|token|appid|clientId|YAHOO_CLIENT_ID)"?\s*[:=]\s*")[^"]+(")/gi, '$1***$2');
    // 念のため、設定中の実値そのものが混じっていたら消す
    if (auth && auth.pat && auth.pat.length > 6) s = s.split(auth.pat).join('***');
    (shops || []).forEach(sh => {
      if (sh && sh.accessKey && sh.accessKey.length > 6) s = s.split(sh.accessKey).join('***');
      if (sh && sh.appId && sh.appId.length > 6) s = s.split(sh.appId).join('***');
    });
  } catch (e) { /* マスク中の例外でログ自体を落とさない */ }
  return s;
}

function logEvent(level, msg) {
  const text = maskSecrets(msg).slice(0, DIAG_MSG_MAX);
  diagLog.push({ at: Date.now(), level, msg: text });
  if (diagLog.length > DIAG_LOG_MAX) diagLog.splice(0, diagLog.length - DIAG_LOG_MAX);
  try { localStorage.setItem(LS_DIAG_LOG, JSON.stringify(diagLog)); } catch (e) { /* 容量超過は無視 */ }
  const badge = document.getElementById('diagCount');
  if (badge) renderDiagLog();
}

function loadDiagLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DIAG_LOG) || '[]');
    if (Array.isArray(raw)) diagLog = raw;
  } catch (e) { diagLog = []; }
}

function clearDiagLog() {
  diagLog = [];
  try { localStorage.removeItem(LS_DIAG_LOG); } catch (e) {}
  renderDiagLog();
  toast('ログを消去しました', 'success');
}

const _argToText = (a) => {
  if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch (e) { return String(a); }
};

// console / 未捕捉エラー / 失敗した通信 を拾う
function installDiagHooks() {
  if (_diagHooksInstalled) return;
  _diagHooksInstalled = true;

  ['error', 'warn'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try { logEvent(level, args.map(_argToText).join(' ')); } catch (e) {}
      orig(...args);
    };
  });

  window.addEventListener('error', (e) => {
    logEvent('error', `未捕捉エラー: ${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    logEvent('error', `未処理のPromise拒否: ${_argToText(e.reason)}`);
  });

  // 失敗した通信だけ記録する (成功は量が多いので残さない)
  const _origFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const target = args[0];
    const url = (typeof target === 'string') ? target : (target && target.url) || '';
    try {
      const res = await _origFetch(...args);
      if (!res.ok) logEvent('warn', `HTTP ${res.status} ${url}`);
      return res;
    } catch (err) {
      logEvent('error', `通信失敗 ${url}: ${err && err.message}`);
      throw err;
    }
  };
}

// mode: 'initial'(起動時) | 'manual'(更新ボタン) | 'auto'(自動更新)
function recordSync(mode, prevSnap, nextSnap, opts = {}) {
  const diff = _syncDiff(prevSnap, nextSnap);
  syncLog.unshift({
    at: Date.now(),
    shopId: currentShopId,
    mode,
    failed: !!opts.failed,
    note: opts.note || '',
    changed: Object.keys(diff).length > 0,
    diff,
    total: nextSnap || null
  });
  if (syncLog.length > SYNC_LOG_MAX) syncLog.length = SYNC_LOG_MAX;
  try { localStorage.setItem(LS_SYNC_LOG, JSON.stringify(syncLog)); } catch (e) { /* 容量超過などは無視 */ }
}

function _fmtClock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function _fmtAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}

function _fmtDiff(entry) {
  if (entry.failed) return entry.note || '取得失敗';
  const keys = Object.keys(entry.diff || {});
  if (keys.length === 0) return '変更なし';
  return keys.map(k => {
    const [label, unit] = SYNC_DIFF_LABELS[k];
    const v = entry.diff[k];
    return `${label} ${v > 0 ? '+' : ''}${v}${unit}`;
  }).join(' / ');
}

const SYNC_MODE_LABEL = { initial: '起動時', manual: '手動', auto: '自動' };

function _dataSig(d) {
  if (!d) return '';
  let imgs = 0, tagged = 0;
  (d.products || []).forEach(p => { const a = p.images || []; imgs += a.length; a.forEach(im => { if (im.tagId) tagged++; }); });
  const tagsSig = (d.tags || []).map(t => t.id + t.name + t.color).join(',');
  // v1.11.35: Yahoo用サムネの行数・画像枚数も差分検知に含める
  let ytRows = 0, ytImgs = 0;
  (d.yahooThumbs || []).forEach(r => {
    ytRows++;
    ytImgs += (r.generated || []).length + (r.original || []).length + (r.materials || []).length;
  });
  return `${(d.products || []).length}|${imgs}|${tagged}|${d.sha || ''}|${tagsSig}|${ytRows}|${ytImgs}`;
}

// 現在のショップデータを再取得し、変化があれば表示を更新 (フィルタ/カテゴリ/スクロールは維持)
async function refreshCurrentShopData(opts = {}) {
  const manual = !!opts.manual;
  if (!currentShopId || !auth.owner || !auth.repo) return;
  if (!manual) {
    if (document.hidden) return;
    const lb = document.getElementById('lightbox');
    if (lb && lb.classList.contains('open')) return;         // 拡大表示中は邪魔しない
    if (document.querySelector('.modal-backdrop[style*="flex"]')) return; // モーダル操作中はスキップ
  }
  // v1.11.28: 公開ファイル(raw)を直読み。GitHub Contents APIを使わないのでレート制限に当たらない。
  const mode = manual ? 'manual' : 'auto';   // v1.11.37: 同期履歴の種別
  const fresh = await loadShopDataRaw(currentShopId);

  // 🚨 失敗/空/破損のときは絶対に置き換えない (既存の表示を維持) → 「更新の度に消える」を防止
  if (!fresh || fresh._wasEmpty || fresh._parseError || fresh._loadFailed) {
    recordSync(mode, null, null, { failed: true, note: '取得失敗（通信エラー／データが空・破損）' });
    if (manual) toast('更新できませんでした（通信状況を確認してください）', 'error');
    return;
  }
  const prev = dataCache[currentShopId];
  // 安全策: 既存が非空なのに取得0件なら異常とみなして置き換えない
  if (prev && (prev.products || []).length > 0 && (fresh.products || []).length === 0) {
    recordSync(mode, null, null, { failed: true, note: '取得0件のため中止（既存データを保護）' });
    if (manual) toast('更新できませんでした（データが取得できませんでした）', 'error');
    return;
  }

  const prevSnap = _syncSnapshot(prev);
  const freshSnap = _syncSnapshot(fresh);

  if (!manual && prev && _dataSig(fresh) === _dataSig(prev)) {
    recordSync(mode, prevSnap, freshSnap);   // 変更なしも「取得できた」記録として残す
    return;                                   // 変化なし → 画面は触らない
  }

  recordSync(mode, prevSnap, freshSnap);
  const sy = window.scrollY;
  dataCache[currentShopId] = fresh;
  render();                       // filterTagIds等はメモリ保持なので選択は維持される
  window.scrollTo(0, sy);
  toast(manual ? '最新の内容に更新しました' : '新しい内容に更新しました', 'success');
}

// 閲覧者(PATなし)は一定間隔で自動更新。編集者は自分が更新元なので自動更新しない。
function startAutoRefresh() {
  if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  if (auth.pat) return;
  _autoRefreshTimer = setInterval(() => { refreshCurrentShopData(); }, 15000);
  // タブに戻ってきた時にも即更新
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !auth.pat) refreshCurrentShopData(); });
}

// v1.11.31: 「商品名称一括更新」モーダル内に「基礎情報DL」と「ドラッグ&ドロップ」を①②として用意
function setupCsvModalExtras() {
  const modal = document.getElementById('csvImportModal');
  if (!modal) return;
  const body = modal.querySelector('.modal-body');
  const dz = document.getElementById('csvDropzone');
  if (!body || !dz || document.getElementById('btnExportCsvInModal')) return;

  // ① 基礎情報DL セクション (dropzoneの前に挿入)
  const dlSec = document.createElement('div');
  dlSec.className = 'csv-step';
  dlSec.innerHTML = `
    <div class="csv-step-label">① 現在の基礎情報をダウンロード（編集用）</div>
    <button class="btn-secondary" id="btnExportCsvInModal">⬇️ 基礎情報DL（CSV）</button>
    <div class="csv-dropzone-hint" style="margin-top:6px">商品コード / 商品番号 / 商品名 の入ったCSVが保存されます。編集後、下の②へドラッグ＆ドロップしてください。</div>`;
  body.insertBefore(dlSec, dz);

  // ② アップロードの見出し (dropzoneの前に挿入)
  const upLabel = document.createElement('div');
  upLabel.className = 'csv-step-label';
  upLabel.textContent = '② 編集したCSVをドラッグ＆ドロップして一括更新';
  body.insertBefore(upLabel, dz);

  document.getElementById('btnExportCsvInModal').addEventListener('click', exportBasicInfoCsv);

  // 上部の「基礎情報DL」ボタンはモーダルに統合したので非表示
  const topExport = document.getElementById('btnExportCsv');
  if (topExport) topExport.style.display = 'none';
}

// v1.11.30: 「+ 追加」ボタンを上部ツールバーの ver と 更新 の間へ移動
function moveAddButton() {
  const addBtn = document.getElementById('btnAddEntry');
  const refreshBtn = document.getElementById('btnRefreshData');
  if (!addBtn || !refreshBtn || !refreshBtn.parentNode) return;
  refreshBtn.parentNode.insertBefore(addBtn, refreshBtn); // 更新の直前 = ver と 更新 の間
}

// ===== v1.11.33: 部品(単体で追加できるアイテム) =====
let _partFiles = [];

// 「部品」タブを 商品(全体) の右に追加
function injectPartsTab() {
  if (document.querySelector('.cat-btn[data-cat="parts"]')) return;
  const allBtn = document.querySelector('.cat-btn[data-cat="product_all"]');
  if (!allBtn || !allBtn.parentNode) return;
  const btn = document.createElement('button');
  btn.className = 'cat-btn';
  btn.dataset.cat = 'parts';
  btn.textContent = '部品';
  btn.addEventListener('click', () => {
    currentCategory = 'parts';
    localStorage.setItem(LS_CURRENT_CAT, 'parts');
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
  allBtn.parentNode.insertBefore(btn, allBtn.nextSibling); // 全体の右
}

// v1.11.34: 「商品(未設定)」タブを 商品(全体) と 部品 の間に追加
// 画像が一切登録されていない商品だけを表示する
function injectNoImageTab() {
  if (document.querySelector('.cat-btn[data-cat="product_noimage"]')) return;
  const allBtn = document.querySelector('.cat-btn[data-cat="product_all"]');
  if (!allBtn || !allBtn.parentNode) return;
  const btn = document.createElement('button');
  btn.className = 'cat-btn';
  btn.dataset.cat = 'product_noimage';
  btn.textContent = '商品(未設定)';
  btn.addEventListener('click', () => {
    currentCategory = 'product_noimage';
    localStorage.setItem(LS_CURRENT_CAT, 'product_noimage');
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
  // 部品タブが既にあればその前に、無ければ全体の右に挿入 → 常に 全体 と 部品 の間
  const partsBtn = document.querySelector('.cat-btn[data-cat="parts"]');
  if (partsBtn && partsBtn.parentNode === allBtn.parentNode) {
    allBtn.parentNode.insertBefore(btn, partsBtn);
  } else {
    allBtn.parentNode.insertBefore(btn, allBtn.nextSibling);
  }
}

// =====================================================
// v1.11.35: Yahoo用サムネ (3列ボード)
//   タブ「Yahoo用サムネ」を 部品 の右に追加。
//   1行 = 生成画像 / もと画像 / 素材画像一覧 の3列。D&Dで画像を登録し、
//   行末の「一括DL」で3フォルダ入りのZIPを書き出す。
//   データは data.yahooThumbs[] として gallery.json に保存(全員で共有)。
// =====================================================
const YT_COLS = [
  { key: 'generated', label: '生成画像' },
  { key: 'original',  label: 'もと画像' },
  { key: 'materials', label: '素材画像一覧' }
];

function injectYahooThumbTab() {
  if (document.querySelector('.cat-btn[data-cat="yahoo_thumb"]')) return;
  const partsBtn = document.querySelector('.cat-btn[data-cat="parts"]');
  const allBtn = document.querySelector('.cat-btn[data-cat="product_all"]');
  const anchor = partsBtn || allBtn;
  if (!anchor || !anchor.parentNode) return;
  const btn = document.createElement('button');
  btn.className = 'cat-btn';
  btn.dataset.cat = 'yahoo_thumb';
   btn.textContent = 'サムネ台';
  btn.addEventListener('click', () => {
    currentCategory = 'yahoo_thumb';
    localStorage.setItem(LS_CURRENT_CAT, 'yahoo_thumb');
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
  anchor.parentNode.insertBefore(btn, anchor.nextSibling); // 部品の右
}

function ytGetRows() {
  const data = dataCache[currentShopId];
  if (!data) return [];
  if (!Array.isArray(data.yahooThumbs)) data.yahooThumbs = [];
  return data.yahooThumbs;
}

function ytFindRow(rowId) {
  return ytGetRows().find(r => r.id === rowId) || null;
}

function ytRowImages(row, key) {
  if (!Array.isArray(row[key])) row[key] = [];
  return row[key];
}

function ytCellHtml(row, colKey) {
  const imgs = ytRowImages(row, colKey);
  const thumbs = imgs.map(im => `
      <div class="yt-thumb" data-yt-view="${escapeHtml(im.url || '')}">
        <img src="${escapeHtml(im.url || '')}" alt="" loading="lazy">
        <button type="button" class="yt-thumb-x" data-yt-del="${row.id}::${colKey}::${im.id}" title="この画像を削除">×</button>
      </div>`).join('');
  const hint = colKey === 'materials'
    ? '＋ ドロップ / クリック（複数可）'
    : '＋ ドロップ / クリック';
  return `<div class="yt-cell${imgs.length ? ' has-img' : ''}${colKey === 'materials' ? ' yt-cell-multi' : ''}" data-yt-drop="${row.id}::${colKey}">
      <div class="yt-thumbs">${thumbs}</div>
      <div class="yt-drop-hint">${hint}</div>
    </div>`;
}

function renderYahooThumbBoard() {
  const content = document.getElementById('content');
  if (!content) return;
  const rows = ytGetRows();
  const canEdit = !!auth.pat;

  let body = '';
  if (rows.length === 0) {
    body = `<div class="yt-empty">まだ行がありません。「＋ 行追加」を押して1行目を作ってください。</div>`;
  } else {
    body = rows.map((row, idx) => {
      const total = YT_COLS.reduce((n, c) => n + ytRowImages(row, c.key).length, 0);
      return `<div class="yt-row" data-yt-row="${row.id}">
        <div class="yt-col yt-no">
          <span class="yt-no-badge">#${idx + 1}</span>
          <input type="text" class="yt-name-input" data-yt-name="${row.id}" value="${escapeHtml(row.name || '')}" placeholder="行の名前（任意）">
          <button type="button" class="yt-row-del" data-yt-rowdel="${row.id}">行を削除</button>
        </div>
        <div class="yt-col">${ytCellHtml(row, 'generated')}</div>
        <div class="yt-col">${ytCellHtml(row, 'original')}</div>
        <div class="yt-col">${ytCellHtml(row, 'materials')}</div>
        <div class="yt-col yt-dl">
          <button type="button" class="yt-dl-btn" data-yt-dl="${row.id}" ${total ? '' : 'disabled'} title="この行の画像をZIPでまとめてダウンロード">⬇ 一括DL</button>
        </div>
      </div>`;
    }).join('');
  }

  content.innerHTML = `<div class="yt-board">
    <div class="yt-toolbar">
      <button type="button" class="yt-add-row" id="ytAddRow" ${canEdit ? '' : 'disabled'}>＋ 行追加</button>
      <span class="yt-hint">${canEdit
        ? '各セルに画像をドラッグ＆ドロップ（またはクリックで選択）。素材画像一覧は複数枚OK。右端の「一括DL」で 生成画像 / もと画像 / 素材画像一覧 の3フォルダ入りZIPを保存します。'
        : '閲覧のみ（追加・削除には編集権限(PAT)が必要です）。「一括DL」は誰でも使えます。'}</span>
    </div>
    <div class="yt-table">
      <div class="yt-head">
        <div class="yt-th yt-th-no">行</div>
        <div class="yt-th">生成画像</div>
        <div class="yt-th">もと画像</div>
        <div class="yt-th">素材画像一覧</div>
        <div class="yt-th yt-th-dl">ダウンロード</div>
      </div>
      ${body}
    </div>
  </div>`;

  bindYahooThumbEvents(content);
}

function bindYahooThumbEvents(content) {
  const addBtn = content.querySelector('#ytAddRow');
  if (addBtn) addBtn.addEventListener('click', ytAddRow);

  // 行の名前
  content.querySelectorAll('.yt-name-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const row = ytFindRow(inp.dataset.ytName);
      if (!row) return;
      if (!auth.pat) { toast('編集には編集権限(PAT)が必要です', 'error'); inp.value = row.name || ''; return; }
      row.name = inp.value.trim();
      try { await saveShopData(currentShopId, 'update yahoo thumb row name'); }
      catch (e) { toast('保存失敗: ' + e.message, 'error'); }
    });
  });

  // 行削除 / 一括DL
  content.querySelectorAll('[data-yt-rowdel]').forEach(b =>
    b.addEventListener('click', () => ytDeleteRow(b.dataset.ytRowdel)));
  content.querySelectorAll('[data-yt-dl]').forEach(b =>
    b.addEventListener('click', () => ytDownloadRowZip(b.dataset.ytDl)));

  // セル: クリックでファイル選択 / ドラッグ&ドロップ
  content.querySelectorAll('[data-yt-drop]').forEach(cell => {
    const [rowId, colKey] = cell.dataset.ytDrop.split('::');

    cell.addEventListener('click', (e) => {
      if (e.target.closest('.yt-thumb')) return;   // サムネ側の操作はここで処理しない
      ytPickFiles(rowId, colKey);
    });
    ['dragenter', 'dragover'].forEach(ev =>
      cell.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); cell.classList.add('yt-dragover'); }));
    ['dragleave', 'dragend'].forEach(ev =>
      cell.addEventListener(ev, () => cell.classList.remove('yt-dragover')));
    cell.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      cell.classList.remove('yt-dragover');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) ytUploadFiles(rowId, colKey, files);
    });
  });

  // サムネ: 拡大 / 削除
  content.querySelectorAll('[data-yt-del]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const [rowId, colKey, imgId] = b.dataset.ytDel.split('::');
      ytDeleteImage(rowId, colKey, imgId);
    }));
  content.querySelectorAll('[data-yt-view]').forEach(t =>
    t.addEventListener('click', (e) => {
      if (e.target.closest('.yt-thumb-x')) return;
      e.stopPropagation();
      const url = t.dataset.ytView;
      if (url) openLightbox(url);
    }));
}

async function ytAddRow() {
  if (!auth.pat) { toast('行の追加には編集権限(PAT)が必要です', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データが読み込まれていません', 'error'); return; }
  if (!Array.isArray(data.yahooThumbs)) data.yahooThumbs = [];
  data.yahooThumbs.push({
    id: 'yt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: '',
    createdAt: new Date().toISOString(),
    generated: [],
    original: [],
    materials: []
  });
  try {
    await saveShopData(currentShopId, 'add yahoo thumb row');
    render();
  } catch (e) {
    data.yahooThumbs.pop();
    toast('保存失敗: ' + e.message, 'error');
    render();
  }
}

function ytPickFiles(rowId, colKey) {
  if (!auth.pat) { toast('画像の追加には編集権限(PAT)が必要です', 'error'); return; }
  let inp = document.getElementById('ytFileInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'ytFileInput';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
  }
  inp.value = '';
  inp.onchange = () => {
    if (inp.files && inp.files.length) ytUploadFiles(rowId, colKey, inp.files);
  };
  inp.click();
}

async function ytUploadFiles(rowId, colKey, fileList) {
  if (!auth.pat) { toast('画像の追加には編集権限(PAT)が必要です', 'error'); return; }
  const row = ytFindRow(rowId);
  if (!row) { toast('対象の行が見つかりません', 'error'); return; }
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) { toast('画像ファイルをドロップしてください', 'error'); return; }

  const added = [];
  let fail = 0;
  showLoading(`画像をアップロード中... 0/${files.length}`);
  for (let i = 0; i < files.length; i++) {
    showLoading(`画像をアップロード中... ${i + 1}/${files.length}`);
    try {
      const meta = await uploadImageToGitHub(currentShopId, 'yahoo_' + rowId, files[i]);
      added.push(meta);
    } catch (e) {
      console.error('yahoo thumb upload failed', e);
      fail++;
    }
  }
  if (added.length === 0) { hideLoading(); toast('アップロードに失敗しました', 'error'); return; }

  ytRowImages(row, colKey).push(...added);
  try {
    await saveShopData(currentShopId, `add yahoo thumb images (${colKey})`);
    hideLoading();
    toast(`${added.length}枚を追加しました${fail ? ` / 失敗${fail}件` : ''}`, fail ? 'error' : 'success');
  } catch (e) {
    // 保存に失敗したらメモリ上も巻き戻す (表示とGitHubの食い違いを防ぐ)
    const arr = ytRowImages(row, colKey);
    added.forEach(m => { const i = arr.indexOf(m); if (i >= 0) arr.splice(i, 1); });
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
  render();
}

async function ytDeleteImage(rowId, colKey, imgId) {
  if (!auth.pat) { toast('削除には編集権限(PAT)が必要です', 'error'); return; }
  const row = ytFindRow(rowId);
  if (!row) return;
  const arr = ytRowImages(row, colKey);
  const idx = arr.findIndex(im => im.id === imgId);
  if (idx < 0) return;
  if (!confirm('この画像を削除しますか？')) return;
  const img = arr[idx];
  showLoading('画像を削除中...');
  try {
    await deleteImageFromGitHub(img);
    arr.splice(idx, 1);
    await saveShopData(currentShopId, 'delete yahoo thumb image');
    hideLoading();
    toast('削除しました', 'success');
  } catch (e) {
    hideLoading();
    toast('削除失敗: ' + e.message, 'error');
  }
  render();
}

async function ytDeleteRow(rowId) {
  if (!auth.pat) { toast('削除には編集権限(PAT)が必要です', 'error'); return; }
  const rows = ytGetRows();
  const idx = rows.findIndex(r => r.id === rowId);
  if (idx < 0) return;
  const row = rows[idx];
  const all = YT_COLS.flatMap(c => ytRowImages(row, c.key));
  if (!confirm(`この行を削除しますか？${all.length ? `\n画像${all.length}枚も一緒に削除されます。` : ''}`)) return;

  showLoading('行を削除中...');
  for (const img of all) {
    try { await deleteImageFromGitHub(img); }
    catch (e) { console.warn('yahoo thumb image delete failed', e); }
  }
  rows.splice(idx, 1);
  try {
    await saveShopData(currentShopId, 'delete yahoo thumb row');
    hideLoading();
    toast('行を削除しました', 'success');
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
  render();
}

// 行の3列を 生成画像/もと画像/素材画像一覧 の3フォルダに分けてZIP化
async function ytDownloadRowZip(rowId) {
  if (typeof JSZip === 'undefined') { toast('JSZipライブラリが読み込まれていません', 'error'); return; }
  const rows = ytGetRows();
  const idx = rows.findIndex(r => r.id === rowId);
  if (idx < 0) return;
  const row = rows[idx];

  const total = YT_COLS.reduce((n, c) => n + ytRowImages(row, c.key).length, 0);
  if (total === 0) { toast('この行には画像がありません', 'error'); return; }

  const zip = new JSZip();
  let ok = 0, fail = 0, processed = 0;
  showLoading(`画像を取得中... 0/${total}`);

  for (const col of YT_COLS) {
    const imgs = ytRowImages(row, col.key);
    const folder = zip.folder(col.label);
    const used = {};
    for (const img of imgs) {
      processed++;
      showLoading(`画像を取得中... ${processed}/${total}`);
      try {
        const res = await fetch(img.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // 同名ファイルが重なっても上書きされないように連番を足す
        const base = img.originalName || img.filename;
        const seen = used[base] || 0;
        used[base] = seen + 1;
        let name = base;
        if (seen > 0) {
          const m = base.match(/^(.*?)(\.[^.]+)?$/);
          name = `${m[1]}_${seen + 1}${m[2] || ''}`;
        }
        folder.file(name, blob);
        ok++;
      } catch (e) {
        console.error('yahoo thumb fetch failed', img.url, e);
        fail++;
      }
    }
  }

  showLoading('ZIPを生成中...');
  try {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const safeName = (row.name || `row${idx + 1}`).replace(/[\\/:*?"<>|]/g, '_');
    const filename = `yahoo_thumb_${safeName}_${stamp}.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    hideLoading();
    toast(`${ok}枚をダウンロードしました${fail ? ` / 失敗${fail}件` : ''}`, fail ? 'error' : 'success');
  } catch (e) {
    hideLoading();
    toast('ZIP生成失敗: ' + e.message, 'error');
  }
}

// 「+ 部品追加」ボタンを「+ 追加」の右に
function injectAddPartButton() {
  if (document.getElementById('btnAddPart')) return;
  const addBtn = document.getElementById('btnAddEntry');
  if (!addBtn || !addBtn.parentNode) return;
  const btn = document.createElement('button');
  btn.id = 'btnAddPart';
  btn.className = 'btn-add';
  btn.style.background = '#0ea5e9';
  btn.textContent = '+ 部品追加';
  btn.addEventListener('click', openAddPartModal);
  addBtn.parentNode.insertBefore(btn, addBtn.nextSibling); // +追加 の右
}

function ensureAddPartModal() {
  if (document.getElementById('addPartModal')) return;
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.id = 'addPartModal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>＋ 部品を追加</h2>
        <button class="btn-close" data-part-close aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label>部品名（任意）</label>
          <input type="text" id="partName" placeholder="例: ロゴ、飾り枠 など">
        </div>
        <div class="form-row">
          <label>分類タグ（どこに追加するか）</label>
          <select id="partTagSelect"></select>
        </div>
        <div class="form-row">
          <label>画像</label>
          <div class="csv-dropzone" id="partDropzone">
            <div class="csv-dropzone-icon">🖼️</div>
            <div class="csv-dropzone-text">画像をドラッグ＆ドロップ<br>または<button type="button" class="link-btn" id="partPickBtn">ファイルを選択</button></div>
          </div>
          <input type="file" id="partFileInput" accept="image/*" multiple style="display:none">
          <div id="partPreview" class="part-preview"></div>
        </div>
        <div id="partProgress" class="csv-dropzone-hint"></div>
        <div class="modal-actions">
          <button class="btn-secondary" data-part-close>キャンセル</button>
          <button class="btn-primary" id="partCreateBtn">追加する</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-part-close]').forEach(b => b.addEventListener('click', () => { m.style.display = 'none'; }));
  const fileInput = m.querySelector('#partFileInput');
  m.querySelector('#partPickBtn').addEventListener('click', () => fileInput.click());
  const dz = m.querySelector('#partDropzone');
  dz.addEventListener('click', (e) => { if (e.target.id !== 'partPickBtn') fileInput.click(); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    _partFiles.push(...files); renderPartPreview();
  });
  fileInput.addEventListener('change', (e) => {
    _partFiles.push(...Array.from(e.target.files).filter(f => f.type.startsWith('image/')));
    e.target.value = ''; renderPartPreview();
  });
  m.querySelector('#partCreateBtn').addEventListener('click', createPart);
}

function renderPartPreview() {
  const wrap = document.getElementById('partPreview');
  if (!wrap) return;
  wrap.innerHTML = _partFiles.map((f, i) =>
    `<div class="part-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="part-thumb-x" data-part-rm="${i}">×</button></div>`).join('');
  wrap.querySelectorAll('[data-part-rm]').forEach(b => b.addEventListener('click', () => {
    _partFiles.splice(+b.dataset.partRm, 1); renderPartPreview();
  }));
}

function openAddPartModal() {
  if (!currentShopId || !dataCache[currentShopId]) { toast('ショップが選択されていません', 'error'); return; }
  if (!auth.pat) { toast('部品の追加には編集権限(PAT)が必要です', 'error'); return; }
  ensureAddPartModal();
  const favId = getFavoriteTagId();
  const classTags = getCurrentTags().filter(t => t.id !== favId);
  const sel = document.getElementById('partTagSelect');
  sel.innerHTML = ['<option value="">タグなし</option>']
    .concat(classTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)).join('');
  document.getElementById('partName').value = '';
  _partFiles = [];
  renderPartPreview();
  document.getElementById('partProgress').textContent = '';
  document.getElementById('addPartModal').style.display = 'flex';
}

async function createPart() {
  if (!auth.pat) { toast('部品の追加には編集権限(PAT)が必要です', 'error'); return; }
  if (_partFiles.length === 0) { toast('画像を1枚以上選択してください', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) return;
  const name = (document.getElementById('partName').value || '').trim();
  const tagId = document.getElementById('partTagSelect').value || '';
  const partId = 'prod_part_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const part = {
    id: partId,
    isPart: true,
    itemManageNumber: 'part_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    itemNumber: name || '部品',
    itemName: name || '部品',
    images: [],
    syncedAt: new Date().toISOString()
  };
  let fail = 0;
  showLoading(`部品の画像をアップロード中… 0/${_partFiles.length}`);
  for (let i = 0; i < _partFiles.length; i++) {
    showLoading(`部品の画像をアップロード中… ${i + 1}/${_partFiles.length}`);
    try {
      const meta = await uploadImageToGitHub(currentShopId, partId, _partFiles[i]);
      if (tagId) meta.tagId = tagId;
      part.images.push(meta);
    } catch (e) { fail++; console.error('part image upload failed', e); }
  }
  if (part.images.length === 0) { hideLoading(); toast('画像のアップロードに失敗しました', 'error'); return; }
  data.products.push(part);
  showLoading('保存中…');
  try {
    await saveShopData(currentShopId, `add part: ${part.itemName}`);
  } catch (e) { hideLoading(); toast('保存失敗: ' + e.message, 'error'); return; }
  hideLoading();
  _partFiles = [];
  document.getElementById('addPartModal').style.display = 'none';
  // 部品タブへ移動して表示
  currentCategory = 'parts';
  localStorage.setItem(LS_CURRENT_CAT, 'parts');
  syncCategoryActiveTab();
  render();
  toast(`部品を追加しました${fail ? ` / 画像失敗${fail}件` : ''}`, fail ? 'error' : 'success');
}

// 上部ツールバーに「更新」ボタン (誰でも手動で最新化できる)
function injectRefreshButton() {
  if (document.getElementById('btnRefreshData')) return;
  const ref = document.getElementById('btnShareShop') || document.getElementById('btnTagManager') || document.getElementById('btnColManage') || document.getElementById('btnImportCsv');
  if (!ref || !ref.parentNode) return;
  const btn = document.createElement('button');
  btn.id = 'btnRefreshData';
  btn.className = 'btn-icon';
  btn.title = 'ダウンロード/アップロードを選ぶ';
  btn.innerHTML = '<span class="icon">🔄</span><span class="label">GitHub同期</span>';
  btn.addEventListener('click', openSyncModal);
  ref.parentNode.insertBefore(btn, ref);
}

// v1.11.37: ヘッダー右端の並び替えとラベル付け
// v1.11.41: 右端を「🔄 GitHub同期 → ＋部品追加 → ＋商品追加」の順に固定し、
//           「更新」→「GitHub同期」「+ 追加」→「＋ 商品追加」に改称する。
//   ⚠️ appendChild はノードの移動なので、bindEvents で付けたクリックハンドラは維持される。
//   ⚠️ moveAddButton() が「更新の直前」に +追加 を差し込むので、必ずその後に呼ぶこと。
function moveRefreshButtonToEnd() {
  const actions = document.querySelector('.header-actions');
  const st = document.getElementById('btnSettings');
  if (st && !st.dataset.labeled) {
    // クリックハンドラはボタン自身に付いているので、中身を差し替えても外れない
    st.innerHTML = '<span class="icon">⚙️</span><span class="label">設定</span>';
    st.dataset.labeled = '1';
  }

  const refresh = document.getElementById('btnRefreshData');
  if (refresh) {
    refresh.title = 'GitHubとの同期（ダウンロード/アップロード）と診断ログ';
    const lb = refresh.querySelector('.label');
    if (lb) lb.textContent = 'GitHub同期';
  }
  const addEntry = document.getElementById('btnAddEntry');
  if (addEntry) {
    addEntry.textContent = '＋ 商品追加';
    addEntry.title = '商品同期・画像の一括追加';
  }
  const addPart = document.getElementById('btnAddPart');

  // 左から 更新 → 部品追加 → 商品追加 の順に並べ直す (最後の子 = 一番右)
  [refresh, addPart, addEntry].forEach(b => { if (actions && b) actions.appendChild(b); });

  // v1.11.39: Application ID欄のサンプル表示が実在のUUIDだったため、本物と区別できず
  //   切り分けの妨げになっていた。明らかにダミーと分かる表記に差し替える。
  const appIdInput = document.getElementById('shopFormAppId');
  if (appIdInput) appIdInput.placeholder = '例: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  const akInput = document.getElementById('shopFormAccessKey');
  if (akInput) akInput.placeholder = '例: pk_xxxxxxxxxxxxxxxxxxxx';
}

// v1.11.37: 「📊」を ⚙️設定 の中へ移し、名称も「容量確認」にする
//   appendChild はノードの「移動」なので、bindEvents で付けたクリックハンドラは維持される。
function moveStorageButtonIntoSettings() {
  if (document.getElementById('storageSettingSection')) return;
  const btn = document.getElementById('btnStorage');
  const body = document.querySelector('#settingsModal .modal-body');
  if (!btn || !body) return;

  const sec = document.createElement('section');
  sec.className = 'setting-section';
  sec.id = 'storageSettingSection';
  sec.innerHTML = `
    <h3>📊 容量確認</h3>
    <p class="form-hint">リポジトリの使用容量と、画像の枚数・サイズの内訳を確認できます</p>`;

  btn.className = 'btn-secondary';
  btn.title = '容量確認';
  btn.textContent = '容量確認';
  sec.appendChild(btn);

  // 「🗑️ 画像キャッシュ」セクションの前に差し込む
  const cacheBtn = document.getElementById('btnClearImageCache');
  const cacheSec = cacheBtn ? cacheBtn.closest('.setting-section') : null;
  if (cacheSec) {
    body.insertBefore(sec, cacheSec);
  } else {
    const actions = body.querySelector('.modal-actions');
    if (actions) body.insertBefore(sec, actions); else body.appendChild(sec);
  }
}

// v1.11.32: 「更新」でダウンロード/アップロードを選べるモーダル
function ensureSyncModal() {
  if (document.getElementById('syncModal')) return;
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.id = 'syncModal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>🔄 データの同期</h2>
        <button class="btn-close" data-sync-close aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <button type="button" class="sync-opt" id="syncDownloadBtn">
          <div class="sync-opt-title">⬇️ ダウンロード（最新を取得）</div>
          <div class="sync-opt-meta" id="syncLastFetch"></div>
          <div class="sync-opt-desc">サーバー(GitHub)の最新の内容を、この画面に反映します。他の人の追加・変更を見たいときはこちら。</div>
        </button>
        <button type="button" class="sync-opt" id="syncUploadBtn">
          <div class="sync-opt-title">⬆️ アップロード（今の内容を保存）</div>
          <div class="sync-opt-desc">この画面の内容をサーバー(GitHub)に保存します。※通常は自動保存されます。編集権限(PAT)が必要です。</div>
        </button>
        <div class="diag-box">
          <div class="diag-head">
            <span class="diag-title">🩺 診断ログ <span id="diagCount" class="diag-count"></span></span>
            <span class="diag-actions">
              <button type="button" class="diag-btn primary" id="diagCopyBtn">📋 コピー（AIに貼る用）</button>
              <button type="button" class="diag-btn" id="diagClearBtn">消去</button>
            </span>
          </div>
          <div class="diag-list" id="diagList"></div>
          <div class="diag-note">エラー・警告・失敗した通信を記録します。コピーするとバージョンや件数などの状況も一緒に入ります。<strong>PATとClient IDは自動で伏せ字</strong>になります。</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-sync-close]').forEach(b => b.addEventListener('click', () => { m.style.display = 'none'; }));
  m.querySelector('#syncDownloadBtn').addEventListener('click', () => {
    m.style.display = 'none';
    refreshCurrentShopData({ manual: true });
  });
  m.querySelector('#syncUploadBtn').addEventListener('click', async () => {
    m.style.display = 'none';
    if (!auth.pat) { toast('アップロード（保存）には編集権限(PAT)が必要です', 'error'); return; }
    const data = dataCache[currentShopId];
    if (!data || data._wasEmpty || data._parseError || data._loadFailed) { toast('保存できる有効なデータがありません', 'error'); return; }
    showLoading('アップロード中… そのままお待ちください');
    try {
      await saveShopData(currentShopId, 'manual upload');
      toast('アップロードしました（保存完了）', 'success');
    } catch (e) {
      toast('保存失敗: ' + e.message, 'error');
    } finally {
      hideLoading();
    }
  });
}

function openSyncModal() {
  ensureSyncModal();
  // 閲覧者(PATなし)にはアップロードは不可なので薄く表示
  const up = document.getElementById('syncUploadBtn');
  if (up) up.style.opacity = auth.pat ? '1' : '0.5';
  renderSyncLastFetch();   // v1.11.37: ダウンロードボタン内の「最終取得」行を更新
  renderDiagLog();         // v1.11.40: 診断ログ
  const m = document.getElementById('syncModal');
  if (!m.dataset.diagBound) {
    m.dataset.diagBound = '1';
    m.querySelector('#diagCopyBtn').addEventListener('click', copyDiagnostics);
    m.querySelector('#diagClearBtn').addEventListener('click', clearDiagLog);
  }
  m.style.display = 'flex';
}

// v1.11.40: 診断ログの一覧を描画
function renderDiagLog() {
  const list = document.getElementById('diagList');
  const cnt = document.getElementById('diagCount');
  if (!list) return;
  if (cnt) cnt.textContent = diagLog.length ? `(${diagLog.length})` : '(0)';
  if (diagLog.length === 0) {
    list.innerHTML = '<div class="diag-empty">記録はありません（エラーが起きていない状態です）</div>';
    return;
  }
  list.innerHTML = diagLog.slice(-40).reverse().map(e => `
    <div class="diag-row ${e.level === 'error' ? 'err' : 'warn'}">
      <span class="diag-time">${_fmtClock(e.at).slice(5)}</span>
      <span class="diag-msg">${escapeHtml(e.msg)}</span>
    </div>`).join('');
}

// v1.11.40: 状況＋ログをまとめたテキストを作る (そのままAIに貼れる形)
function buildDiagnosticReport() {
  const shop = getCurrentShop();
  const data = dataCache[currentShopId];
  const snap = _syncSnapshot(data);
  const L = [];
  L.push('# ImageGallery 診断ログ');
  L.push('');
  L.push(`- 日時: ${_fmtClock(Date.now())}`);
  L.push(`- バージョン: ${APP_VERSION}`);
  L.push(`- URL: ${location.href}`);
  L.push(`- Yahoo API: ${YAHOO_API_LABEL}（GitHub Actions ${YAHOO_SYNC_WORKFLOW} 経由で取得）`);
  L.push(`- ブラウザ: ${navigator.userAgent}`);
  L.push('');
  L.push('## ショップ');
  if (shop) {
    L.push(`- 名前: ${shop.name || '(未設定)'}`);
    L.push(`- YahooストアID (seller_id): ${shop.shopCode || '(未設定)'}`);
    L.push(`- URL名: ?shop=${shopSlug(shop)}`);
    L.push(`- shopId: ${shop.id}`);
    L.push('- Yahoo Client ID: GitHub Secrets の YAHOO_CLIENT_ID を使用（ブラウザには保存しない）');
  } else {
    L.push('- 選択中のショップがありません');
  }
  L.push(`- GitHub: ${auth.owner || '?'}/${auth.repo || '?'} (${auth.branch || 'main'})`);
  L.push(`- PAT(編集権限): ${auth.pat ? 'あり' : 'なし（閲覧のみ）'}`);
  L.push(`- 登録ショップ数: ${(shops || []).length}`);
  L.push('');
  L.push('## データ');
  L.push(snap
    ? `- 商品 ${snap.products}件 / 画像 ${snap.images}枚 / タグ ${snap.tags}個 / サムネ台 ${snap.ytRows}行`
    : '- 未読み込み');
  L.push('');
  L.push('## Yahoo商品同期');
  L.push(...yahooDiagLines());
  if (data && (data._wasEmpty || data._parseError || data._loadFailed)) {
    L.push(`- ⚠️ 異常フラグ: wasEmpty=${!!data._wasEmpty} parseError=${!!data._parseError} loadFailed=${!!data._loadFailed}`);
  }
  L.push('');
  L.push('## 取得履歴（新しい順）');
  const mine = syncLog.filter(e => !e.shopId || e.shopId === currentShopId).slice(0, 10);
  if (mine.length === 0) L.push('- なし');
  mine.forEach(e => L.push(`- ${_fmtClock(e.at).slice(5)} [${SYNC_MODE_LABEL[e.mode] || e.mode}] ${_fmtDiff(e)}`));
  L.push('');
  L.push('## ログ（新しい順・最大40件）');
  if (diagLog.length === 0) L.push('- なし');
  diagLog.slice(-40).reverse().forEach(e =>
    L.push(`- ${_fmtClock(e.at).slice(5)} [${e.level}] ${e.msg}`));
  return maskSecrets(L.join('\n'));
}

async function copyDiagnostics() {
  const text = buildDiagnosticReport();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('診断ログをコピーしました。そのままAIに貼り付けてください', 'success');
      return;
    }
    throw new Error('clipboard unavailable');
  } catch (e) {
    // クリップボードが使えない環境では、選択済みのテキストエリアを出して手動コピーしてもらう
    let ta = document.getElementById('diagFallback');
    if (!ta) {
      ta = document.createElement('textarea');
      ta.id = 'diagFallback';
      ta.className = 'diag-fallback';
      document.getElementById('diagList').parentNode.appendChild(ta);
    }
    ta.value = text;
    ta.style.display = 'block';
    ta.select();
    toast('自動コピーできませんでした。下の枠の内容を Ctrl+C でコピーしてください', 'error');
  }
}

// v1.11.37: 「⬇️ ダウンロード」ボタンの中に「最終取得はいつ・手動か自動か・何が増減したか」を1行で出す
function renderSyncLastFetch() {
  const el = document.getElementById('syncLastFetch');
  if (!el) return;

  const mine = syncLog.filter(e => !e.shopId || e.shopId === currentShopId);
  const lastOk = mine.find(e => !e.failed);
  const lastAny = mine[0] || null;

  let html;
  if (!lastOk) {
    html = '<span class="sync-muted">最終取得: まだ取得していません</span>';
  } else {
    const when = `${_fmtClock(lastOk.at).slice(5)}（${_fmtAgo(lastOk.at)}）`;
    const pill = `<span class="sync-pill sync-pill-${lastOk.mode}">${SYNC_MODE_LABEL[lastOk.mode] || lastOk.mode}</span>`;
    const diff = lastOk.changed
      ? `<span class="sync-changed">${escapeHtml(_fmtDiff(lastOk))}</span>`
      : '<span class="sync-muted">変更なし</span>';
    html = `最終取得: <strong>${when}</strong> ${pill} ／ ${diff}`;
  }

  // 自動取得の状態 (PATありの編集者はポーリングしない仕様)
  html += auth.pat
    ? '<div class="sync-note">※ページを開いたときに自動で取得します。その後の自動取得はしません（編集権限あり）。</div>'
    : '<div class="sync-note">※ページを開いたときと、その後15秒ごとに自動で取得します。</div>';

  // 直近の試行が失敗していたら、古い内容を見ている可能性を明示する
  if (lastAny && lastAny.failed) {
    html += `<div class="sync-warn">⚠️ ${_fmtClock(lastAny.at).slice(5)} の取得に失敗しました（${escapeHtml(lastAny.note || '')}）。表示は前回取得分のままです。</div>`;
  }
  el.innerHTML = html;
}

// v1.11.15: 項目管理(列幅ドラッグ)モードの切替
function toggleColResizeMode() {
  colResizeMode = !colResizeMode;
  const btn = document.getElementById('btnColManage');
  if (btn) btn.classList.toggle('active', colResizeMode);
  if (colResizeMode) toast('列の境界(紫のライン)をドラッグして幅を調整できます', 'success');
  render();
}

// v1.11.15: ヘッダーに列幅ドラッグ用のハンドルを差し込む
function addColResizeHandles(container) {
  const header = container.querySelector('.product-table-header.mode-images');
  if (!header) return;
  header.classList.add('colresize');
  const map = [
    ['col-number', 'number', 'right'],
    ['col-manage', 'manage', 'right'],
    ['col-name', 'name', 'right'],
    ['col-actions', 'actions', 'left'],
  ];
  map.forEach(([cls, key, side]) => {
    const cell = header.querySelector('.' + cls);
    if (!cell) return;
    const h = document.createElement('span');
    h.className = 'col-resize-handle ' + side;
    h.addEventListener('mousedown', (e) => startColDrag(e, key, side));
    cell.appendChild(h);
  });
}

function startColDrag(e, key, side) {
  e.preventDefault(); e.stopPropagation();
  _colDrag = { key, side, startX: e.clientX, startW: colWidths[key] };
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onColDrag);
  window.addEventListener('mouseup', endColDrag);
}
function onColDrag(e) {
  if (!_colDrag) return;
  const dx = e.clientX - _colDrag.startX;
  let w = _colDrag.side === 'left' ? _colDrag.startW - dx : _colDrag.startW + dx;
  colWidths[_colDrag.key] = Math.max(40, Math.min(700, Math.round(w)));
  applyColWidths();
}
function endColDrag() {
  if (_colDrag) { saveColWidths(); _colDrag = null; }
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', onColDrag);
  window.removeEventListener('mouseup', endColDrag);
}

// v1.11.17: 検索バーの上に「表示切替ボタン + タグフィルタチップ」の行を作り、チップを移設する
function setupFilterRow() {
  if (document.getElementById('galleryModeSeg')) return;
  const searchRow = document.querySelector('.search-row');
  const chips = document.getElementById('tagFilterInline');
  if (!searchRow || !chips) return;
  const row = document.createElement('div');
  row.className = 'filter-chip-row';
  // 左側: 商品ごと / 画像一覧 の切替
  const seg = document.createElement('div');
  seg.id = 'galleryModeSeg';
  seg.className = 'gallery-mode-seg';
  seg.innerHTML = `
    <button type="button" data-gmode="product">🗂️ 商品ごと</button>
    <button type="button" data-gmode="imagelist">🖼️ 画像一覧</button>`;
  seg.querySelectorAll('[data-gmode]').forEach(b =>
    b.addEventListener('click', () => setGalleryViewMode(b.dataset.gmode)));
  row.appendChild(seg);
  // チップをこの行へ移設
  row.appendChild(chips);
  searchRow.parentNode.insertBefore(row, searchRow);
  updateGalleryModeSeg();
}

function updateGalleryModeSeg() {
  const seg = document.getElementById('galleryModeSeg');
  if (!seg) return;
  seg.querySelectorAll('[data-gmode]').forEach(b =>
    b.classList.toggle('active', b.dataset.gmode === galleryViewMode));
}

function setGalleryViewMode(mode) {
  if (mode !== 'product' && mode !== 'imagelist') return;
  if (galleryViewMode === mode) return;
  galleryViewMode = mode;
  try { localStorage.setItem(LS_GALLERY_VIEW, mode); } catch (e) { /* ignore */ }
  updateGalleryModeSeg();
  render();
}

// v1.11.17: 画像一覧モード — 対象商品の画像をフラットなグリッドで並べる
// (上部フィルタでタグを選ぶと、そのタグの画像だけがずらっと並ぶ)
function renderImageListGrid(products) {
  const content = document.getElementById('content');
  let list = products.slice();
  if (searchQuery) {
    list = list.filter(p =>
      (p.itemName || '').toLowerCase().includes(searchQuery) ||
      (p.itemCode || '').toLowerCase().includes(searchQuery) ||
      (p.itemNumber || '').toLowerCase().includes(searchQuery) ||
      (p.itemManageNumber || '').toLowerCase().includes(searchQuery));
  }
  const favTagId = getFavoriteTagId();
  const classTags = getCurrentTags().filter(t => t.id !== favTagId);
  const classFilterIds = [...filterTagIds].filter(id => id !== favTagId);

  // 画像を集約
  let items = [];
  list.forEach(p => {
    sortImagesByName(p.images || []).forEach(img => items.push({ p, img }));
  });
  if (classFilterIds.length > 0) {
    items = items.filter(it => classFilterIds.includes(it.img.tagId));
  }

  if (items.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🖼️</div>
      <div class="empty-title">該当する画像がありません</div>
      <div class="empty-desc">${classFilterIds.length ? '上部のタグ選択を変えてみてください' : 'タグを付けた画像がありません'}</div>
    </div>`;
    return;
  }

  _imageListUrls = items.map(it => it.img.url);

  const html = `<div class="image-list-grid">` + items.map((it, idx) => {
    const { p, img } = it;
    const sel = img.tagId || '';
    const selTag = sel ? classTags.find(t => t.id === sel) : null;
    const c = selTag ? getTagColor(selTag.color) : null;
    const styleAttr = c ? ` style="background:${c.bg};color:${c.fg};border-color:${c.bg}"` : '';
    const opts = ['<option value="" style="background:#fff;color:#334155">タグなし</option>']
      .concat(classTags.map(t => { const cc = getTagColor(t.color); return `<option value="${t.id}" ${t.id === sel ? 'selected' : ''} style="background:${cc.bg};color:${cc.fg}">${escapeHtml(t.name)}</option>`; }))
      .join('');
    const selectHTML = `<select class="img-tag-select" data-img-tag-pid="${p.id}" data-img-tag-id="${img.id}" data-has="${sel ? '1' : '0'}"${styleAttr}>${opts}</select>`;
    return `<div class="image-list-tile">
      <div class="ilt-thumb" data-il-index="${idx}" title="${escapeHtml(getImageSortKey(img))}">
        <img data-src="${escapeHtml(img.url)}" alt="" class="lazy-thumb">
      </div>
      ${selectHTML}
      <div class="ilt-meta" title="${escapeHtml(p.itemName || '')}">${escapeHtml(p.itemNumber || p.itemManageNumber || '')}</div>
    </div>`;
  }).join('') + `</div>`;
  content.innerHTML = html;
  scanLazyImages(content);

  // 画像タグのドロップダウン (商品ごとビューと同じ挙動)
  content.querySelectorAll('[data-img-tag-id]').forEach(selEl => {
    selEl.addEventListener('click', (e) => e.stopPropagation());
    selEl.addEventListener('change', (e) => {
      e.stopPropagation();
      setImageTag(selEl.dataset.imgTagPid, selEl.dataset.imgTagId, selEl.value, selEl);
    });
  });
  // サムネクリックでライトボックス
  content.querySelectorAll('[data-il-index]').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.ilIndex, 10) || 0;
      openLightbox(_imageListUrls, i);
    });
  });
}

// Service Worker登録 (v1.11.6)
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[ImageGallery] Service Worker非対応ブラウザです');
    return;
  }
  // 相対パスで登録(GitHub Pagesのサブディレクトリでも動く)
  navigator.serviceWorker.register('./sw.js')
    .then(reg => {
      console.info('[ImageGallery] Service Worker 登録成功:', reg.scope);
    })
    .catch(err => {
      console.warn('[ImageGallery] Service Worker 登録失敗:', err);
    });
}

// 画像キャッシュを全クリア (設定モーダルから使用)
async function clearImageCache() {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
    toast('Service Workerが有効ではありません', 'error');
    return;
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data && event.data.ok) {
        toast('画像キャッシュをクリアしました', 'success');
      } else {
        toast('キャッシュクリア失敗', 'error');
      }
      resolve();
    };
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_IMAGE_CACHE' }, [channel.port2]);
    // タイムアウト対策
    setTimeout(() => resolve(), 5000);
  });
}

function renderVersion() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = APP_VERSION;
}

function loadAuth() {
  const s = localStorage.getItem(LS_AUTH);
  if (s) {
    try {
      const a = JSON.parse(s);
      auth = { ...auth, ...a };
      shops = Array.isArray(a.shops) ? a.shops : [];
    } catch (e) { console.warn('auth parse failed', e); }
  }
}

function saveAuth() {
  localStorage.setItem(LS_AUTH, JSON.stringify({ ...auth, shops }));
}

function loadCurrentSelections() {
  currentShopId = localStorage.getItem(LS_CURRENT_SHOP) || null;
  // v1.11.12: 素材/盛り上げタブは廃止。保存済みの material/boost は product(現役) に読み替える
  const _cc = localStorage.getItem(LS_CURRENT_CAT);
  currentCategory = (_cc === 'product_unsure' || _cc === 'product_all' || _cc === 'product_untagged' || _cc === 'product_noimage' || _cc === 'parts' || _cc === 'yahoo_thumb') ? _cc : 'product';
  // v1.11.11: 基礎情報モードは廃止。保存済みの 'basic' は 'images' に読み替える。
  const _vm = localStorage.getItem(LS_VIEW_MODE);
  viewMode = (_vm === 'delete' || _vm === 'productdelete') ? _vm : 'images';
  // v1.11.15: 列幅設定を読み込み
  try {
    const cw = JSON.parse(localStorage.getItem(LS_COL_WIDTHS) || 'null');
    if (cw && typeof cw === 'object') colWidths = { ...DEFAULT_COL_WIDTHS, ...cw };
  } catch (e) { /* ignore */ }
  // v1.11.17: 表示切替(商品ごと/画像一覧)
  const _gv = localStorage.getItem(LS_GALLERY_VIEW);
  galleryViewMode = (_gv === 'imagelist') ? 'imagelist' : 'product';
  // v1.11.27: タグフィルタの選択を復元 (リロードしても消えないように)
  try {
    const ft = JSON.parse(localStorage.getItem(LS_FILTER_TAGS) || '[]');
    if (Array.isArray(ft)) filterTagIds = new Set(ft);
  } catch (e) { /* ignore */ }
  // ソート状態を復元 (なければデフォルト)
  const savedSortKey = localStorage.getItem(LS_SORT_KEY);
  const savedSortDir = localStorage.getItem(LS_SORT_DIR);
  if (savedSortKey !== null) {
    sortKey = savedSortKey === '' ? null : savedSortKey;
  }
  if (savedSortDir) {
    sortDir = savedSortDir;
  }
  if (currentShopId && !shops.find(s => s.id === currentShopId)) {
    currentShopId = shops[0]?.id || null;
  } else if (!currentShopId && shops.length) {
    currentShopId = shops[0].id;
  }
}

function bindEvents() {
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  // 画像キャッシュクリア (v1.11.6)
  const btnClearCache = document.getElementById('btnClearImageCache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      if (!confirm('画像キャッシュを全部クリアします。よろしいですか?\n(次回表示時にネットワークから取り直します)')) return;
      await clearImageCache();
    });
  }
  // 画像編集モーダル (v1.10.0)
  const ieClose = document.getElementById('btnImagesEditClose');
  if (ieClose) ieClose.addEventListener('click', closeProductImagesModal);
  const ieDel = document.getElementById('btnImagesEditDelete');
  if (ieDel) ieDel.addEventListener('click', deleteSelectedImagesInModal);
  const ieFile = document.getElementById('imagesEditFileInput');
  if (ieFile) {
    ieFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) {
        uploadImagesToProductInModal(Array.from(e.target.files));
        e.target.value = ''; // 同じファイル再選択可
      }
    });
  }
  const ieDrop = document.getElementById('imagesEditDropzone');
  if (ieDrop) {
    ieDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      ieDrop.classList.add('dragover');
    });
    ieDrop.addEventListener('dragleave', () => {
      ieDrop.classList.remove('dragover');
    });
    ieDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      ieDrop.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        uploadImagesToProductInModal(files);
      } else {
        toast('画像ファイルをドロップしてください', 'error');
      }
    });
    // ドロップエリアをクリックでもファイル選択
    ieDrop.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // ボタンは別途
      ieFile?.click();
    });
  }
  const ieBrowse = document.getElementById('btnImagesEditBrowse');
  if (ieBrowse) {
    ieBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      ieFile?.click();
    });
  }
  // PAT表示/非表示トグル (v1.9.2)
  const btnTogglePat = document.getElementById('btnTogglePat');
  if (btnTogglePat) {
    btnTogglePat.addEventListener('click', () => {
      const input = document.getElementById('settingPat');
      if (input.type === 'password') {
        input.type = 'text';
        btnTogglePat.textContent = '🙈 隠す';
      } else {
        input.type = 'password';
        btnTogglePat.textContent = '👁 表示';
      }
    });
  }
  // Access Key表示/非表示トグル (v1.11.7)
  const btnToggleAccessKey = document.getElementById('btnToggleAccessKey');
  if (btnToggleAccessKey) {
    btnToggleAccessKey.addEventListener('click', () => {
      const input = document.getElementById('shopFormAccessKey');
      if (input.type === 'password') {
        input.type = 'text';
        btnToggleAccessKey.textContent = '🙈 隠す';
      } else {
        input.type = 'password';
        btnToggleAccessKey.textContent = '👁 表示';
      }
    });
  }
  document.getElementById('btnStorage').addEventListener('click', openStorageModal);
  // 全画像一括ダウンロード (v1.11.0)
  const btnBulkDL = document.getElementById('btnBulkDownload');
  if (btnBulkDL) btnBulkDL.addEventListener('click', downloadAllImagesAsZip);
  const btnBulkDLCancel = document.getElementById('btnBulkDownloadCancel');
  if (btnBulkDLCancel) btnBulkDLCancel.addEventListener('click', cancelBulkDownload);
  document.getElementById('btnExportMode').addEventListener('click', toggleExportMode);
  document.getElementById('btnExportExecute').addEventListener('click', executeExport);
  document.getElementById('btnExportClear').addEventListener('click', clearExportSelection);
  document.getElementById('btnClearProducts').addEventListener('click', clearAllProducts);

  // 商品追加ハブモーダルのボタン (v1.8.7)
  document.getElementById('btnHubSyncProducts').addEventListener('click', () => {
    closeModal('addHubModal');
    syncProducts();
  });
  document.getElementById('btnHubBulkImages').addEventListener('click', () => {
    closeModal('addHubModal');
    openBulkImagesModal();
  });

  // ドキュメントクリックでドロップダウン閉じる処理は廃止(タグフィルタは常時表示に)
  document.getElementById('btnImportCsv').addEventListener('click', openCsvImportModal);
  document.getElementById('btnPickCsv').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCsvFile(file);
    e.target.value = '';
  });
  // CSV dropzone
  const csvDz = document.getElementById('csvDropzone');
  csvDz.addEventListener('click', () => document.getElementById('csvFileInput').click());
  csvDz.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvDz.classList.add('dragover');
  });
  csvDz.addEventListener('dragleave', () => csvDz.classList.remove('dragover'));
  csvDz.addEventListener('drop', (e) => {
    e.preventDefault();
    csvDz.classList.remove('dragover');
    const file = Array.from(e.dataTransfer.files).find(f =>
      f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv'
    );
    if (file) handleCsvFile(file);
    else toast('CSVファイルをドロップしてください', 'error');
  });
  document.getElementById('btnConfirmCsvImport').addEventListener('click', confirmCsvImport);

  // ZIP一括アップロード
  // ZIP一括アップロード (画像一括アップロード) — +追加モーダルから呼ばれるため直接バインドは無し
  document.getElementById('btnPickBulkZip').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('bulkZipInput').click();
  });
  document.getElementById('bulkZipInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleBulkZip(file);
    e.target.value = '';
  });
  const bulkDz = document.getElementById('bulkDropzone');
  bulkDz.addEventListener('click', () => document.getElementById('bulkZipInput').click());
  bulkDz.addEventListener('dragover', (e) => { e.preventDefault(); bulkDz.classList.add('dragover'); });
  bulkDz.addEventListener('dragleave', () => bulkDz.classList.remove('dragover'));
  bulkDz.addEventListener('drop', (e) => {
    e.preventDefault();
    bulkDz.classList.remove('dragover');
    const file = Array.from(e.dataTransfer.files).find(f =>
      f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip'
    );
    if (file) handleBulkZip(file);
    else toast('ZIPファイルをドロップしてください', 'error');
  });
  document.getElementById('btnConfirmBulkImport').addEventListener('click', confirmBulkImport);
  document.getElementById('btnExportCsv').addEventListener('click', exportBasicInfoCsv);
  document.getElementById('btnAddEntry').addEventListener('click', () => {
    // 商品系タブ → 追加ハブモーダル / 素材・盛り上げ → 名前入力モーダル
    if (currentCategory !== 'material' && currentCategory !== 'boost') {
      document.getElementById('addHubModal').style.display = 'flex';
    } else {
      openEntryForm();
    }
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById('filterUnregistered').addEventListener('change', (e) => {
    filterUnregistered = e.target.checked;
    render();
  });

  // 表示モード切替
  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetMode = btn.dataset.mode;
      // 削除モードはトグル動作 (v1.8.6): もう一度押すと画像全体モードに戻る
      if (targetMode === 'delete' && viewMode === 'delete') {
        viewMode = 'images';
      } else {
        viewMode = targetMode;
      }
      localStorage.setItem(LS_VIEW_MODE, viewMode);
      document.querySelectorAll('.view-mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === viewMode));
      // モード切替で削除予約は一旦リセット
      deleteSelection.clear();
      productDeleteSelection.clear();
      updateDeleteActionBar();
      updateProductDeleteBar();
      render();
    });
  });

  // 削除モードのアクションバー
  document.getElementById('btnDeleteCancel').addEventListener('click', () => {
    deleteSelection.clear();
    updateDeleteActionBar();
    render();
  });
  document.getElementById('btnDeleteExecute').addEventListener('click', executeDeleteSelected);

  // ステータス変更バー
  const btnCommitStatus = document.getElementById('btnCommitStatus');
  if (btnCommitStatus) btnCommitStatus.addEventListener('click', commitPendingStatusChanges);
  const btnDiscardStatus = document.getElementById('btnDiscardStatus');
  if (btnDiscardStatus) btnDiscardStatus.addEventListener('click', discardPendingStatusChanges);

  // Category tabs
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCategory = btn.dataset.cat;
      localStorage.setItem(LS_CURRENT_CAT, currentCategory);
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });

  // Upload
  document.getElementById('btnPickFiles').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', (e) => {
    uploadFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  // Drag and drop on dropzone
  const dz = document.getElementById('uploadDropzone');
  dz.addEventListener('click', () => document.getElementById('fileInput').click());
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    uploadFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
  });

  // Tag input enter
  document.getElementById('imageDetailTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });

  // Close modal on backdrop click
  // 親モーダルの上に重なって開くネストされたモーダルは、背景クリックで閉じない。
  // (親モーダルの背景を覆ってしまい、親の保存/操作クリックを奪って入力内容を無言で破棄する事故を防ぐ)
  const NESTED_MODAL_IDS = ['shopFormModal', 'tagEditModal', 'productEditModal', 'entryFormModal'];
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target !== el) return;
      if (NESTED_MODAL_IDS.includes(el.id)) return;
      el.style.display = 'none';
    });
  });
}

// =====================================================
// 画像のソート (ファイル名昇順、自然順序)
// "メイン1.jpg" < "メイン2.jpg" < "メイン10.jpg" のように扱う
// =====================================================
function getImageSortKey(img) {
  if (img.originalName) return img.originalName;
  if (img.filename) {
    // "1715000000_abc123_元のファイル名.jpg" → "元のファイル名.jpg"
    const m = img.filename.match(/^\d+_[a-z0-9]+_(.+)$/);
    return m ? m[1] : img.filename;
  }
  return '';
}

function sortImagesByName(images) {
  return images.slice().sort((a, b) => {
    const ka = getImageSortKey(a);
    const kb = getImageSortKey(b);
    return ka.localeCompare(kb, 'ja', { numeric: true, sensitivity: 'base' });
  });
}

// =====================================================
// GitHub API
// =====================================================
async function ghFetch(path, opts = {}) {
  if (!auth.owner || !auth.repo) {
    throw new Error('GitHub設定が未入力です。⚙️設定から登録してください。');
  }
  const method = (opts.method || 'GET').toUpperCase();
  // v1.11.25: 閲覧(GET)はPATなしでも可 (公開リポジトリ前提)。書き込みはPAT必須。
  if (!auth.pat && method !== 'GET') {
    throw new Error('保存にはPersonal Access Token (PAT) が必要です。⚙️設定から登録してください。');
  }
  const url = `https://api.github.com/repos/${auth.owner}/${auth.repo}/${path}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    ...(opts.headers || {})
  };
  if (auth.pat) headers['Authorization'] = `token ${auth.pat}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  return res;
}

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== gallery.json の保存/読み込み =====
// お気に入りタグ (v1.9.0) — 固定名
const FAVORITE_TAG_NAME = 'お気に入り';
const FAVORITE_TAG_COLOR = 'pink';

// 選ばれる理由タグ (v1.9.3) — 固定名
// v1.11.10: 名称を「選ばれる理由」→「◯◯個の理由」に変更。
//   旧名は移行処理で自動リネームする (OLD_REASON_TAG_NAME)。画像の tagId は id 参照なので付け直し不要。
const REASON_TAG_NAME = '◯◯個の理由';
const OLD_REASON_TAG_NAME = '選ばれる理由';
const REASON_TAG_COLOR = 'purple';

// v1.11.18: タグ名の一括リネーム定義 (移行処理で一度だけ適用。idは不変=画像の紐付け維持)
const TAG_RENAMES = [
  { from: OLD_REASON_TAG_NAME, to: REASON_TAG_NAME }, // 選ばれる理由 → ◯◯個の理由
  { from: 'ポイント前', to: '重要補足' },              // v1.11.18
];

// v1.11.10: 分類タグ(お気に入り以外)の表示順。ドロップダウン/上部フィルタはこの順に並ぶ。
const DESIRED_TAG_ORDER = ['疑問？', 'どーん', '重要補足', REASON_TAG_NAME, 'セット販売'];

// 起動時に「お気に入り」タグがなければ自動作成
// 起動時に「お気に入り」タグがなければ自動作成
// (v1.11.2) 空/破損データ検出時は保存をスキップして事故を防ぐ
async function ensureFavoriteTag(shopId) {
  const data = dataCache[shopId];
  if (!data) return;
  // 🚨 安全ガード: JSON読み込みで異常があった場合は絶対に保存しない
  if (data._wasEmpty || data._parseError) {
    console.warn('[ImageGallery] ensureFavoriteTag: データ異常のためスキップ', { _wasEmpty: data._wasEmpty, _parseError: data._parseError });
    return;
  }
  // 🚨 追加ガード: sha が未取得(初回書き込み前)の場合、既存データ検出できないと危険
  if (!Array.isArray(data.products)) {
    console.warn('[ImageGallery] ensureFavoriteTag: productsが配列でないためスキップ');
    return;
  }
  if (!Array.isArray(data.tags)) data.tags = [];
  const existing = data.tags.find(t => t.name === FAVORITE_TAG_NAME);
  if (existing) return;
  // 追加
  const newTag = {
    id: 'tag_fav_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: FAVORITE_TAG_NAME,
    color: FAVORITE_TAG_COLOR,
    createdAt: new Date().toISOString()
  };
  data.tags.push(newTag);
  try {
    await saveShopData(shopId, 'auto: add favorite tag');
    console.info('[ImageGallery] お気に入りタグを自動追加');
  } catch (e) {
    console.warn('お気に入りタグの保存失敗', e);
    data.tags = data.tags.filter(t => t.id !== newTag.id);
  }
}

// 起動時に「選ばれる理由」タグがなければ自動作成 (v1.9.3)
// (v1.11.2) 空/破損データ検出時は保存をスキップして事故を防ぐ
async function ensureReasonTag(shopId) {
  const data = dataCache[shopId];
  if (!data) return;
  // 🚨 安全ガード: JSON読み込みで異常があった場合は絶対に保存しない
  if (data._wasEmpty || data._parseError) {
    console.warn('[ImageGallery] ensureReasonTag: データ異常のためスキップ', { _wasEmpty: data._wasEmpty, _parseError: data._parseError });
    return;
  }
  if (!Array.isArray(data.products)) {
    console.warn('[ImageGallery] ensureReasonTag: productsが配列でないためスキップ');
    return;
  }
  if (!Array.isArray(data.tags)) data.tags = [];
  const existing = data.tags.find(t => t.name === REASON_TAG_NAME);
  if (existing) return;
  const newTag = {
    id: 'tag_reason_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: REASON_TAG_NAME,
    color: REASON_TAG_COLOR,
    createdAt: new Date().toISOString()
  };
  data.tags.push(newTag);
  try {
    await saveShopData(shopId, 'auto: add reason tag');
    console.info('[ImageGallery] 選ばれる理由タグを自動追加');
  } catch (e) {
    console.warn('選ばれる理由タグの保存失敗', e);
    data.tags = data.tags.filter(t => t.id !== newTag.id);
  }
}

// v1.11.10: タグの「旧名→新名リネーム」を一度だけ行う移行処理。
//   ・旧「選ばれる理由」を「◯◯個の理由」へ、旧「ポイント前」を「重要補足」へリネーム
//     (id は変えないので画像の紐付けは維持)
//   ・v1.11.22: 並べ替えの強制は廃止。並び順はユーザーが「タグ編集」で自由に管理する。
//   ・変更が発生したときだけ一度 GitHub 保存。以降は差分なしで保存も走らない (冪等)
//   ・空/破損データ時は絶対に保存しない (3重防衛と同じガード)
async function migrateTagRenameAndOrder(shopId) {
  const data = dataCache[shopId];
  if (!data) return;
  if (data._wasEmpty || data._parseError || data._loadFailed) return;
  if (!Array.isArray(data.tags)) return;

  let changed = false;

  // 旧名 → 新名リネーム (新名が既に存在する場合は重複を避けてスキップ)
  TAG_RENAMES.forEach(({ from, to }) => {
    const hasNew = data.tags.some(t => t.name === to);
    if (hasNew) return;
    const old = data.tags.find(t => t.name === from);
    if (old) { old.name = to; changed = true; }
  });

  if (changed) {
    try {
      await saveShopData(shopId, 'migrate: rename tags');
      console.info('[ImageGallery] タグ名称の移行を保存しました');
    } catch (e) {
      console.warn('[ImageGallery] タグ移行の保存に失敗', e);
    }
  }
}

// 現在のお気に入りタグIDを取得
function getFavoriteTagId() {
  const tags = getCurrentTags();
  return tags.find(t => t.name === FAVORITE_TAG_NAME)?.id || null;
}

// ===== 全画像一括ダウンロード (v1.11.0) =====
let _bulkDownloadCancelled = false;

async function downloadAllImagesAsZip() {
  if (typeof JSZip === 'undefined') {
    toast('JSZipライブラリが読み込まれていません', 'error');
    return;
  }
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データが読み込まれていません', 'error'); return; }

  const targets = data.products;
  if (targets.length === 0) {
    toast('商品がありません', 'error');
    return;
  }
  let totalImages = 0;
  targets.forEach(p => { totalImages += (p.images || []).length; });
  if (totalImages === 0) {
    toast('画像がありません', 'error');
    return;
  }

  if (!confirm(`全画像 ${totalImages} 枚をZIPでダウンロードします。\n(大量の場合、処理に数分〜数十分かかる可能性があります)\n続行しますか?`)) return;

  _bulkDownloadCancelled = false;
  const shopCode = (shop.shopCode || 'shop').toLowerCase();
  const zip = new JSZip();

  // 専用の進捗UI
  const progressWrap = document.getElementById('bulkDownloadProgress');
  if (progressWrap) progressWrap.style.display = 'block';
  const progressText = document.getElementById('bulkDownloadProgressText');
  const progressBar = document.getElementById('bulkDownloadProgressBar');

  let okCount = 0;
  let failCount = 0;
  let processed = 0;

  for (const p of targets) {
    if (_bulkDownloadCancelled) break;
    const manage = p.itemManageNumber || p.id;
    const folderName = `${shopCode}_${manage}`;
    const folder = zip.folder(folderName);
    const sorted = sortImagesByName(p.images || []);
    for (const img of sorted) {
      if (_bulkDownloadCancelled) break;
      processed++;
      if (progressText) progressText.textContent = `${processed} / ${totalImages} 枚取得中...`;
      if (progressBar) progressBar.style.width = `${Math.floor(processed / totalImages * 100)}%`;
      try {
        const res = await fetch(img.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const filename = img.originalName || img.filename;
        folder.file(filename, blob);
        okCount++;
      } catch (e) {
        console.error('DL failed', img.url, e);
        failCount++;
      }
    }
  }

  if (_bulkDownloadCancelled) {
    if (progressWrap) progressWrap.style.display = 'none';
    toast('キャンセルされました', 'error');
    return;
  }

  if (progressText) progressText.textContent = 'ZIPを生成中...';
  if (progressBar) progressBar.style.width = '100%';
  try {
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `backup_${shopCode}_${targets.length}items_${stamp}.zip`;

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (progressWrap) progressWrap.style.display = 'none';
    toast(`${okCount}枚をZIPでダウンロードしました${failCount ? ` / 失敗${failCount}件` : ''}`, failCount ? 'error' : 'success');
  } catch (e) {
    if (progressWrap) progressWrap.style.display = 'none';
    toast('ZIP生成失敗: ' + e.message, 'error');
  }
}

function cancelBulkDownload() {
  _bulkDownloadCancelled = true;
}

// ===== 全画像一括ダウンロード ここまで =====

// ===== 画像遅延読み込み&リトライ (v1.10.1) =====
// GitHubのraw.githubusercontent.comは大量並列アクセスでHTTP 429を返すため、
// 1) 画面外の画像は読み込まない (IntersectionObserver)
// 2) 同時読み込み数を制限
// 3) 429/失敗時は指数バックオフでリトライ

const LAZY_ROOT_MARGIN = '1500px'; // v1.11.4: 500px → 1500px (先読み範囲を広げる)
const LAZY_MAX_CONCURRENT = 16;     // v1.11.4: 6 → 16 (画像軽量化により429リスク減、並列を増やす)
const LAZY_MAX_RETRIES = 3;
const LAZY_BASE_DELAY = 1000;      // ms
let _lazyObserver = null;
let _lazyActiveCount = 0;
const _lazyQueue = [];

function getLazyObserver() {
  if (_lazyObserver) return _lazyObserver;
  _lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        _lazyObserver.unobserve(img);
        _lazyEnqueue(img);
      }
    });
  }, { rootMargin: LAZY_ROOT_MARGIN });
  return _lazyObserver;
}

// 対象の <img> を監視対象に登録 (data-src → 実src)
function observeLazyImg(img) {
  if (!img || !img.dataset || !img.dataset.src) return;
  // ネイティブlazy属性はブラウザ任せなので、明示的にIntersectionObserverで制御
  getLazyObserver().observe(img);
}

// 全ての data-src 属性を持つ img を再スキャンして監視
function scanLazyImages(root) {
  const scope = root || document;
  scope.querySelectorAll('img[data-src]:not([data-lazy-registered])').forEach(img => {
    img.dataset.lazyRegistered = '1';
    observeLazyImg(img);
  });
}

// キューに投入 → 空きがあれば実行
function _lazyEnqueue(img) {
  _lazyQueue.push(img);
  _lazyPump();
}

function _lazyPump() {
  // 🚨 (v1.11.5) 安全弁: カウンタが負や異常値になっていたらリセット
  if (_lazyActiveCount < 0 || _lazyActiveCount > LAZY_MAX_CONCURRENT * 2) {
    console.warn('[ImageGallery] _lazyActiveCount 異常値、リセット:', _lazyActiveCount);
    _lazyActiveCount = 0;
  }
  while (_lazyActiveCount < LAZY_MAX_CONCURRENT && _lazyQueue.length > 0) {
    const img = _lazyQueue.shift();
    _lazyActiveCount++;   // 🚨 (v1.11.5) カウンタ管理はここに集約
    // リトライ経由の再エントリならdataset.retryCountに保存されている
    const attempt = parseInt(img.dataset.retryCount || '0', 10);
    _lazyLoadImage(img, attempt);
  }
}

// 画像を読み込む(失敗時はリトライ)
// (v1.11.5) バグ修正: リトライ待機中はカウンタを解放してキューを進める
//   旧実装: setTimeout待機中(1〜4秒)もカウンタを保持していたため、
//          遅い画像/失敗画像が16個溜まると並列度が枯渇してキュー完全停止
//   新実装: probe失敗時は即カウンタを解放し、キューの末尾に戻して再挑戦。
//          _lazyLoadImage内でカウンタを触らないシンプルな責務分離
function _lazyLoadImage(img, attempt) {
  if (!img || !img.dataset.src) {
    // 対象が無効な場合もカウンタを解放
    _lazyActiveCount--;
    _lazyPump();
    return;
  }
  const url = img.dataset.src;
  const probe = new Image();

  const finish = (success) => {
    if (success) {
      img.src = url;
      img.classList.remove('img-loading', 'img-error');
      img.classList.add('img-loaded');
    } else {
      img.classList.remove('img-loading');
      img.classList.add('img-error');
    }
    _lazyActiveCount--;
    _lazyPump();
  };

  probe.onload = () => finish(true);
  probe.onerror = () => {
    if (attempt < LAZY_MAX_RETRIES) {
      // 🚨 リトライ: カウンタを即解放して他の画像を処理させる
      _lazyActiveCount--;
      const delay = LAZY_BASE_DELAY * Math.pow(2, attempt);
      setTimeout(() => {
        // 再挑戦時にキュー経由で再エントリ(dataset.retryCountでリトライ数を保持)
        img.dataset.retryCount = String(attempt + 1);
        _lazyEnqueue(img);
      }, delay);
    } else {
      finish(false);
    }
  };

  img.classList.remove('img-error');
  img.classList.add('img-loading');
  probe.src = url;
}

function shopDataPath(shopId) {
  return `data/${shopId}/gallery.json`;
}

// gallery.json を raw.githubusercontent.com から直接フェッチ (1MB制限回避用)
// 公開リポジトリ前提。Privateリポジトリの場合は ghFetch で /git/blobs を使うように変更が必要。
async function fetchRawGalleryJson(shopId) {
  const path = shopDataPath(shopId);
  const branch = auth.branch || 'main';
  const url = `https://raw.githubusercontent.com/${auth.owner}/${auth.repo}/${encodeURIComponent(branch)}/${path}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`raw fetch ${res.status}: ${url}`);
  }
  return await res.text();
}

async function loadShopData(shopId) {
  const path = shopDataPath(shopId);
  try {
    const res = await ghFetch(`contents/${path}?ref=${auth.branch}`);
    if (res.status === 404) {
      return { products: [], materials: [], boosts: [], tags: [], yahooThumbs: [], sha: null };
    }
    const data = await res.json();

    // base64デコード → JSON.parseの安全処理
    let decoded = '';
    let usedRawFallback = false;

    try {
      decoded = b64decode((data.content || '').replace(/\n/g, '')).trim();
    } catch (decErr) {
      console.warn('[ImageGallery] base64デコード失敗。raw fallback を試します', decErr);
    }

    // === v1.5.3 追加: 1MB超え対応 ===
    // GitHub Contents API は 1MB超えのファイルだと content フィールドを空文字で返す仕様。
    // その場合は raw.githubusercontent.com から直接フェッチする。
    if (!decoded) {
      try {
        console.info(
          `[ImageGallery] Contents APIのcontentが空 (size=${data.size}). ` +
          `raw.githubusercontent.com から取得します`
        );
        const rawText = await fetchRawGalleryJson(shopId);
        decoded = (rawText || '').trim();
        usedRawFallback = true;
      } catch (rawErr) {
        console.error('[ImageGallery] raw fallback 失敗', rawErr);
        // raw も失敗 → 空のまま下のチェックで _wasEmpty 扱いに落ちる
      }
    }

    if (!decoded) {
      // 空ファイル: 警告して既存SHAを保持(上書き保存できるように)
      console.warn('[ImageGallery] gallery.jsonが空でした。空データで起動します。SHA:', data.sha);
      toast('⚠️ データファイルが空です。GitHub上のJSONを確認してください', 'error');
      return {
        products: [], materials: [], boosts: [], tags: [],
        sha: data.sha,
        _wasEmpty: true
      };
    }

    let json;
    try {
      json = JSON.parse(decoded);
    } catch (parseErr) {
      console.error('[ImageGallery] JSON.parse失敗', parseErr, 'content head:', decoded.slice(0, 200));
      toast('⚠️ データJSONが壊れています。GitHubで内容を確認してください', 'error');
      return {
        products: [], materials: [], boosts: [], tags: [],
        sha: data.sha,
        _parseError: true
      };
    }

    if (usedRawFallback) {
      console.info(
        `[ImageGallery] raw fallback で正常に読み込み完了 ` +
        `(products: ${(json.products || []).length}件)`
      );
    }

    const built = _buildShopDataFromJson(json, data.sha, shopId);
    built._loadedViaRaw = usedRawFallback;
    return built;
  } catch (e) {
    console.error('loadShopData failed', e);
    // v1.11.28: 失敗時はフラグを立てる。これが無いと自動更新が「正常な空」と誤認して
    //           既存データを空で上書きしてしまう(=更新の度に消える不具合の原因)。
    return { products: [], materials: [], boosts: [], tags: [], sha: null, _wasEmpty: true, _parseError: true, _loadFailed: true };
  }
}

// v1.11.28: gallery.jsonのJSONから表示用データを構築 (管理番号補正 + 重複マージ)。
//   loadShopData / loadShopDataRaw で共有。
function _buildShopDataFromJson(json, sha, shopId) {
  let products = Array.isArray(json.products) ? json.products : [];
  // STEP1 (楽天版の itemUrl→管理番号の補正) は Yahoo版では不要。
  //   Yahooは商品コードがそのまま主キー (itemManageNumber) で、URL解析をしない。
  // STEP2: 同じ itemManageNumber の重複をマージ
  //   ※Yahoo版はここを大文字小文字を区別しないキーにしてはいけない(既存データの見た目が変わるため)。
  //     取り込み側(buildYahooMergePlan)で大文字小文字を同一視して、そもそも重複を作らない。
  const mergedMap = new Map();
  let mergedCount = 0;
  products.forEach(p => {
    if (!p.itemManageNumber) { mergedCount++; return; }
    const key = String(p.itemManageNumber).trim();
    const existing = mergedMap.get(key);
    if (!existing) { mergedMap.set(key, p); }
    else {
      const existingUrls = new Set((existing.images || []).map(i => i.url));
      const newImages = (p.images || []).filter(i => !existingUrls.has(i.url));
      existing.images = [...(existing.images || []), ...newImages];
      if (!existing.itemNumber && p.itemNumber) existing.itemNumber = p.itemNumber;
      if (!existing.itemName && p.itemName) existing.itemName = p.itemName;
      mergedCount++;
    }
  });
  products = Array.from(mergedMap.values());
  return {
    products,
    materials: Array.isArray(json.materials) ? json.materials : [],
    boosts: Array.isArray(json.boosts) ? json.boosts : [],
    tags: Array.isArray(json.tags) ? json.tags : [],
    // v1.11.35: Yahoo用サムネ (3列ボード) の行データ
    yahooThumbs: Array.isArray(json.yahooThumbs) ? json.yahooThumbs : [],
    sha,
    _mergedCount: mergedCount
  };
}

// v1.11.28: 公開ファイル(raw)直読み専用のロード (GitHub Contents APIを使わないのでレート制限に当たらない)。
//   閲覧者の自動更新はこちらを使う。
async function loadShopDataRaw(shopId) {
  try {
    const rawText = await fetchRawGalleryJson(shopId); // 404等は throw
    const decoded = (rawText || '').trim();
    if (!decoded) return { products: [], materials: [], boosts: [], tags: [], sha: null, _wasEmpty: true, _loadFailed: true };
    let json;
    try { json = JSON.parse(decoded); }
    catch (e) { return { products: [], materials: [], boosts: [], tags: [], sha: null, _parseError: true, _loadFailed: true }; }
    return _buildShopDataFromJson(json, null, shopId);
  } catch (e) {
    return { products: [], materials: [], boosts: [], tags: [], sha: null, _wasEmpty: true, _loadFailed: true };
  }
}

async function saveShopData(shopId, message) {
  // 直列化: 同じショップの保存は順番に実行 + 409エラー時はSHAを取り直してリトライ
  if (!saveShopData._queues) saveShopData._queues = {};
  const prev = saveShopData._queues[shopId] || Promise.resolve();
  const next = prev.catch(() => {}).then(() => _saveShopDataOnce(shopId, message));
  saveShopData._queues[shopId] = next;
  try {
    return await next;
  } finally {
    if (saveShopData._queues[shopId] === next) {
      delete saveShopData._queues[shopId];
    }
  }
}

async function _saveShopDataOnce(shopId, message, retryCount = 0) {
  const data = dataCache[shopId];
  if (!data) return;
  // 🚨 (v1.11.2) 強化: 空データ警告状態では絶対に保存しない
  // 以前は tags.length === 0 も条件にしていたが、ensureFavoriteTagがタグを1個追加してから
  // 保存を呼ぶため、この条件を素通りして事故が起きた(2026-07-09の全データ消失)
  // → tagsの数に関わらず、_wasEmpty/_parseError/_loadFailed のいずれかが立っていたら保存を拒否
  if (data._wasEmpty || data._parseError || data._loadFailed) {
    throw new Error('データロード時に空/破損を検出したため、上書き保存を中止しました。GitHub上のgallery.jsonを確認してください。');
  }
  const path = shopDataPath(shopId);
  const content = JSON.stringify({
    products: data.products,
    materials: data.materials,
    boosts: data.boosts,
    tags: data.tags || [],
    // v1.11.35: Yahoo用サムネ
    yahooThumbs: Array.isArray(data.yahooThumbs) ? data.yahooThumbs : []
  }, null, 2);

  const body = {
    message: message || 'update gallery',
    content: b64encode(content),
    branch: auth.branch
  };
  if (data.sha) body.sha = data.sha;

  const res = await ghFetch(`contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    // SHA衝突(409 or 422)はSHAを取り直して1回だけリトライ
    if ((res.status === 409 || res.status === 422) && retryCount < 1) {
      try {
        const head = await ghFetch(`contents/${path}?ref=${auth.branch}`);
        if (head.ok) {
          const headData = await head.json();
          data.sha = headData.sha;
          return _saveShopDataOnce(shopId, message, retryCount + 1);
        }
      } catch (e) { /* fall through */ }
    }
    let errMsg = `GitHub保存失敗 (status:${res.status})`;
    try {
      const err = await res.json();
      if (err.message) errMsg = err.message;
    } catch (e) {}
    throw new Error(errMsg);
  }
  const result = await res.json();
  data.sha = result.content.sha;
}

// ===== 画像の保存/取得 =====
function imagePath(shopId, productId, filename) {
  return `data/${shopId}/images/${productId || 'common'}/${filename}`;
}

async function uploadImageToGitHub(shopId, productId, file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}.${ext}`;
  const path = imagePath(shopId, productId, filename);
  const content = await fileToBase64(file);

  const res = await ghFetch(`contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `upload image: ${filename}`,
      content,
      branch: auth.branch
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'アップロード失敗');
  }
  const result = await res.json();
  return {
    id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    filename,
    originalName: file.name,  // 元のファイル名(ソート用)
    path,
    sha: result.content.sha,
    url: result.content.download_url,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    note: '',
    tags: []
  };
}

async function deleteImageFromGitHub(imageMeta) {
  const res = await ghFetch(`contents/${imageMeta.path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `delete image: ${imageMeta.filename}`,
      sha: imageMeta.sha,
      branch: auth.branch
    })
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json();
    throw new Error(err.message || '削除失敗');
  }
}

// 既存画像を上書き (v1.11.0): 既存のpathとshaを使って新しいコンテンツをPUT
async function overwriteImageOnGitHub(imageMeta, newFile) {
  const content = await fileToBase64(newFile);
  const res = await ghFetch(`contents/${imageMeta.path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `overwrite image: ${imageMeta.filename}`,
      content,
      sha: imageMeta.sha,
      branch: auth.branch
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || '上書き失敗');
  }
  const result = await res.json();
  // メタデータを更新
  return {
    ...imageMeta,
    sha: result.content.sha,
    url: result.content.download_url,
    size: newFile.size,
    uploadedAt: new Date().toISOString()
  };
}

// =====================================================
// (楽天版の extractCode / fetchRakutenProducts / RAKUTEN_API_VERSION はYahoo版では削除)
//   Yahooの商品取り込みは「Yahoo!ショッピング 商品取り込み」セクション (syncProducts の位置) を参照。
// =====================================================

// =====================================================
// タグ管理
// =====================================================
function getCurrentTags() {
  const data = dataCache[currentShopId];
  if (!data) return [];
  if (!Array.isArray(data.tags)) data.tags = [];
  return data.tags;
}
function findTag(tagId) {
  return getCurrentTags().find(t => t.id === tagId);
}
function getTagColor(colorId) {
  return TAG_COLORS.find(c => c.id === colorId) || TAG_COLORS[0];
}

function openTagManageModal() {
  if (!currentShopId) { toast('ショップが選択されていません', 'error'); return; }
  newTagSelectedColor = 'amber';
  document.getElementById('newTagName').value = '';
  renderTagColorPicker();
  renderTagManageList();
  document.getElementById('tagManageModal').style.display = 'flex';
}

function renderTagColorPicker() {
  const wrap = document.getElementById('newTagColorPicker');
  wrap.innerHTML = TAG_COLORS.map(c => `
    <div class="color-swatch ${c.id === newTagSelectedColor ? 'selected' : ''}"
         data-color="${c.id}"
         style="background:${c.bg};color:${c.fg}"
         title="${c.id}">●</div>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      newTagSelectedColor = el.dataset.color;
      renderTagColorPicker();
    });
  });
}

function renderTagManageList() {
  const wrap = document.getElementById('tagManageList');
  const tags = getCurrentTags();
  if (tags.length === 0) {
    wrap.innerHTML = '<div class="tag-manage-empty">まだタグがありません。下のフォームから追加してください。</div>';
    return;
  }
  wrap.innerHTML = tags.map(t => {
    const c = getTagColor(t.color);
    const usedCount = countTagUsage(t.id);
    return `<div class="tag-manage-row">
      <span class="tag-chip" style="background:${c.bg};color:${c.fg}">${escapeHtml(t.name)}</span>
      <span class="tag-used-count">${usedCount}件で使用中</span>
      <div class="tag-manage-actions">
        <button class="btn-icon-mini" data-edit-tag="${t.id}">編集</button>
        <button class="btn-icon-mini danger" data-del-tag="${t.id}">削除</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-edit-tag]').forEach(b =>
    b.addEventListener('click', () => editTag(b.dataset.editTag)));
  wrap.querySelectorAll('[data-del-tag]').forEach(b =>
    b.addEventListener('click', () => deleteTag(b.dataset.delTag)));
}

function countTagUsage(tagId) {
  const data = dataCache[currentShopId];
  if (!data) return 0;
  return data.products.filter(p => (p.tagIds || []).includes(tagId)).length;
}

async function createTagFromForm() {
  const input = document.getElementById('newTagName');
  const name = input.value.trim();
  if (!name) { toast('タグ名を入力してください', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data.tags) data.tags = [];
  if (data.tags.some(t => t.name === name)) {
    toast('同じ名前のタグが既にあります', 'error'); return;
  }
  const newTag = {
    id: 'tag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name,
    color: newTagSelectedColor,
    createdAt: new Date().toISOString()
  };
  data.tags.push(newTag);
  showLoading('タグを保存中...');
  try {
    await saveShopData(currentShopId, `add tag: ${name}`);
    hideLoading();
    input.value = '';
    renderTagManageList();
    renderTagFilterDropdown();
    render();
    toast(`タグ「${name}」を追加しました`, 'success');
  } catch (e) {
    hideLoading();
    data.tags.pop();
    toast('保存失敗: ' + e.message, 'error');
  }
}

let editingTagSelectedColor = 'amber';

function editTag(tagId) {
  try {
    const tag = findTag(tagId);
    if (!tag) { toast('タグが見つかりません', 'error'); return; }

    const modal = document.getElementById('tagEditModal');
    const idEl = document.getElementById('tagEditId');
    const nameEl = document.getElementById('tagEditName');
    const colorPicker = document.getElementById('tagEditColorPicker');

    // モーダル要素が無い場合のフォールバック (HTMLが古い場合)
    if (!modal || !idEl || !nameEl || !colorPicker) {
      console.error('[ImageGallery] tagEditModal要素が見つかりません。HTMLを最新版に差し替えてください。');
      // promptでの簡易編集にフォールバック
      const newName = prompt('タグ名を変更 (HTMLが古いため簡易モード):', tag.name);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) { toast('タグ名は空にできません', 'error'); return; }
      const data = dataCache[currentShopId];
      if (data.tags.some(t => t.id !== tagId && t.name === trimmed)) {
        toast('同じ名前のタグが既にあります', 'error'); return;
      }
      const old = tag.name;
      tag.name = trimmed;
      showLoading('保存中...');
      saveShopData(currentShopId, `rename tag: ${old} -> ${trimmed}`)
        .then(() => {
          hideLoading();
          renderTagManageList();
          renderTagFilterDropdown();
          render();
          toast('タグ名を更新しました(色変更にはHTMLの差し替えが必要)', 'success');
        })
        .catch(e => {
          tag.name = old;
          hideLoading();
          toast('保存失敗: ' + e.message, 'error');
        });
      return;
    }

    idEl.value = tag.id;
    nameEl.value = tag.name;
    editingTagSelectedColor = tag.color || 'amber';
    renderTagEditColorPicker();
    modal.style.display = 'flex';
  } catch (e) {
    console.error('[ImageGallery] editTag failed:', e);
    toast('編集モーダルを開けません: ' + e.message, 'error');
  }
}

function renderTagEditColorPicker() {
  const wrap = document.getElementById('tagEditColorPicker');
  wrap.innerHTML = TAG_COLORS.map(c => `
    <div class="color-swatch ${c.id === editingTagSelectedColor ? 'selected' : ''}"
         data-color="${c.id}"
         style="background:${c.bg};color:${c.fg}"
         title="${c.id}">●</div>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      editingTagSelectedColor = el.dataset.color;
      renderTagEditColorPicker();
    });
  });
}

async function saveTagEdit() {
  const id = document.getElementById('tagEditId').value;
  const tag = findTag(id);
  if (!tag) { toast('タグが見つかりません', 'error'); return; }
  const newName = document.getElementById('tagEditName').value.trim();
  if (!newName) { toast('タグ名は空にできません', 'error'); return; }

  const data = dataCache[currentShopId];
  if (data.tags.some(t => t.id !== id && t.name === newName)) {
    toast('同じ名前のタグが既にあります', 'error'); return;
  }

  const oldName = tag.name;
  const oldColor = tag.color;
  tag.name = newName;
  tag.color = editingTagSelectedColor;

  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `edit tag: ${oldName} -> ${newName}`);
    hideLoading();
    closeModal('tagEditModal');
    renderTagManageList();
    renderTagFilterDropdown();
    render();
    toast('タグを更新しました', 'success');
  } catch (e) {
    // ロールバック
    tag.name = oldName;
    tag.color = oldColor;
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

async function deleteTag(tagId) {
  const tag = findTag(tagId);
  if (!tag) return;
  const usage = countTagUsage(tagId);
  const msg = usage > 0
    ? `タグ「${tag.name}」を削除します。\n${usage}件の商品からも自動で外されます。\n続行しますか?`
    : `タグ「${tag.name}」を削除します。続行しますか?`;
  if (!confirm(msg)) return;
  const data = dataCache[currentShopId];
  const tagIndex = data.tags.findIndex(t => t.id === tagId);
  if (tagIndex < 0) return;
  data.products.forEach(p => {
    if (Array.isArray(p.tagIds)) {
      p.tagIds = p.tagIds.filter(id => id !== tagId);
    }
  });
  const removed = data.tags.splice(tagIndex, 1)[0];
  filterTagIds.delete(tagId);
  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `delete tag: ${tag.name}`);
    hideLoading();
    renderTagManageList();
    renderTagFilterDropdown();
    render();
    toast('タグを削除しました', 'success');
  } catch (e) {
    data.tags.splice(tagIndex, 0, removed);
    hideLoading();
    toast('削除失敗: ' + e.message, 'error');
  }
}

// 検索行に常時表示するタグフィルタ (v1.7.5)
// クリックでそのタグの絞り込みをON/OFF
function renderTagFilterInline() {
  const wrap = document.getElementById('tagFilterInline');
  if (!wrap) return;
  // v1.11.12: お気に入り廃止 → フィルタチップからお気に入りを除外。残りはタグ配列順(=指定の並び順)。
  const favTagId = getFavoriteTagId();
  const sortedTags = getCurrentTags().filter(t => t.id !== favTagId);
  if (sortedTags.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  const clearBtn = filterTagIds.size > 0
    ? `<button class="tag-filter-inline-clear" id="btnClearTagFilter" title="フィルタ解除">✕</button>`
    : '';
  wrap.innerHTML = sortedTags.map(t => {
    const c = getTagColor(t.color);
    const active = filterTagIds.has(t.id);
    return `<button class="tag-filter-chip ${active ? 'on' : 'off'}"
      data-filter-tag="${t.id}"
      style="--tag-bg:${c.bg};--tag-fg:${c.fg}"
      title="${escapeHtml(t.name)}でフィルタ">${escapeHtml(t.name)}</button>`;
  }).join('') + clearBtn;

  wrap.querySelectorAll('[data-filter-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.filterTag;
      // v1.11.13: 単一選択。選択中のをクリックで解除、別のをクリックで切り替え(前の選択は消える)
      const wasActive = filterTagIds.has(id);
      filterTagIds.clear();
      if (!wasActive) filterTagIds.add(id);
      saveFilterTags();
      renderTagFilterInline();
      render();
    });
  });
  const cb = document.getElementById('btnClearTagFilter');
  if (cb) {
    cb.addEventListener('click', () => {
      filterTagIds.clear();
      saveFilterTags();
      renderTagFilterInline();
      render();
    });
  }
}

// v1.11.27: タグフィルタの選択をこの端末に保存
function saveFilterTags() {
  try { localStorage.setItem(LS_FILTER_TAGS, JSON.stringify([...filterTagIds])); } catch (e) { /* ignore */ }
}

// 旧名互換ラッパー (他から呼ばれても安全に動くように)
function renderTagFilterDropdown() { renderTagFilterInline(); }
function updateTagFilterIndicator() { renderTagFilterInline(); }
function toggleTagFilterDropdown() { /* ドロップダウン廃止のため何もしない */ }

async function clearAllProducts() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) return;
  // v1.11.33: 部品(isPart)はクリア対象外。商品のみカウント。
  const count = data.products.filter(p => !p.isPart).length;
  if (count === 0) { toast('クリア対象の商品がありません', 'error'); return; }

  if (!confirm(`「${shop.name}」の商品データを全てクリアします。\n\n対象: ${count}件の商品(画像紐づけも含む)\n※ 部品は削除されません／既にアップロードされた画像ファイル自体はGitHub上に残ります\n\n本当に実行しますか?`)) return;
  if (!confirm(`もう一度確認: ${count}件の商品データを削除します。元に戻せません。続行しますか?`)) return;

  showLoading('商品データをクリア中...');
  try {
    data.products = data.products.filter(p => p.isPart); // 部品は残す
    await saveShopData(currentShopId, `clear all products (${count} items)`);
    hideLoading();
    toast(`${count}件の商品データを削除しました`, 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('クリア失敗: ' + e.message, 'error');
  }
}

// =====================================================
// Yahoo!ショッピング 商品取り込み (Yahoo v1.0.0)
// =====================================================
// ⚠️ Yahoo商品検索API (shopping.yahooapis.jp) は CORS ヘッダを返さない。ブラウザから fetch しても読めない。
//    そのため API 呼び出しは GitHub Actions (.github/workflows/yahoo-sync.yml → scripts/yahoo-fetch.mjs) が行い、
//    結果を data/{shopId}/yahoo-products.json にコミットする。Client ID は GitHub Secrets (YAHOO_CLIENT_ID)。
//
// ⚠️ Actions は gallery.json に一切触れない。gallery.json への反映(マージ)は必ずこのブラウザ側で行う。
//    Actions が gallery.json を直接書くと、画像を編集中の人の保存 (409→SHA取り直し→手元の内容で上書き) で
//    Actions が足した商品が消える、という競合が起きるため。
//
// 取り込みの経路は3つ。どれも buildYahooMergePlan → 確認画面 → applyYahooMergePlan の同じ道を通る。
//   ① Yahooから同期   : workflow_dispatch で Actions を起動 → 完了を待つ → yahoo-products.json を読む
//   ② 商品CSV        : ストアクリエイターProの「商品データ」CSV (data.csv / Shift_JIS)
//   ③ 取得済みの一覧  : GitHubの画面で Actions を実行した後などに yahoo-products.json だけを読む
//
// マージの鉄則 (楽天版 syncProducts と同じ): 商品の追加と、商品名・価格・URL・サムネURLの更新だけ。
//   images[] / tags / tagId / status / itemNumber には絶対に触れない。一覧に無い既存商品も削除しない。
// 主キーは itemManageNumber (= Yahooの商品コード)。Yahooは大文字小文字の揺れがある (URLは小文字) ので、
//   照合は小文字で行う。
const YAHOO_API_LABEL = 'ShoppingWebService V3 itemSearch';
const YAHOO_SYNC_WORKFLOW = 'yahoo-sync.yml';
const YAHOO_PRODUCTS_FILE = 'yahoo-products.json';
const YAHOO_RUN_TIMEOUT_MS = 8 * 60 * 1000;
const YAHOO_RUN_POLL_MS = 4000;
let _yahooLast = null;          // 診断ログ用: {at, summary}
let _yahooPendingPlan = null;   // 確認画面で表示中の取り込み計画

const _ySleep = (ms) => new Promise(r => setTimeout(r, ms));

function _yNote(summary) { _yahooLast = { at: Date.now(), summary }; }

// 全角英数記号→半角、前後空白除去
function _yNormCode(v) {
  return String(v == null ? '' : v)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .trim();
}
function _yKey(v) { return _yNormCode(v).toLowerCase(); }

function _yPrice(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function yahooItemUrl(sellerId, code) {
  return `https://store.shopping.yahoo.co.jp/${encodeURIComponent(String(sellerId).toLowerCase())}/${encodeURIComponent(String(code).toLowerCase())}.html`;
}
function yahooThumbUrl(sellerId, code) {
  return `https://item-shopping.c.yimg.jp/i/l/${encodeURIComponent(String(sellerId).toLowerCase())}_${encodeURIComponent(String(code).toLowerCase())}`;
}

// 正規化済みの1商品 {code, name, price, url, image, yahooId, _derived}
//   _derived: URL等をストアIDと商品コードから組み立てた(=APIの実値ではない)項目。既存の値は上書きしない。
function _yahooItem(shop, raw) {
  const code = _yNormCode(raw && raw.code);
  if (!code) return null;
  const seller = String((shop && shop.shopCode) || '').toLowerCase();
  const derived = {};
  let url = raw.url || '';
  let image = raw.image || '';
  let yahooId = raw.yahooId || '';
  if (!url && seller) { url = yahooItemUrl(seller, code); derived.url = true; }
  if (!image && seller) { image = yahooThumbUrl(seller, code); derived.image = true; }
  if (!yahooId && seller) { yahooId = `${seller}_${code}`; derived.yahooId = true; }
  return { code, name: String(raw.name || '').trim(), price: _yPrice(raw.price), url, image, yahooId, _derived: derived };
}

// 現在の商品データと突き合わせて、何が増えて何が変わるかを計算する (この時点ではデータを変更しない)
function buildYahooMergePlan(items, source) {
  const data = dataCache[currentShopId];
  const byKey = new Map();
  ((data && data.products) || []).forEach(p => {
    if (p.isPart || !p.itemManageNumber) return;     // 部品は対象外
    const k = _yKey(p.itemManageNumber);
    if (!byKey.has(k)) byKey.set(k, p);
  });
  const plan = { source, items, added: [], updated: [], unchanged: 0, duplicates: 0, missing: 0 };
  const seen = new Set();
  items.forEach(it => {
    const k = _yKey(it.code);
    if (!k) return;
    if (seen.has(k)) { plan.duplicates++; return; }
    seen.add(k);
    const p = byKey.get(k);
    if (!p) { plan.added.push(it); return; }
    const fields = {};
    const d = it._derived || {};
    if (it.name && it.name !== (p.itemName || '')) fields.itemName = [p.itemName || '', it.name];
    if (it.price != null && Number(it.price) !== Number(p.itemPrice)) fields.itemPrice = [p.itemPrice ?? '', it.price];
    // 組み立てたURL類は「空のときだけ」入れる (APIの実値を、CSV由来の推測値で上書きしない)
    const setIf = (key, cur, val, derived) => {
      if (!val || val === cur) return;
      if (derived && cur) return;
      fields[key] = [cur || '', val];
    };
    setIf('itemUrl', p.itemUrl || '', it.url, d.url);
    setIf('thumbUrl', p.thumbUrl || '', it.image, d.image);
    setIf('itemCode', p.itemCode || '', it.yahooId, d.yahooId);
    if (Object.keys(fields).length) plan.updated.push({ product: p, item: it, fields });
    else plan.unchanged++;
  });
  plan.missing = [...byKey.keys()].filter(k => !seen.has(k)).length;
  return plan;
}

const _Y_FIELD_LABEL = { itemName: '商品名', itemPrice: '価格', itemUrl: 'URL', thumbUrl: 'サムネ', itemCode: 'Yahoo商品ID' };

function ensureYahooImportModal() {
  if (document.getElementById('yahooImportModal')) return;
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.id = 'yahooImportModal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header">
        <h2>📦 Yahoo商品の取り込み</h2>
        <button class="btn-close" data-yimp-close aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="yimp-source" id="yimpSource"></div>
        <div id="yimpSummary"></div>
        <div id="yimpPreview"></div>
        <div class="modal-actions">
          <button class="btn-secondary" data-yimp-close>キャンセル</button>
          <button class="btn-primary" id="yimpConfirm">取り込む</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-yimp-close]').forEach(b => b.addEventListener('click', () => {
    m.style.display = 'none';
    _yahooPendingPlan = null;
  }));
  m.querySelector('#yimpConfirm').addEventListener('click', applyYahooMergePlan);
}

// 取り込み確認画面。items が0件のときは画面を出さず、赤で理由を出す (「0件で完了」と見せない)
function openYahooImportPreview(items, source) {
  if (!items || items.length === 0) {
    const why = source.skipped ? `（商品コードを読めない行が ${source.skipped}件）` : '';
    toast(`${source.label}: 取り込める商品が0件でした${why}`, 'error');
    console.warn(`[Yahoo取り込み] 0件 source=${source.label}`, source);
    _yNote(`${source.label}: 0件（取り込みなし）`);
    return;
  }
  ensureYahooImportModal();
  const plan = buildYahooMergePlan(items, source);
  _yahooPendingPlan = plan;

  const srcLines = [`<div><strong>取得元:</strong> ${escapeHtml(source.label)}${source.fileName ? ` ／ ${escapeHtml(source.fileName)}` : ''}</div>`];
  if (source.fetchedAt) srcLines.push(`<div><strong>取得日時:</strong> ${escapeHtml(_fmtClock(Date.parse(source.fetchedAt)))}（${escapeHtml(_fmtAgo(Date.parse(source.fetchedAt)))}）</div>`);
  if (source.totalAvailable != null) srcLines.push(`<div><strong>Yahoo上の総件数:</strong> ${source.totalAvailable}件 ／ 取得 ${items.length}件</div>`);
  const warns = [];
  if (source.truncated) warns.push('Yahoo APIの上限（1回の検索で1,000件）により、取得しきれなかった商品があります。CSVからの取り込みも併用してください。');
  if (source.totalAvailable != null && items.length < source.totalAvailable && !source.truncated) warns.push(`Yahoo上の総件数より ${source.totalAvailable - items.length}件少なく取得されました（非公開・検索対象外の商品は商品検索APIでは取れません。必要ならCSVで取り込んでください）。`);
  if (source.skipped) warns.push(`商品コードを読めず飛ばした行が ${source.skipped}件あります。`);
  if (plan.duplicates) warns.push(`同じ商品コードの重複が ${plan.duplicates}件あったため、最初の1件だけを使いました。`);
  document.getElementById('yimpSource').innerHTML = srcLines.join('') + warns.map(w => `<div class="yimp-warn">⚠️ ${escapeHtml(w)}</div>`).join('');

  document.getElementById('yimpSummary').innerHTML = `
    <div class="csv-stats">
      <div class="csv-stat"><div class="csv-stat-num">${items.length}</div><div class="csv-stat-label">取得件数</div></div>
      <div class="csv-stat csv-stat-ok"><div class="csv-stat-num">${plan.added.length}</div><div class="csv-stat-label">新規追加</div></div>
      <div class="csv-stat csv-stat-ok"><div class="csv-stat-num">${plan.updated.length}</div><div class="csv-stat-label">情報を更新</div></div>
      <div class="csv-stat"><div class="csv-stat-num">${plan.unchanged}</div><div class="csv-stat-label">変更なし</div></div>
    </div>`;

  let html = '';
  if (plan.added.length) {
    html += `<h4 class="csv-h">新しく追加される商品 (${plan.added.length}件)</h4><div class="csv-change-list">`;
    plan.added.slice(0, 50).forEach(it => {
      html += `<div class="csv-change"><div class="csv-change-manage">${escapeHtml(it.code)}</div><div class="csv-change-detail">${escapeHtml(it.name || '（商品名なし）')}${it.price != null ? `<span class="yimp-price">¥${Number(it.price).toLocaleString()}</span>` : ''}</div></div>`;
    });
    if (plan.added.length > 50) html += `<div class="csv-more">…他 ${plan.added.length - 50} 件</div>`;
    html += '</div>';
  }
  if (plan.updated.length) {
    html += `<h4 class="csv-h">情報が更新される商品 (${plan.updated.length}件) <small style="font-weight:400">※画像・タグはそのまま</small></h4><div class="csv-change-list">`;
    plan.updated.slice(0, 30).forEach(u => {
      html += `<div class="csv-change"><div class="csv-change-manage">${escapeHtml(u.product.itemManageNumber)}</div><div class="csv-change-detail">`;
      Object.entries(u.fields).forEach(([k, [o, n]]) => {
        const short = (v) => { const t = String(v ?? ''); return t.length > 60 ? t.slice(0, 60) + '…' : t; };
        html += `<div class="csv-diff"><span class="csv-label">${_Y_FIELD_LABEL[k] || k}</span><span class="csv-old">${escapeHtml(short(o) || '—')}</span> → <span class="csv-new">${escapeHtml(short(n))}</span></div>`;
      });
      html += '</div></div>';
    });
    if (plan.updated.length > 30) html += `<div class="csv-more">…他 ${plan.updated.length - 30} 件</div>`;
    html += '</div>';
  }
  if (!plan.added.length && !plan.updated.length) {
    html += '<div class="csv-empty">すべての商品が最新の状態です ✨</div>';
  }
  if (plan.missing) {
    html += `<div class="csv-hint">💡 今回の一覧に含まれない既存商品が ${plan.missing}件あります。<strong>削除はしません</strong>（販売終了品の整理は「商品削除」から手動で行ってください）。</div>`;
  }
  document.getElementById('yimpPreview').innerHTML = html;
  const btn = document.getElementById('yimpConfirm');
  btn.disabled = !plan.added.length && !plan.updated.length;
  btn.textContent = btn.disabled ? '取り込む（変更なし）' : `取り込む（新規${plan.added.length}件 / 更新${plan.updated.length}件）`;
  document.getElementById('yahooImportModal').style.display = 'flex';
}

async function applyYahooMergePlan() {
  const plan0 = _yahooPendingPlan;
  if (!plan0) return;
  if (!auth.pat) { toast('取り込み（保存）には編集権限(PAT)が必要です', 'error'); return; }
  const shopId = currentShopId;
  showLoading('GitHubの最新データを確認中…');
  try {
    // 取り込み直前に最新を読み直してから合流させる (画面を開いた後の他の人の変更を上書きしないため)
    const fresh = await loadShopData(shopId);
    if (fresh._wasEmpty || fresh._parseError || fresh._loadFailed) {
      throw new Error('GitHub上のデータを正しく読めなかったため、取り込みを中止しました（データ保護のため）。GitHub同期 → 診断ログを確認してください');
    }
    const prev = dataCache[shopId];
    // 安全策: 手元に商品があるのに読み直したら0件 → 異常とみなして中止
    if (prev && (prev.products || []).length > 0 && (fresh.products || []).length === 0) {
      throw new Error('GitHubから0件のデータが返ったため、取り込みを中止しました（データ保護のため）');
    }
    dataCache[shopId] = fresh;
    const plan = buildYahooMergePlan(plan0.items, plan0.source);
    const data = dataCache[shopId];
    const now = new Date().toISOString();
    plan.updated.forEach(u => {
      Object.entries(u.fields).forEach(([k, [, v]]) => { u.product[k] = v; });
      u.product.syncedAt = now;
    });
    plan.added.forEach(it => {
      data.products.push({
        id: 'prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        itemCode: it.yahooId || '',          // Yahoo商品ID (ストアID_商品コード)。参考保持
        itemManageNumber: it.code,           // 主キー = Yahoo商品コード
        itemNumber: '',
        itemUrl: it.url || '',
        itemName: it.name || it.code,
        itemPrice: it.price,
        thumbUrl: it.image || '',
        images: [],
        status: 'active',
        syncedAt: now
      });
    });
    if (!plan.added.length && !plan.updated.length) {
      hideLoading();
      document.getElementById('yahooImportModal').style.display = 'none';
      _yahooPendingPlan = null;
      toast('変更はありませんでした（すでに最新です）', 'success');
      render();
      return;
    }
    showLoading(`保存中…（新規${plan.added.length}件 / 更新${plan.updated.length}件）`);
    await saveShopData(shopId, `yahoo import (${plan.source.label}): +${plan.added.length} new, ${plan.updated.length} updated`);
    hideLoading();
    document.getElementById('yahooImportModal').style.display = 'none';
    _yahooPendingPlan = null;
    _yNote(`${plan.source.label}: 取り込み完了 新規${plan.added.length} / 更新${plan.updated.length} / 合計${data.products.length}`);
    toast(`取り込み完了: 新規${plan.added.length}件、更新${plan.updated.length}件（合計${data.products.filter(p => !p.isPart).length}件）`, 'success');
    render();
  } catch (e) {
    hideLoading();
    console.error('[Yahoo取り込み] 失敗', e);
    _yNote(`${plan0.source.label}: 取り込み失敗 ${e.message}`);
    toast('取り込み失敗: ' + e.message, 'error');
  }
}

function _yCheckShop(opts = {}) {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return null; }
  if (!shop.shopCode) { toast('YahooストアID（seller_id）が未設定です。⚙️設定 → ショップの「編集」で入力してください', 'error'); return null; }
  if (!/^[a-z0-9_-]+$/i.test(shop.shopCode)) { toast(`ストアID「${shop.shopCode}」に使えない文字が入っています（英数字・-・_ のみ）`, 'error'); return null; }
  if (opts.needPat && !auth.pat) { toast(opts.patMessage || '取り込み（保存）には編集権限(PAT)が必要です。⚙️設定で登録してください', 'error'); return null; }
  if (!dataCache[currentShopId]) { toast('データ未読み込みです', 'error'); return null; }
  return shop;
}

// ===== ① Yahooから同期 (GitHub Actions を起動して待つ) =====
// 楽天版の syncProducts と同じ名前にしておく (bindEvents の「商品同期」ボタンがこれを呼ぶ)
async function syncProducts() {
  const shop = _yCheckShop({ needPat: true, patMessage: 'Yahoo同期には編集権限(PAT)が必要です（GitHub Actionsの起動と保存に使います）' });
  if (!shop) return;
  const branch = auth.branch || 'main';
  const t0 = Date.now();
  showLoading('GitHub Actions を起動中…');
  try {
    // 起動前の最新の実行IDを控えておき、それより新しい実行を「今回の実行」とみなす (PCの時計ずれに強い)
    const prevRunId = await _yLatestRunId(branch);
    const res = await ghFetch(`actions/workflows/${YAHOO_SYNC_WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: branch, inputs: { shop_id: shop.id, seller_id: shop.shopCode } })
    });
    if (res.status !== 204) throw new Error(await _yDispatchError(res, branch));
    _yNote(`Actions起動 (seller_id=${shop.shopCode})`);

    const run = await _yWaitForRun(prevRunId, t0, branch);
    if (run.conclusion !== 'success') {
      const why = await _yRunFailureReason(run);
      console.error(`[Yahoo同期] Actionsが失敗 conclusion=${run.conclusion} 実行ログ: ${run.html_url} ${why}`);
      throw new Error(`GitHub Actionsが失敗しました${why ? '：' + why : ''}（詳細はGitHubのActions画面）`);
    }
    await importLatestYahooFetch({ notBefore: t0 - 2 * 60 * 1000 });
  } catch (e) {
    hideLoading();
    console.error('[Yahoo同期] 失敗', e);
    _yNote(`Yahoo同期失敗: ${e.message}`);
    toast('Yahoo同期失敗: ' + e.message, 'error');
  }
}

async function _yLatestRunId(branch) {
  try {
    const r = await ghFetch(`actions/workflows/${YAHOO_SYNC_WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
    if (!r.ok) return null;
    const j = await r.json();
    const w = (j.workflow_runs || [])[0];
    return w ? w.id : 0;
  } catch (e) { return null; }
}

async function _yDispatchError(res, branch) {
  let msg = '';
  try { const j = await res.json(); msg = j.message || ''; } catch (e) {}
  if (res.status === 404) return `ワークフロー「${YAHOO_SYNC_WORKFLOW}」が見つかりません。リポジトリの .github/workflows/ に置かれているか、ブランチ「${branch}」が正しいか確認してください`;
  if (res.status === 401) return 'PATが無効です（期限切れ・入力ミス）。⚙️設定でPATを確認してください';
  if (res.status === 403) return 'PATにGitHub Actionsを実行する権限がありません（Fine-grained PATなら「Actions: Read and write」を追加、Classic PATなら repo スコープ）';
  if (res.status === 422) return `GitHubが起動を拒否しました: ${msg || 'ワークフローに workflow_dispatch の設定があるか確認してください'}`;
  return `GitHub Actionsを起動できませんでした (HTTP ${res.status}${msg ? ' ' + msg : ''})`;
}

async function _yWaitForRun(prevRunId, t0, branch) {
  let runId = null;
  while (Date.now() - t0 < YAHOO_RUN_TIMEOUT_MS) {
    await _ySleep(YAHOO_RUN_POLL_MS);
    const secs = Math.round((Date.now() - t0) / 1000);
    if (!runId) {
      showLoading(`GitHub Actions の開始を待っています…（${secs}秒）`);
      const r = await ghFetch(`actions/workflows/${YAHOO_SYNC_WORKFLOW}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=10`);
      if (!r.ok) continue;
      const j = await r.json();
      const runs = (j.workflow_runs || []).filter(w =>
        prevRunId != null ? w.id > prevRunId : Date.parse(w.created_at) >= t0 - 60 * 1000);
      runs.sort((a, b) => b.id - a.id);
      if (!runs[0]) continue;
      runId = runs[0].id;
      if (runs[0].status === 'completed') return runs[0];
      continue;
    }
    showLoading(`Yahooから商品一覧を取得中…（${secs}秒） ／ 1,000件でおよそ1〜2分かかります`);
    const r = await ghFetch(`actions/runs/${runId}`);
    if (!r.ok) continue;
    const run = await r.json();
    if (run.status === 'completed') return run;
  }
  throw new Error('8分待ってもGitHub Actionsが終わりませんでした。GitHubのActions画面で状況を確認し、終わっていれば「取得済みの一覧を取り込む」を押してください');
}

// 失敗理由をできるだけ具体的に拾う (失敗した手順名 + スクリプトが出した ::error:: の文言)
async function _yRunFailureReason(run) {
  try {
    const jr = await ghFetch(`actions/runs/${run.id}/jobs`);
    if (!jr.ok) return '';
    const jobs = (await jr.json()).jobs || [];
    const job = jobs.find(x => x.conclusion && x.conclusion !== 'success') || jobs[0];
    if (!job) return '';
    const parts = [];
    const step = (job.steps || []).find(s => s.conclusion === 'failure');
    if (step) parts.push(`失敗した手順「${step.name}」`);
    const ar = await ghFetch(`check-runs/${job.id}/annotations`);
    if (ar.ok) {
      const anns = await ar.json();
      (Array.isArray(anns) ? anns : [])
        .filter(a => a.annotation_level === 'failure' && !/Process completed with exit code/i.test(a.message || ''))
        .slice(0, 3)
        .forEach(a => parts.push(a.message));
    }
    return parts.join(' / ');
  } catch (e) { return ''; }
}

// ===== ③ 取得済みの一覧 (data/{shopId}/yahoo-products.json) を取り込む =====
async function importLatestYahooFetch(opts = {}) {
  const shop = _yCheckShop({ needPat: true });
  if (!shop) { hideLoading(); return; }
  showLoading('Yahooの取得結果を読み込み中…');
  try {
    const path = `data/${shop.id}/${YAHOO_PRODUCTS_FILE}`;
    // raw.githubusercontent.com はCDNキャッシュで数分古いことがあるので、Contents API の raw 形式で読む
    const res = await ghFetch(`contents/${path}?ref=${encodeURIComponent(auth.branch || 'main')}&t=${Date.now()}`,
      { headers: { 'Accept': 'application/vnd.github.raw+json' }, cache: 'no-store' });
    if (res.status === 404) throw new Error('まだYahooからの取得結果がありません。先に「Yahooから同期」を実行してください');
    if (!res.ok) throw new Error(`取得結果の読み込みに失敗しました (HTTP ${res.status})`);
    let json;
    try { json = JSON.parse(await res.text()); }
    catch (e) { throw new Error(`${YAHOO_PRODUCTS_FILE} が壊れています（JSONとして読めません）`); }
    if (!json || !Array.isArray(json.items)) throw new Error(`${YAHOO_PRODUCTS_FILE} の形式が正しくありません`);
    if (json.sellerId && String(json.sellerId).toLowerCase() !== String(shop.shopCode).toLowerCase()) {
      throw new Error(`取得結果のストアID「${json.sellerId}」と、このショップのストアID「${shop.shopCode}」が一致しません`);
    }
    if (opts.notBefore && Date.parse(json.fetchedAt || 0) < opts.notBefore) {
      throw new Error('今回の取得結果がまだGitHubに反映されていません。少し待ってから「取得済みの一覧を取り込む」を押してください');
    }
    const items = json.items.map(x => _yahooItem(shop, x)).filter(Boolean);
    hideLoading();
    _yNote(`取得結果を読み込み: ${items.length}件 (取得 ${json.fetchedAt || '?'} / 総件数 ${json.totalAvailable ?? '?'}${json.truncated ? ' / 上限で打ち切り' : ''})`);
    openYahooImportPreview(items, {
      label: 'Yahoo商品検索API',
      fetchedAt: json.fetchedAt,
      totalAvailable: json.totalAvailable,
      truncated: !!json.truncated,
      skipped: (json.skipped || 0) + (json.items.length - items.length)
    });
  } catch (e) {
    hideLoading();
    console.error('[Yahoo取り込み] 取得結果の読み込み失敗', e);
    _yNote(`取得結果の読み込み失敗: ${e.message}`);
    toast(e.message, 'error');
  }
}

// ===== ② ストアクリエイターProの商品CSV =====
// 想定: 商品管理 → 商品データのダウンロードで得られる data.csv (Shift_JIS、英字ヘッダ)
//   code=商品コード / name=商品名 / price=販売価格 (original-price=メーカー希望小売価格)
//   説明文(caption/explanation)はHTMLと改行を含むので、改行入りの "…" に対応したパーサが必須。
//   日本語ヘッダ (商品コード / 商品名 / 販売価格) のCSVも受け付ける。
function parseYahooItemCsv(text, shop) {
  const { headers, rows } = parseCsv(text);
  const H = headers.map(h => String(h).replace(/^﻿/, '').trim().toLowerCase());
  const find = (...names) => { for (const n of names) { const i = H.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const iCode = find('code', '商品コード');
  const iName = find('name', '商品名');
  const iPrice = find('price', '販売価格', '通常販売価格');
  if (iCode < 0) {
    throw new Error('CSVに「code（商品コード）」列がありません。ストアクリエイターProの「商品データ」CSVを指定してください');
  }
  const items = [];
  let skipped = 0;
  rows.forEach(r => {
    const it = _yahooItem(shop, { code: r[iCode], name: iName >= 0 ? r[iName] : '', price: iPrice >= 0 ? r[iPrice] : null });
    if (it) items.push(it); else skipped++;
  });
  return { items, rowCount: rows.length, skipped };
}

async function handleYahooCsvFile(file) {
  const shop = _yCheckShop({ needPat: true });
  if (!shop) return;
  showLoading('CSVを読み込み中…');
  try {
    const text = await decodeCsvFile(file);
    const r = parseYahooItemCsv(text, shop);
    hideLoading();
    _yNote(`商品CSV「${file.name}」: ${r.rowCount}行 → ${r.items.length}件`);
    openYahooImportPreview(r.items, { label: '商品CSV', fileName: file.name, skipped: r.skipped });
  } catch (e) {
    hideLoading();
    console.error('[Yahoo取り込み] CSV読み込み失敗', e);
    _yNote(`商品CSV読み込み失敗: ${e.message}`);
    toast('CSV読み込み失敗: ' + e.message, 'error');
  }
}

// 「＋ 商品追加」モーダルに3つの取り込み口を並べる
function setupYahooHub() {
  const syncCard = document.getElementById('btnHubSyncProducts');
  if (!syncCard || document.getElementById('btnHubYahooCsv')) return;
  const t = syncCard.querySelector('.add-hub-card-title');
  const d = syncCard.querySelector('.add-hub-card-desc');
  if (t) t.textContent = 'Yahooから同期（自動取得）';
  if (d) d.textContent = 'GitHub Actionsで商品検索APIを実行し、商品一覧を取り込みます（1〜2分）';
  const mk = (id, icon, title, desc) => {
    const b = document.createElement('button');
    b.className = 'add-hub-card';
    b.id = id;
    b.innerHTML = `<div class="add-hub-card-icon">${icon}</div><div class="add-hub-card-title">${title}</div><div class="add-hub-card-desc">${desc}</div>`;
    return b;
  };
  const csvCard = mk('btnHubYahooCsv', '📄', '商品CSVから取り込み', 'ストアクリエイターProの「商品データ」CSV（data.csv）を読み込みます。非公開の商品も入ります');
  const lastCard = mk('btnHubYahooLast', '📥', '取得済みの一覧を取り込む', 'GitHubの画面でワークフローを実行した後や、同期が途中で止まったときに');
  syncCard.parentNode.appendChild(csvCard);
  syncCard.parentNode.appendChild(lastCard);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.id = 'yahooCsvInput';
  input.style.display = 'none';
  document.body.appendChild(input);
  csvCard.addEventListener('click', () => { closeModal('addHubModal'); input.value = ''; input.click(); });
  input.addEventListener('change', () => { if (input.files && input.files[0]) handleYahooCsvFile(input.files[0]); });
  lastCard.addEventListener('click', () => { closeModal('addHubModal'); importLatestYahooFetch(); });
}

// 診断ログに入れる Yahoo 同期の状況 (認証情報は含めない)
function yahooDiagLines() {
  const L = [];
  L.push(`- 同期ワークフロー: .github/workflows/${YAHOO_SYNC_WORKFLOW}（Client IDは Secrets の YAHOO_CLIENT_ID）`);
  L.push(`- 取得結果ファイル: data/${currentShopId || '?'}/${YAHOO_PRODUCTS_FILE}`);
  L.push(_yahooLast
    ? `- 直近の操作: ${_fmtClock(_yahooLast.at).slice(5)} ${_yahooLast.summary}`
    : '- このページを開いてからの取得/取り込み: なし');
  return L;
}

// =====================================================
// CSVインポート (商品名称一括更新)
// =====================================================
let pendingCsvImport = null;

// Yahoo v1.0.0: 改行入りの "…" に対応したCSVパーサ (RFC 4180)。
//   楽天版は「先に行で分割してから列を分ける」方式で、Yahooの商品CSVの説明文(改行入りHTML)を読むと行がずれる。
function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const all = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); all.push(row);
      row = []; cur = '';
    } else {
      cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); all.push(row); }
  const lines = all.filter(r => r.some(v => String(v).trim() !== ''));
  if (lines.length === 0) return { headers: [], rows: [] };
  return { headers: lines[0].map(h => String(h).trim()), rows: lines.slice(1) };
}

// Yahoo v1.0.0: CSVの文字コードを自動判定 (UTF-8 / BOM付きUTF-8 / Shift_JIS)。
//   ストアクリエイターProのCSVは Shift_JIS。file.text() で読むと文字化けする。
async function decodeCsvFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return new TextDecoder('utf-8').decode(buf.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('shift_jis').decode(buf); }
}

function openCsvImportModal() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データ未読み込みです', 'error'); return; }

  // 状態リセット
  pendingCsvImport = null;
  document.getElementById('csvImportSummary').innerHTML = '';
  document.getElementById('csvImportPreview').innerHTML = '';
  document.getElementById('btnConfirmCsvImport').style.display = 'none';
  document.getElementById('csvDropzone').style.display = 'flex';
  document.getElementById('csvImportModal').style.display = 'flex';
}

async function handleCsvFile(file) {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データ未読み込みです', 'error'); return; }

  // CSVモーダルが閉じていれば開く
  if (document.getElementById('csvImportModal').style.display === 'none') {
    openCsvImportModal();
  }

  try {
    const text = await decodeCsvFile(file);   // Yahoo v1.0.0: Shift_JIS のCSVも読めるように
    const { headers, rows } = parseCsv(text);

    // 必須カラム検出
    // Yahoo版: 「商品コード」(本ツールの基礎情報DL) / code (ストアクリエイターProの商品CSV) / 旧「商品管理番号」を受け付ける
    const idxManage = headers.findIndex(h => h.includes('商品管理番号') || h === '商品コード' || ['managenumber', 'code'].includes(h.toLowerCase()));
    const idxNumber = headers.findIndex(h => h.includes('商品番号') && !h.includes('管理'));
    const idxName = headers.findIndex(h => h.includes('商品名') || h.toLowerCase() === 'name');

    if (idxManage < 0) {
      toast('CSVに「商品コード」列（または code 列）がありません', 'error');
      return;
    }

    // 既存商品を管理番号でインデックス (寛容マッチ用に複数キーで登録)
    const productsByManage = new Map();
    data.products.forEach(p => {
      if (p.itemManageNumber) {
        const key = String(p.itemManageNumber).trim();
        productsByManage.set(key, p);
        // 全角→半角変換キーも登録
        const halfwidth = key.replace(/[\uFF10-\uFF19]/g, c =>
          String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
        );
        if (halfwidth !== key) productsByManage.set(halfwidth, p);
      }
    });

    // Yahooの商品コードは大文字小文字の揺れがある(URLは小文字)ので、小文字キーでも引けるようにする
    const productsByManageLower = new Map();
    data.products.forEach(p => { if (p.itemManageNumber) productsByManageLower.set(String(p.itemManageNumber).trim().toLowerCase(), p); });

    const result = {
      total: rows.length,
      updated: 0,
      notFound: 0,
      noChange: 0,
      changes: [],
      notFoundList: [],
      debug: null
    };

    rows.forEach(row => {
      let manage = (row[idxManage] || '').trim();
      if (!manage) return;
      const newNumber = idxNumber >= 0 ? (row[idxNumber] || '').trim() : null;
      const newName = idxName >= 0 ? (row[idxName] || '').trim() : null;

      // 全角→半角に正規化
      manage = manage.replace(/[\uFF10-\uFF19]/g, c =>
        String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
      );

      const p = productsByManage.get(manage) || productsByManageLower.get(manage.toLowerCase());
      if (!p) {
        result.notFound++;
        result.notFoundList.push({ manage, name: newName });
        return;
      }
      const oldNumber = p.itemNumber || '';
      const oldName = p.itemName || '';
      const changedNumber = newNumber !== null && newNumber !== oldNumber;
      const changedName = newName !== null && newName !== oldName;
      if (changedNumber || changedName) {
        result.updated++;
        result.changes.push({
          product: p,
          newNumber: changedNumber ? newNumber : null,
          newName: changedName ? newName : null,
          oldNumber, oldName
        });
      } else {
        result.noChange++;
      }
    });

    // 未マッチが多い場合のデバッグ情報を作る
    if (result.notFound > 0 && data.products.length > 0) {
      const sampleProductKeys = data.products.slice(0, 5).map(p => ({
        itemManageNumber: JSON.stringify(p.itemManageNumber),
        length: p.itemManageNumber ? p.itemManageNumber.length : 0,
        itemUrl: p.itemUrl || '',
      }));
      const sampleCsvKeys = result.notFoundList.slice(0, 5).map(nf => ({
        manage: JSON.stringify(nf.manage),
        length: nf.manage.length
      }));
      result.debug = {
        productCount: data.products.length,
        productSample: sampleProductKeys,
        csvSample: sampleCsvKeys,
        mapSize: productsByManage.size,
        sampleMapKeys: Array.from(productsByManage.keys()).slice(0, 10)
      };
    }

    pendingCsvImport = result;
    showCsvImportPreview(result);
  } catch (e) {
    console.error(e);
    toast('CSV読み込み失敗: ' + e.message, 'error');
  }
}

function showCsvImportPreview(result) {
  // ドロップゾーンを隠してプレビュー表示
  document.getElementById('csvDropzone').style.display = 'none';
  const confirmBtn = document.getElementById('btnConfirmCsvImport');
  confirmBtn.style.display = '';

  const summary = document.getElementById('csvImportSummary');
  summary.innerHTML = `
    <div class="csv-stats">
      <div class="csv-stat"><div class="csv-stat-num">${result.total}</div><div class="csv-stat-label">CSV行数</div></div>
      <div class="csv-stat csv-stat-ok"><div class="csv-stat-num">${result.updated}</div><div class="csv-stat-label">更新対象</div></div>
      <div class="csv-stat"><div class="csv-stat-num">${result.noChange}</div><div class="csv-stat-label">変更なし</div></div>
      <div class="csv-stat csv-stat-warn"><div class="csv-stat-num">${result.notFound}</div><div class="csv-stat-label">未マッチ</div></div>
    </div>
  `;

  const preview = document.getElementById('csvImportPreview');
  if (result.updated === 0 && result.notFound === 0) {
    preview.innerHTML = '<div class="csv-empty">すべての商品が最新の状態です ✨</div>';
    document.getElementById('btnConfirmCsvImport').disabled = true;
  } else {
    document.getElementById('btnConfirmCsvImport').disabled = result.updated === 0;
    let html = '';
    if (result.updated > 0) {
      html += '<h4 class="csv-h">更新される商品 (' + result.updated + '件)</h4>';
      html += '<div class="csv-change-list">';
      result.changes.slice(0, 50).forEach(c => {
        html += '<div class="csv-change">';
        html += `<div class="csv-change-manage">${escapeHtml(c.product.itemManageNumber)}</div>`;
        html += '<div class="csv-change-detail">';
        if (c.newNumber !== null) {
          html += `<div class="csv-diff"><span class="csv-label">商品番号</span><span class="csv-old">${escapeHtml(c.oldNumber || '—')}</span> → <span class="csv-new">${escapeHtml(c.newNumber)}</span></div>`;
        }
        if (c.newName !== null) {
          html += `<div class="csv-diff"><span class="csv-label">商品名</span><span class="csv-old">${escapeHtml(c.oldName || '—')}</span> → <span class="csv-new">${escapeHtml(c.newName)}</span></div>`;
        }
        html += '</div></div>';
      });
      if (result.changes.length > 50) {
        html += `<div class="csv-more">…他 ${result.changes.length - 50} 件</div>`;
      }
      html += '</div>';
    }
    if (result.notFound > 0) {
      html += '<h4 class="csv-h csv-h-warn">CSVにあるがツールに未登録 (' + result.notFound + '件)</h4>';
      html += '<div class="csv-notfound-list">';
      result.notFoundList.slice(0, 20).forEach(nf => {
        html += `<div class="csv-notfound">${escapeHtml(nf.manage)} ${nf.name ? '— ' + escapeHtml(nf.name) : ''}</div>`;
      });
      if (result.notFoundList.length > 20) {
        html += `<div class="csv-more">…他 ${result.notFoundList.length - 20} 件</div>`;
      }
      html += '</div>';
      html += '<div class="csv-hint">💡 これらの商品は、先に「＋ 商品追加」からYahooの商品を取り込んでから、再度CSVをインポートしてください</div>';

      // デバッグ情報
      if (result.debug) {
        html += '<details class="csv-debug"><summary>🔍 デバッグ情報 (開く)</summary>';
        html += '<pre class="csv-debug-pre">' + escapeHtml(JSON.stringify(result.debug, null, 2)) + '</pre>';
        html += '</details>';
      }
    }
    preview.innerHTML = html;
  }

  document.getElementById('csvImportModal').style.display = 'flex';
}

async function confirmCsvImport() {
  if (!pendingCsvImport || pendingCsvImport.updated === 0) return;
  showLoading(`${pendingCsvImport.updated}件の商品を更新中...`);
  try {
    pendingCsvImport.changes.forEach(c => {
      if (c.newNumber !== null) c.product.itemNumber = c.newNumber;
      if (c.newName !== null) c.product.itemName = c.newName;
    });
    await saveShopData(currentShopId, `bulk update from CSV: ${pendingCsvImport.updated} items`);
    hideLoading();
    closeModal('csvImportModal');
    toast(`${pendingCsvImport.updated}件を更新しました`, 'success');
    pendingCsvImport = null;
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

// =====================================================
// ZIP一括画像アップロード
// =====================================================
let pendingBulkImport = null;  // {matched: [{product, files: [...]}], unmatched: [{folder, count}], totalFiles}

function openBulkImagesModal() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  if (!shop.shopCode) { toast('ショップコードが未設定です', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データ未読み込みです', 'error'); return; }

  pendingBulkImport = null;
  document.getElementById('bulkImportSummary').innerHTML = '';
  document.getElementById('bulkImportPreview').innerHTML = '';
  document.getElementById('bulkUploadProgress').style.display = 'none';
  document.getElementById('btnConfirmBulkImport').style.display = 'none';
  document.getElementById('bulkDropzone').style.display = 'flex';
  document.getElementById('bulkImagesModal').style.display = 'flex';
}

async function handleBulkZip(file) {
  if (typeof JSZip === 'undefined') {
    toast('JSZipライブラリが読み込まれていません', 'error');
    return;
  }
  const shop = getCurrentShop();
  if (!shop) return;
  const data = dataCache[currentShopId];
  if (!data) return;

  if (document.getElementById('bulkImagesModal').style.display === 'none') {
    openBulkImagesModal();
  }

  showLoading('ZIPを解析中...');
  try {
    const zip = await JSZip.loadAsync(file);
    const shopCode = String(shop.shopCode).toLowerCase();

    // ファイルを管理番号別にグループ化
    // パス例: yahoo-images/{ストアID}_{商品コード}/1_xxx.jpg
    // → 商品コードにマッチ (パスは小文字化して照合するので、商品側も小文字キーで引く)
    const folderRegex = new RegExp(`(?:^|/)${escapeRegExp(shopCode)}_([^/]+)/([^/]+\\.(jpg|jpeg|png|webp|gif))$`, 'i');
    const groups = new Map();  // manageNumber -> [{path, file}, ...]

    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      const lower = relativePath.toLowerCase();
      const m = lower.match(folderRegex);
      if (!m) return;
      const manageNumber = m[1];
      // 元のパスから実際のファイル名を取得
      const filename = relativePath.split('/').pop();
      if (!groups.has(manageNumber)) groups.set(manageNumber, []);
      groups.get(manageNumber).push({ path: relativePath, filename, entry });
    });

    // 商品とマッチング
    const productsByManage = new Map();
    data.products.forEach(p => {
      if (p.itemManageNumber) productsByManage.set(String(p.itemManageNumber).trim().toLowerCase(), p);
    });

    const matched = [];      // {product, files: [{path, filename, entry, existingImg?}]}
    const unmatched = [];    // {manageNumber, fileCount}
    let totalFiles = 0;
    let overwriteCount = 0;  // 上書きになる枚数 (v1.11.0)

    for (const [manageNumber, files] of groups) {
      // ファイル名でソート (1_xxx.jpg, 2_xxx.jpg ...)
      files.sort((a, b) => a.filename.localeCompare(b.filename, 'ja', { numeric: true }));
      const product = productsByManage.get(manageNumber);
      if (product) {
        // 上書き対象を判定 (originalNameか filename が一致する既存画像)
        const enrichedFiles = files.map(f => {
          const existingImg = (product.images || []).find(img =>
            (img.originalName || img.filename) === f.filename
          );
          if (existingImg) overwriteCount++;
          return { ...f, existingImg };
        });
        matched.push({ product, files: enrichedFiles });
        totalFiles += files.length;
      } else {
        unmatched.push({ manageNumber, fileCount: files.length });
      }
    }

    pendingBulkImport = { matched, unmatched, totalFiles, overwriteCount };
    hideLoading();
    showBulkImportPreview();
  } catch (e) {
    hideLoading();
    console.error(e);
    toast('ZIP解析失敗: ' + e.message, 'error');
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showBulkImportPreview() {
  const r = pendingBulkImport;
  if (!r) return;

  document.getElementById('bulkDropzone').style.display = 'none';
  const confirmBtn = document.getElementById('btnConfirmBulkImport');
  confirmBtn.style.display = '';
  confirmBtn.disabled = r.matched.length === 0;

  const summary = document.getElementById('bulkImportSummary');
  summary.innerHTML = `
    <div class="csv-stats">
      <div class="csv-stat csv-stat-ok">
        <div class="csv-stat-num">${r.matched.length}</div>
        <div class="csv-stat-label">対象商品</div>
      </div>
      <div class="csv-stat csv-stat-ok">
        <div class="csv-stat-num">${r.totalFiles}</div>
        <div class="csv-stat-label">画像ファイル</div>
      </div>
      <div class="csv-stat ${r.overwriteCount > 0 ? 'csv-stat-warn' : 'csv-stat-ok'}">
        <div class="csv-stat-num">${r.overwriteCount || 0}</div>
        <div class="csv-stat-label">上書き対象</div>
      </div>
      <div class="csv-stat csv-stat-warn">
        <div class="csv-stat-num">${r.unmatched.length}</div>
        <div class="csv-stat-label">未マッチ商品</div>
      </div>
    </div>
    ${r.overwriteCount > 0 ? `<div class="csv-hint" style="color:var(--warning-text)">⚠️ ${r.overwriteCount}枚が既存画像を上書きします</div>` : ''}
  `;

  const preview = document.getElementById('bulkImportPreview');
  let html = '';
  if (r.matched.length > 0) {
    html += `<h4 class="csv-h">アップロード対象 (${r.matched.length}商品 / ${r.totalFiles}枚)</h4>`;
    html += '<div class="csv-change-list">';
    r.matched.slice(0, 50).forEach(m => {
      html += `<div class="csv-change">
        <div class="csv-change-manage">${escapeHtml(m.product.itemManageNumber)}</div>
        <div class="csv-change-detail">
          <div class="bulk-product-name">${escapeHtml(m.product.itemName || '(無題)')}</div>
          <div class="bulk-files-count">📷 ${m.files.length}枚: ${m.files.slice(0,3).map(f => escapeHtml(f.filename)).join(', ')}${m.files.length>3?' …':''}</div>
        </div>
      </div>`;
    });
    if (r.matched.length > 50) {
      html += `<div class="csv-more">…他 ${r.matched.length - 50} 商品</div>`;
    }
    html += '</div>';
  }
  if (r.unmatched.length > 0) {
    html += `<h4 class="csv-h csv-h-warn">ZIPにあるがツールに未登録 (${r.unmatched.length}件)</h4>`;
    html += '<div class="csv-notfound-list">';
    r.unmatched.slice(0, 20).forEach(u => {
      html += `<div class="csv-notfound">${escapeHtml(u.manageNumber)} — ${u.fileCount}枚</div>`;
    });
    if (r.unmatched.length > 20) {
      html += `<div class="csv-more">…他 ${r.unmatched.length - 20} 件</div>`;
    }
    html += '</div>';
    html += '<div class="csv-hint">💡 これらはまだ取り込まれていない商品コードです（＋ 商品追加 から取り込んでください）</div>';
  }
  if (r.matched.length === 0 && r.unmatched.length === 0) {
    html = '<div class="csv-empty">ZIPから画像が見つかりませんでした。フォルダ構造を確認してください。</div>';
  }
  preview.innerHTML = html;
}

async function confirmBulkImport() {
  const r = pendingBulkImport;
  if (!r || r.matched.length === 0) return;

  // 上書き確認 (v1.11.0)
  if (r.overwriteCount > 0) {
    if (!confirm(`${r.overwriteCount}枚の既存画像を上書きします。よろしいですか?\n(元の画像は復元できません)`)) {
      return;
    }
  }

  const confirmBtn = document.getElementById('btnConfirmBulkImport');
  const dz = document.getElementById('bulkDropzone');
  const progress = document.getElementById('bulkUploadProgress');
  confirmBtn.disabled = true;
  dz.style.display = 'none';
  progress.style.display = 'block';

  let uploadedCount = 0;
  let overwrittenCount = 0;
  let failedCount = 0;
  const totalCount = r.totalFiles;

  for (const m of r.matched) {
    const p = m.product;
    if (!p.images) p.images = [];

    for (let i = 0; i < m.files.length; i++) {
      const f = m.files[i];
      uploadedCount++;
      progress.textContent = `[${uploadedCount}/${totalCount}] ${p.itemManageNumber} - ${f.filename}`;
      try {
        // Blob化してFile相当のオブジェクトに変換
        const blob = await f.entry.async('blob');
        const ext = f.filename.split('.').pop().toLowerCase();
        const mime = (ext === 'png') ? 'image/png'
                   : (ext === 'gif') ? 'image/gif'
                   : (ext === 'webp') ? 'image/webp'
                   : 'image/jpeg';
        const fileObj = new File([blob], f.filename, { type: mime });

        if (f.existingImg) {
          // 上書きアップロード
          const updatedMeta = await overwriteImageOnGitHub(f.existingImg, fileObj);
          const idx = p.images.findIndex(img => img.id === f.existingImg.id);
          if (idx >= 0) {
            p.images[idx] = updatedMeta;
          }
          overwrittenCount++;
        } else {
          // 新規アップロード
          const imgMeta = await uploadImageToGitHub(currentShopId, p.id, fileObj);
          p.images.push(imgMeta);
        }
      } catch (e) {
        console.error(`Upload failed: ${f.filename}`, e);
        failedCount++;
      }
    }
    // 商品ごとにJSONも保存 (途中で失敗しても進捗が残る)
    try {
      await saveShopData(currentShopId, `bulk upload: ${p.itemManageNumber} (${m.files.length} images)`);
    } catch (e) {
      console.error('Save failed', e);
    }
  }

  progress.style.display = 'none';
  closeModal('bulkImagesModal');
  const summary = `完了: 新規${uploadedCount - overwrittenCount - failedCount}枚 / 上書き${overwrittenCount}枚${failedCount ? ` / 失敗${failedCount}件` : ''}`;
  toast(summary, failedCount ? 'error' : 'success');
  pendingBulkImport = null;
  render();
}

// =====================================================
// 基礎情報CSVエクスポート
// =====================================================
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // ダブルクオート・カンマ・改行を含むならクオートする
  if (/["\n,]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportBasicInfoCsv() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data || !data.products || data.products.length === 0) {
    toast('商品データがありません', 'error');
    return;
  }

  // 現在の表示順 (ソート・検索・フィルタ) を反映したい場合、
  // ここでは未フィルタの全商品を出力(ソートのみ反映)
  let list = data.products.slice();
  if (sortKey) {
    const dir = sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      const av = (sortKey === 'manage' ? a.itemManageNumber : a.itemNumber) || '';
      const bv = (sortKey === 'manage' ? b.itemManageNumber : b.itemNumber) || '';
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const aNum = /^\d+$/.test(av);
      const bNum = /^\d+$/.test(bv);
      if (aNum && bNum) return (parseInt(av) - parseInt(bv)) * dir;
      return av.localeCompare(bv, 'ja') * dir;
    });
  }

  // タグID → タグ名のマップ
  const tagMap = new Map();
  (data.tags || []).forEach(t => tagMap.set(t.id, t.name));

  // ヘッダー
  const headers = [
    '商品コード',
    '商品番号',
    '商品名',
    'タグ',
    '画像枚数',
    '商品URL',
    'サムネURL'
  ];
  const rows = [headers.map(csvEscape).join(',')];

  list.forEach(p => {
    const tagNames = (p.tagIds || [])
      .map(id => tagMap.get(id))
      .filter(Boolean)
      .join('|');  // タグ間は「|」区切り
    const row = [
      p.itemManageNumber || '',
      p.itemNumber || '',
      p.itemName || '',
      tagNames,
      (p.images || []).length,
      p.itemUrl || '',
      p.thumbUrl || p.rakutenThumb || ''
    ];
    rows.push(row.map(csvEscape).join(','));
  });

  // BOM付きで保存(Excelで文字化け防止)
  const bom = '\uFEFF';
  const csv = bom + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  // ファイル名: 基礎情報_{shopCode}_{YYYYMMDD-HHmm}.csv
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `基礎情報_${shop.shopCode || shop.id}_${stamp}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast(`${list.length}商品の基礎情報をダウンロードしました`, 'success');
}

// =====================================================
// ショップ管理
// =====================================================
function getCurrentShop() {
  return shops.find(s => s.id === currentShopId) || null;
}

function renderShopTabs() {
  const wrap = document.getElementById('shopTabs');
  if (!wrap) return;
  wrap.innerHTML = '';

  // v1.11.38: タブ → ドロップダウン。切り替えると URL (?shop=…) も変わるので、
  //   ショップごとにブックマーク(スピードダイアル)へ登録できる。
  if (shops.length > 0) {
    const sel = document.createElement('select');
    sel.className = 'shop-select';
    sel.id = 'shopSelect';
    shops.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name || '(名称未設定)';
      if (s.id === currentShopId) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => switchShop(sel.value));
    wrap.appendChild(sel);

    const cur = shops.find(s => s.id === currentShopId);
    if (cur) sel.title = `このショップのURL: ?shop=${shopSlug(cur)}`;
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'shop-tab-add';
  addBtn.textContent = '＋ ショップ';
  addBtn.addEventListener('click', () => openShopForm());
  wrap.appendChild(addBtn);

  // 名前やショップコードを変えた直後もURLを合わせておく
  updateShopUrl(currentShopId, false);
}

// ===== v1.11.38: ショップとURL (?shop=…) の対応 =====
const URL_SHOP_PARAM = 'shop';
let _unknownShopSlug = null;   // URLで指定されたが未登録だったスラッグ

function _slugify(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// URLに出す短い名前。ショップコード → 店名 → 内部ID の順で採用する。
//   同じスラッグになるショップが複数あるときは、登録順に -2, -3 … を付けて必ず一意にする。
function shopSlug(shop) {
  if (!shop) return '';
  const baseOf = (s) => _slugify(s.shopCode) || _slugify(s.name) || s.id;
  const base = baseOf(shop);
  const same = shops.filter(s => baseOf(s) === base);
  if (same.length <= 1) return base;
  const i = same.findIndex(s => s.id === shop.id);
  return i <= 0 ? base : `${base}-${i + 1}`;
}

function findShopBySlug(slug) {
  if (!slug) return null;
  const q = String(slug).trim().toLowerCase();
  return shops.find(s => shopSlug(s).toLowerCase() === q)
      || shops.find(s => s.id === String(slug).trim())   // 内部IDを直接書いたURLも受け付ける
      || null;
}

function readShopFromUrl() {
  try { return new URLSearchParams(location.search).get(URL_SHOP_PARAM); }
  catch (e) { return null; }
}

function updateShopUrl(shopId, push) {
  const s = shops.find(x => x.id === shopId);
  if (!s) return;
  try {
    const u = new URL(location.href);
    u.searchParams.set(URL_SHOP_PARAM, shopSlug(s));
    if (u.toString() === location.href) return;         // 変化なしなら履歴を汚さない
    history[push ? 'pushState' : 'replaceState']({ shopId }, '', u.toString());
  } catch (e) { console.warn('URL更新に失敗', e); }
}

// 起動時: URLの ?shop= を localStorage より優先する
function applyShopFromUrl() {
  const slug = readShopFromUrl();
  if (!slug) return;
  const s = findShopBySlug(slug);
  if (!s) { _unknownShopSlug = slug; return; }
  currentShopId = s.id;
  localStorage.setItem(LS_CURRENT_SHOP, s.id);
}

async function switchShop(shopId, opts = {}) {
  currentShopId = shopId;
  localStorage.setItem(LS_CURRENT_SHOP, shopId);
  if (!opts.fromUrl) updateShopUrl(shopId, true);   // 戻るボタンで前のショップに戻れるように積む
  renderShopTabs();
  await loadCurrentShopData();
  render();
  startAutoRefresh();        // v1.11.27: ショップ切替後も自動更新を再開
}

async function loadCurrentShopData() {
  if (!currentShopId) return;
  // v1.11.25: 閲覧はPAT不要 (公開リポジトリ)。owner/repoだけ必須。
  if (!auth.owner || !auth.repo) return;
  if (dataCache[currentShopId]) return;
  showLoading('データを読み込み中...');
  try {
    dataCache[currentShopId] = await loadShopData(currentShopId);
    const cache = dataCache[currentShopId];
    // v1.11.37: 起動時の取得も同期履歴に残す
    if (!cache._wasEmpty && !cache._parseError && !cache._loadFailed) {
      recordSync('initial', null, _syncSnapshot(cache));
    }

    // 空/破損検出時の警告 (上書き保存はしない)
    if (cache._wasEmpty || cache._parseError) {
      hideLoading();
      const cause = cache._wasEmpty ? '空でした' : '破損しています';
      toast(`⚠️ データファイルが${cause}。バックアップから復元するか「商品同期」で取り直してください`, 'error');
      return;
    }

    // マイグレーションでマージが発生した場合は自動保存 (PATがある編集者のみ)
    const merged = cache._mergedCount || 0;
    if (merged > 0 && auth.pat) {
      hideLoading();
      showLoading(`重複した${merged}件をマージ中...`);
      try {
        await saveShopData(currentShopId, `cleanup: merge ${merged} duplicates`);
        toast(`重複データ${merged}件を自動マージしました`, 'success');
      } catch (e) {
        console.warn('Auto-merge save failed', e);
      }
    }
  } catch (e) {
    toast('読み込み失敗: ' + e.message, 'error');
    recordSync('initial', null, null, { failed: true, note: '読み込み失敗: ' + e.message });
    // 🚨 (v1.11.2) 読み込み失敗時は「破損」フラグを立てて、以降の保存を絶対に走らせない
    dataCache[currentShopId] = {
      products: [], materials: [], boosts: [], tags: [], sha: null,
      _wasEmpty: true,
      _parseError: true,
      _loadFailed: true
    };
    hideLoading();
    return;  // 🚨 早期return: ensureFavoriteTag/ensureReasonTagを呼ばない
  }
  hideLoading();
  // v1.11.25: 書き込みを伴う自動処理はPATがある場合のみ (閲覧専用ユーザーでは実行しない)
  if (auth.pat) {
    // v1.11.10: タグの旧名リネーム(冪等)
    migrateTagRenameAndOrder(currentShopId);
    // v1.9.0: お気に入りタグを自動確保
    ensureFavoriteTag(currentShopId);
    // v1.9.3: 選ばれる理由タグを自動確保
    ensureReasonTag(currentShopId);
  }
}

// =====================================================
// 描画
// =====================================================
// =====================================================
// 削除モード: アクションバー & 一括削除
// =====================================================
function updateDeleteActionBar() {
  const bar = document.getElementById('deleteActionBar');
  const cnt = document.getElementById('deleteCount');
  if (!bar || !cnt) return;
  if (viewMode === 'delete' && deleteSelection.size > 0) {
    bar.style.display = 'flex';
    cnt.textContent = deleteSelection.size;
  } else {
    bar.style.display = 'none';
  }
}

async function executeDeleteSelected() {
  if (deleteSelection.size === 0) return;
  const data = dataCache[currentShopId];
  if (!data) return;
  const count = deleteSelection.size;
  if (!confirm(`${count}枚の画像を削除します。\n※GitHub上の画像ファイル本体も削除されます。\n本当に実行しますか?`)) return;

  // 対象画像をリストアップ (product, image のペア)
  const targets = [];
  data.products.forEach(p => {
    if (!p.images) return;
    p.images.forEach(img => {
      if (deleteSelection.has(img.id)) {
        targets.push({ product: p, image: img });
      }
    });
  });

  let okCount = 0;
  let failCount = 0;
  showLoading(`画像を削除中... 0/${targets.length}`);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    showLoading(`画像を削除中... ${i + 1}/${targets.length}`);
    try {
      // GitHubから画像ファイル削除
      await ghFetch(`contents/${t.image.path}`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `delete image (bulk): ${t.image.filename}`,
          sha: t.image.sha,
          branch: auth.branch
        })
      });
      // 商品から取り除く
      t.product.images = t.product.images.filter(x => x.id !== t.image.id);
      okCount++;
    } catch (e) {
      console.error('Delete failed', t.image.filename, e);
      failCount++;
    }
  }
  // gallery.json を保存
  try {
    await saveShopData(currentShopId, `bulk delete: ${okCount} images`);
  } catch (e) {
    console.error('Save after bulk delete failed', e);
  }
  hideLoading();
  deleteSelection.clear();
  updateDeleteActionBar();
  render();
  toast(`削除完了: ${okCount}枚${failCount ? ` / 失敗${failCount}件` : ''}`, failCount ? 'error' : 'success');
}

// ===== v1.11.29: 商品削除 =====
function updateProductDeleteBar() {
  const bar = document.getElementById('productDeleteBar');
  if (!bar) return;
  const cnt = document.getElementById('productDeleteCount');
  if (viewMode === 'productdelete' && productDeleteSelection.size > 0) {
    bar.style.display = 'flex';
    if (cnt) cnt.textContent = productDeleteSelection.size;
  } else {
    bar.style.display = 'none';
  }
}

// 上部の「削除」ボタンを「画像削除」に改称し、「商品削除」ボタンと商品削除バーを用意する
function injectProductDeleteUI() {
  // 「削除」→「画像削除」に改称
  const imgDelBtn = document.getElementById('modeDelete');
  if (imgDelBtn && !imgDelBtn.dataset.renamed) {
    imgDelBtn.textContent = '🗑️ 画像削除';
    imgDelBtn.dataset.renamed = '1';
  }
  // 「商品削除」ボタン
  if (!document.getElementById('modeProductDelete') && imgDelBtn && imgDelBtn.parentNode) {
    const btn = document.createElement('button');
    btn.id = 'modeProductDelete';
    btn.className = 'view-mode-btn view-mode-btn-danger view-mode-btn-standalone';
    btn.dataset.mode = 'productdelete';
    btn.textContent = '🗑️ 商品削除';
    btn.addEventListener('click', () => {
      viewMode = (viewMode === 'productdelete') ? 'images' : 'productdelete';
      localStorage.setItem(LS_VIEW_MODE, viewMode);
      document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === viewMode));
      deleteSelection.clear();
      productDeleteSelection.clear();
      updateDeleteActionBar();
      updateProductDeleteBar();
      render();
    });
    imgDelBtn.parentNode.insertBefore(btn, imgDelBtn.nextSibling);
  }
  // 商品削除アクションバー
  if (!document.getElementById('productDeleteBar')) {
    const bar = document.createElement('div');
    bar.className = 'delete-action-bar';
    bar.id = 'productDeleteBar';
    bar.style.display = 'none';
    bar.innerHTML = `
      <div class="delete-action-info">
        <span class="delete-action-icon">🗑️</span>
        <span>商品削除予約: <strong id="productDeleteCount">0</strong> 件</span>
      </div>
      <div class="delete-action-buttons">
        <button class="btn-secondary" id="btnProductDeleteCancel">予約をクリア</button>
        <button class="btn-danger" id="btnProductDeleteExecute">選択した商品を削除</button>
      </div>`;
    document.body.appendChild(bar);
    bar.querySelector('#btnProductDeleteCancel').addEventListener('click', () => {
      productDeleteSelection.clear();
      updateProductDeleteBar();
      render();
    });
    bar.querySelector('#btnProductDeleteExecute').addEventListener('click', executeDeleteProducts);
  }
}

async function executeDeleteProducts() {
  if (productDeleteSelection.size === 0) return;
  if (!auth.pat) { toast('削除には編集権限(PAT)が必要です', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) return;
  const ids = [...productDeleteSelection];
  const idSet = new Set(ids);
  const targets = (data.products || []).filter(p => idSet.has(p.id));
  if (targets.length === 0) return;
  const totalImgs = targets.reduce((n, p) => n + (p.images || []).length, 0);
  if (!confirm(`${targets.length}商品を削除します。\n※ひも付く画像ファイル(${totalImgs}枚)もGitHubから削除されます。\n元に戻せません。本当に実行しますか?`)) return;

  let failImg = 0, done = 0;
  showLoading('商品を削除中…');
  for (const p of targets) {
    for (const img of (p.images || [])) {
      done++;
      showLoading(`画像を削除中… ${done}/${totalImgs}`);
      try {
        await ghFetch(`contents/${img.path}`, {
          method: 'DELETE',
          body: JSON.stringify({ message: `delete product image: ${img.filename}`, sha: img.sha, branch: auth.branch })
        });
      } catch (e) { failImg++; console.error('product image delete failed', e); }
    }
  }
  // 商品を配列から除去
  data.products = (data.products || []).filter(p => !idSet.has(p.id));
  showLoading('保存中…');
  try {
    await saveShopData(currentShopId, `delete ${targets.length} products`);
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
    return;
  }
  hideLoading();
  productDeleteSelection.clear();
  updateProductDeleteBar();
  render();
  toast(`${targets.length}商品を削除しました${failImg ? ` / 画像削除失敗${failImg}件` : ''}`, failImg ? 'error' : 'success');
}

function render() {
  updateTagFilterIndicator();
  updateDeleteActionBar();
  updateProductDeleteBar();
  updatePendingStatusBar();
  updateCategoryTabCounts();
  updateExportModeButton();
  updateExportBar();
  const shop = getCurrentShop();
  const empty = document.getElementById('emptyState');
  const content = document.getElementById('content');

  if (!shop) {
    empty.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';

  const data = dataCache[currentShopId] || { products: [], materials: [], boosts: [] };

  // v1.11.35: Yahoo用サムネは専用ボードを描画して終了 (商品リストとは無関係)
  //   検索/タグフィルタ行はこのタブでは使わないので body クラスで隠す
  document.body.classList.toggle('yt-mode', currentCategory === 'yahoo_thumb');
  if (currentCategory === 'yahoo_thumb') {
    renderYahooThumbBoard();
    updateCategoryMeta(data);
    return;
  }

  // v1.11.29/33: カテゴリごとの商品リストを決めてから、表示方法を選ぶ
  //   商品タブは部品(isPart)を除外。部品タブは部品のみ。
  const realProducts = (data.products || []).filter(p => !p.isPart);
  let list = null;
  if (currentCategory === 'product') {
    list = realProducts.filter(p => (p.images || []).some(im => im.tagId)); // 選択分
  } else if (currentCategory === 'product_untagged') {
    list = realProducts.filter(isUntaggedProduct);                         // 未選択分
  } else if (currentCategory === 'product_unsure') {
    list = [];
  } else if (currentCategory === 'product_noimage') {
    list = realProducts.filter(p => !p.images || p.images.length === 0); // 未設定(画像が一切無い)
  } else if (currentCategory === 'product_all') {
    list = realProducts;
  } else if (currentCategory === 'parts') {
    list = (data.products || []).filter(p => p.isPart);                    // 部品
  }

  if (list !== null) {
    // 削除系モード(画像削除/商品削除)では常に商品ごと表示にする
    const useImageList = galleryViewMode === 'imagelist' && viewMode !== 'delete' && viewMode !== 'productdelete';
    if (useImageList) renderImageListGrid(list);
    else renderProductGrid(list);
  } else if (currentCategory === 'material') {
    renderMaterialGrid(data.materials);
  } else if (currentCategory === 'boost') {
    renderBoostTable(data.boosts);
  }

  updateCategoryMeta(data);
}

function updateCategoryMeta(data) {
  const meta = document.getElementById('unregisteredCount');
  // v1.11.15/19: 選択分=タグ付き画像がある商品 / 未選択分=全画像タグ無し / 全体=全商品
  if (currentCategory === 'product') {
    const tagged = data.products.filter(p => (p.images || []).some(im => im.tagId)).length;
    meta.innerHTML = `<span>商品(選択分): ${tagged}件</span>`;
  } else if (currentCategory === 'product_untagged') {
    const n = data.products.filter(isUntaggedProduct).length;
    meta.innerHTML = `<span>商品(未選択分): ${n}件</span>`;
  } else if (currentCategory === 'product_all') {
    const real = (data.products || []).filter(p => !p.isPart);
    const empty = real.filter(p => !p.images || p.images.length === 0).length;
    meta.innerHTML = empty > 0
      ? `<span class="badge-warning">📷 商品(全体) 未登録: ${empty}件</span>`
      : `<span>商品(全体): 全商品に画像登録済み 🎉</span>`;
  } else if (currentCategory === 'product_noimage') {
    const real = (data.products || []).filter(p => !p.isPart);
    const n = real.filter(p => !p.images || p.images.length === 0).length;
    meta.innerHTML = `<span>商品(未設定): ${n}件</span>`;
  } else if (currentCategory === 'parts') {
    const n = (data.products || []).filter(p => p.isPart).length;
    meta.innerHTML = `<span>部品: ${n}件</span>`;
  } else if (currentCategory === 'yahoo_thumb') {
    const rows = (data.yahooThumbs || []);
    let imgs = 0;
    rows.forEach(r => { imgs += (r.generated || []).length + (r.original || []).length + (r.materials || []).length; });
    meta.innerHTML = `<span>サムネ台: ${rows.length}行 / 画像${imgs}枚</span>`;
  } else {
    meta.textContent = '';
  }
}

function renderProductGrid(products) {
  const content = document.getElementById('content');
  let list = products.slice();
  if (searchQuery) {
    list = list.filter(p =>
      (p.itemName || '').toLowerCase().includes(searchQuery) ||
      (p.itemCode || '').toLowerCase().includes(searchQuery) ||
      (p.itemNumber || '').toLowerCase().includes(searchQuery) ||
      (p.itemManageNumber || '').toLowerCase().includes(searchQuery)
    );
  }
  if (filterUnregistered) {
    list = list.filter(p => !p.images || p.images.length === 0);
  }
  // タグフィルタ (OR: 選択タグのいずれかを持っていればOK)
  // v1.11.8: 分類タグは「画像単位」に移行したため、いずれかの画像がそのタグを持つ商品を表示。
  //          「お気に入り」だけは従来どおり商品単位 (p.tagIds) で判定する。
  if (filterTagIds.size > 0) {
    const favId = getFavoriteTagId();
    list = list.filter(p => {
      const productTagIds = p.tagIds || [];
      const imgs = p.images || [];
      return [...filterTagIds].some(fid => {
        if (fid === favId) return productTagIds.includes(fid);
        return imgs.some(im => im.tagId === fid);
      });
    });
  }

  // === ソート ===
  if (sortKey) {
    const dir = sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      const av = (sortKey === 'manage' ? a.itemManageNumber : a.itemNumber) || '';
      const bv = (sortKey === 'manage' ? b.itemManageNumber : b.itemNumber) || '';
      // 空欄は常に末尾
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      // 数字のみなら数値比較、それ以外は文字列比較
      const aNum = /^\d+$/.test(av);
      const bNum = /^\d+$/.test(bv);
      if (aNum && bNum) return (parseInt(av) - parseInt(bv)) * dir;
      return av.localeCompare(bv, 'ja') * dir;
    });
  }

  if (list.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📦</div>
      <div class="empty-title">${products.length === 0 ? '商品データがありません' : '該当する商品がありません'}</div>
      <div class="empty-desc">${products.length === 0 ? '右上の「＋ 商品追加」からYahooの商品を取り込んでください' : '検索条件を変えてみてください'}</div>
    </div>`;
    return;
  }

  const sortIndicator = (key) => {
    if (sortKey !== key) return '<span class="sort-indicator">⇅</span>';
    return sortDir === 'asc'
      ? '<span class="sort-indicator active">▲</span>'
      : '<span class="sort-indicator active">▼</span>';
  };

  // エクスポート列ヘッダーHTML
  const exportHeaderHTML = exportMode ? '<div class="col-export"></div>' : '';

  let headerHTML;
  if (viewMode === 'images') {
    // 画像全体モード: 商品番号・商品管理番号・画像・お気に入り(★)・タグ操作
    headerHTML = `
      <div class="product-table-header mode-images ${exportMode ? 'with-export' : ''}">
        ${exportHeaderHTML}
        <div class="col-number sortable" data-sort="number">商品番号 ${sortIndicator('number')}</div>
        <div class="col-manage sortable" data-sort="manage">商品コード ${sortIndicator('manage')}</div>
        <div class="col-name">商品名</div>
        <div class="col-images">画像</div>
        <div class="col-actions">タグ・操作</div>
      </div>
    `;
  } else if (viewMode === 'delete') {
    // 画像削除モード: 商品番号・画像 (画像クリックで削除予約)
    headerHTML = `
      <div class="product-table-header mode-delete ${exportMode ? 'with-export' : ''}">
        ${exportHeaderHTML}
        <div class="col-number sortable" data-sort="number">商品番号 ${sortIndicator('number')}</div>
        <div class="col-images">画像 (クリックで削除予約)</div>
      </div>
    `;
  } else if (viewMode === 'productdelete') {
    // v1.11.29: 商品削除モード: 行クリックで商品ごと削除予約
    headerHTML = `
      <div class="product-table-header mode-productdelete">
        <div class="col-pd-check">選択</div>
        <div class="col-number sortable" data-sort="number">商品番号 ${sortIndicator('number')}</div>
        <div class="col-manage sortable" data-sort="manage">商品コード ${sortIndicator('manage')}</div>
        <div class="col-name">商品名</div>
        <div class="col-images">画像</div>
      </div>
    `;
  } else {
    // 基礎情報モード: お気に入り(★)を画像の右隣に専用列で配置
    headerHTML = `
      <div class="product-table-header mode-basic ${exportMode ? 'with-export' : ''}">
        ${exportHeaderHTML}
        <div class="col-manage sortable" data-sort="manage">商品コード ${sortIndicator('manage')}</div>
        <div class="col-number sortable" data-sort="number">商品番号 ${sortIndicator('number')}</div>
        <div class="col-name">商品名</div>
        <div class="col-images">画像 (最大5枚)</div>
        <div class="col-favorite">★</div>
        <div class="col-actions">タグ・操作</div>
      </div>
    `;
  }

  // エクスポート操作行 (v1.11.3): 表示中の商品を対象に全選択/全解除
  let exportActionRowHTML = '';
  if (exportMode) {
    const visibleIds = list.map(p => p.id);
    const selectedInView = visibleIds.filter(id => exportSelection.has(id)).length;
    const allSelected = visibleIds.length > 0 && selectedInView === visibleIds.length;
    exportActionRowHTML = `
      <div class="export-action-row">
        <div class="export-action-row-info">
          <span>📤 エクスポート選択操作</span>
          <span class="export-action-row-count">表示中の商品: ${visibleIds.length}件 (選択済み ${selectedInView}件)</span>
        </div>
        <div class="export-action-row-buttons">
          <button class="btn-secondary btn-mini" id="btnExportSelectAllVisible" ${allSelected ? 'disabled' : ''}>✓ 表示中を全選択</button>
          <button class="btn-secondary btn-mini" id="btnExportDeselectAllVisible" ${selectedInView === 0 ? 'disabled' : ''}>✕ 表示中の選択を解除</button>
        </div>
      </div>
    `;
  }

  const html = `
    <div class="product-table">
      ${exportActionRowHTML}
      ${headerHTML}
      ${list.map(p => productRowHTML(p)).join('')}
    </div>
  `;
  content.innerHTML = html;

  // 遅延読み込み対象を登録 (v1.10.1)
  scanLazyImages(content);

  // v1.11.15: 項目管理モード中は列幅ドラッグ用ハンドルを付与
  if (colResizeMode) addColResizeHandles(content);

  // エクスポート操作行のボタン (v1.11.3)
  const btnSelectAll = content.querySelector('#btnExportSelectAllVisible');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      list.forEach(p => exportSelection.add(p.id));
      saveExportState();
      updateExportBar();
      render();
    });
  }
  const btnDeselectAll = content.querySelector('#btnExportDeselectAllVisible');
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      list.forEach(p => exportSelection.delete(p.id));
      saveExportState();
      updateExportBar();
      render();
    });
  }

  // ソート切替
  content.querySelectorAll('[data-sort]').forEach(el => {
    el.addEventListener('click', () => toggleSort(el.dataset.sort));
  });
  // 編集ボタン: 情報編集
  content.querySelectorAll('[data-edit-info]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProductEditForm(btn.dataset.editInfo);
    });
  });
  // 編集ボタン: 画像編集 (v1.10.0)
  content.querySelectorAll('[data-edit-images]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProductImagesModal(btn.dataset.editImages);
    });
  });
  // タグ・グリッド: ワンクリックでタグON/OFF
  content.querySelectorAll('[data-tag-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProductTag(btn.dataset.pid, btn.dataset.tagToggle, btn);
    });
  });
  // v1.11.8: 画像単位の分類タグ (ドロップダウンで1画像1タグ、変更で即GitHub保存)
  content.querySelectorAll('[data-img-tag-id]').forEach(sel => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      setImageTag(sel.dataset.imgTagPid, sel.dataset.imgTagId, sel.value, sel);
    });
  });
  // 削除モード: 画像クリックで予約トグル
  content.querySelectorAll('[data-delete-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const imgId = el.dataset.deleteToggle;
      if (deleteSelection.has(imgId)) {
        deleteSelection.delete(imgId);
        el.classList.remove('marked');
        el.querySelector('.delete-mark-overlay')?.remove();
      } else {
        deleteSelection.add(imgId);
        el.classList.add('marked');
        if (!el.querySelector('.delete-mark-overlay')) {
          const ov = document.createElement('div');
          ov.className = 'delete-mark-overlay';
          ov.textContent = '✕';
          el.appendChild(ov);
        }
      }
      updateDeleteActionBar();
    });
  });
  // v1.11.29: 商品削除モード: 行クリックで商品を選択/解除
  content.querySelectorAll('[data-pd-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.pdToggle;
      if (productDeleteSelection.has(pid)) productDeleteSelection.delete(pid);
      else productDeleteSelection.add(pid);
      const on = productDeleteSelection.has(pid);
      el.classList.toggle('pd-selected', on);
      const chk = el.querySelector('.col-pd-check');
      if (chk) chk.textContent = on ? '☑' : '☐';
      updateProductDeleteBar();
    });
  });
  // 画像追加ボタン
  content.querySelectorAll('[data-add-img]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProductModal(btn.dataset.addImg);
    });
  });
  // 画像クリック → 商品モーダル開く (現在は「+N」「+未登録」ボタンのみ)
  content.querySelectorAll('[data-open-product]').forEach(el => {
    el.addEventListener('click', () => openProductModal(el.dataset.openProduct));
  });
  // 画像クリック → ライトボックスで拡大表示 (v1.9.1: 商品の全画像で切替可能)
  content.querySelectorAll('[data-lb-pid]').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.lbPid;
      const idx = parseInt(el.dataset.lbIndex, 10) || 0;
      const data = dataCache[currentShopId];
      const p = data?.products.find(x => x.id === pid);
      if (!p || !p.images || p.images.length === 0) return;
      const sorted = sortImagesByName(p.images);
      // basicモードは5枚までしか表示してないけど、ライトボックスでは全画像見れる
      const urls = sorted.map(img => img.url);
      openLightbox(urls, idx);
    });
  });
  // 現役/微妙ステータス切り替え (ペンディング)
  content.querySelectorAll('[data-status-pid]').forEach(input => {
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      setPendingStatus(input.dataset.statusPid, input.value);
    });
  });
  // エクスポートモード: チェックボックス
  content.querySelectorAll('[data-export-pid]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleExportSelection(cb.dataset.exportPid);
    });
  });
  // お気に入りボタン (v1.9.0)
  content.querySelectorAll('[data-fav-pid]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(btn.dataset.favPid, btn);
    });
  });
}

// 商品ステータスの「ペンディング変更」を登録 (即保存しない)
// 元の状態と一致する変更は自動でペンディングから外す
function setPendingStatus(productId, newStatus) {
  const data = dataCache[currentShopId];
  if (!data) return;
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  const original = p.status || 'active';
  if (original === newStatus) {
    // 元に戻された → ペンディング解除
    pendingStatusChanges.delete(productId);
  } else {
    pendingStatusChanges.set(productId, newStatus);
  }
  updatePendingStatusBar();
  updateCategoryTabCounts();
  // トグル見た目だけ即時更新(画面全体は再描画しない=スクロール位置維持)
  refreshStatusToggleUI(productId);
}

// 単一商品のステータストグル見た目を更新
function refreshStatusToggleUI(productId) {
  const toggle = document.querySelector(`.product-status-toggle[data-pid="${productId}"]`);
  if (!toggle) return;
  const data = dataCache[currentShopId];
  const p = data?.products.find(x => x.id === productId);
  if (!p) return;
  const original = p.status || 'active';
  const pending = pendingStatusChanges.get(productId);
  const displayed = pending !== undefined ? pending : original;
  const isPending = pending !== undefined;

  toggle.classList.toggle('pending', isPending);
  toggle.querySelectorAll('.status-radio').forEach(radio => {
    const value = radio.querySelector('input')?.value;
    const isActive = value === displayed;
    radio.classList.toggle('active', isActive);
    radio.classList.toggle('unsure', value === 'unsure' && isActive);
    const input = radio.querySelector('input');
    if (input) input.checked = isActive;
  });
}

// 右上の固定バー(ペンディング件数&保存ボタン)更新
function updatePendingStatusBar() {
  const bar = document.getElementById('pendingStatusBar');
  if (!bar) return;
  const count = pendingStatusChanges.size;
  if (count === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    const cntEl = document.getElementById('pendingStatusCount');
    if (cntEl) cntEl.textContent = count;
  }
}

// 保存待ちのステータス変更を全部GitHubに反映
async function commitPendingStatusChanges() {
  if (pendingStatusChanges.size === 0) return;
  const data = dataCache[currentShopId];
  if (!data) return;

  const count = pendingStatusChanges.size;
  // 適用前の状態をバックアップ(失敗時のロールバック用)
  const backup = new Map();
  for (const [pid, newStatus] of pendingStatusChanges) {
    const p = data.products.find(x => x.id === pid);
    if (!p) continue;
    backup.set(pid, p.status || 'active');
    p.status = newStatus;
  }

  showLoading(`ステータス変更を保存中... (${count}件)`);
  try {
    await saveShopData(currentShopId, `bulk status update: ${count} products`);
    hideLoading();
    pendingStatusChanges.clear();
    updatePendingStatusBar();
    toast(`${count}件のステータスを更新しました`, 'success');
    render();
  } catch (e) {
    // ロールバック
    for (const [pid, oldStatus] of backup) {
      const p = data.products.find(x => x.id === pid);
      if (p) p.status = oldStatus;
    }
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

// ペンディング変更を全部破棄
function discardPendingStatusChanges() {
  if (pendingStatusChanges.size === 0) return;
  if (!confirm(`${pendingStatusChanges.size}件の未保存のステータス変更を破棄しますか?`)) return;
  pendingStatusChanges.clear();
  updatePendingStatusBar();
  render();
}

// カテゴリタブに件数バッジを表示 (ペンディングステータス変更も反映)
function updateCategoryTabCounts() {
  const data = dataCache[currentShopId];
  if (!data) {
    document.querySelectorAll('.cat-btn .cat-count').forEach(el => el.remove());
    return;
  }

  // ペンディングを加味した「現役/微妙」判定
  const effectiveStatus = (p) => {
    if (pendingStatusChanges.has(p.id)) return pendingStatusChanges.get(p.id);
    return p.status || 'active';
  };

  // v1.11.15/19/33: 選択分/未選択分/全体 は部品を除外。部品は別カウント。
  const realProducts = (data.products || []).filter(p => !p.isPart);
  const counts = {
    product: realProducts.filter(p => (p.images || []).some(im => im.tagId)).length,
    product_untagged: realProducts.filter(isUntaggedProduct).length,
    product_noimage: realProducts.filter(p => !p.images || p.images.length === 0).length,
    product_unsure: 0,
    product_all: realProducts.length,
    parts: (data.products || []).filter(p => p.isPart).length,
    yahoo_thumb: (data.yahooThumbs || []).length,
    material: (data.materials || []).length,
    boost: (data.boosts || []).length
  };

  document.querySelectorAll('.cat-btn').forEach(btn => {
    const cat = btn.dataset.cat;
    if (!(cat in counts)) return;
    let cntEl = btn.querySelector('.cat-count');
    if (!cntEl) {
      cntEl = document.createElement('span');
      cntEl.className = 'cat-count';
      btn.appendChild(cntEl);
    }
    cntEl.textContent = `(${counts[cat]})`;
  });
}

// タグのワンクリックON/OFF (即GitHub保存、ボタン見た目だけ即時反転)
async function toggleProductTag(productId, tagId, btnEl) {
  const data = dataCache[currentShopId];
  if (!data) return;
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  if (!Array.isArray(p.tagIds)) p.tagIds = [];
  const hasIt = p.tagIds.includes(tagId);

  // 見た目を即時反転
  if (hasIt) {
    p.tagIds = p.tagIds.filter(x => x !== tagId);
    btnEl?.classList.remove('on');
    btnEl?.classList.add('off');
  } else {
    p.tagIds.push(tagId);
    btnEl?.classList.remove('off');
    btnEl?.classList.add('on');
  }

  try {
    await saveShopData(currentShopId, `toggle tag: ${p.itemManageNumber || p.id}`);
  } catch (err) {
    // ロールバック
    if (hasIt) {
      p.tagIds.push(tagId);
      btnEl?.classList.remove('off');
      btnEl?.classList.add('on');
    } else {
      p.tagIds = p.tagIds.filter(x => x !== tagId);
      btnEl?.classList.remove('on');
      btnEl?.classList.add('off');
    }
    toast('保存失敗: ' + err.message, 'error');
  }
}

// v1.11.8: 画像単位の分類タグを設定 (1画像1タグ。空文字=タグなし)。即GitHub保存 + 失敗時ロールバック
async function setImageTag(productId, imageId, tagId, selEl) {
  const data = dataCache[currentShopId];
  if (!data) return;
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  const img = (p.images || []).find(im => im.id === imageId);
  if (!img) return;

  const prev = img.tagId || '';
  const next = tagId || '';
  if (prev === next) return;

  // 楽観的更新: データとドロップダウンの見た目を即時反映
  const applyLook = (val) => {
    if (val) img.tagId = val; else delete img.tagId;
    if (selEl) {
      selEl.value = val;
      selEl.dataset.has = val ? '1' : '0';
      const t = val ? getCurrentTags().find(x => x.id === val) : null;
      if (t) {
        const c = getTagColor(t.color);
        selEl.style.background = c.bg;
        selEl.style.color = c.fg;
        selEl.style.borderColor = c.bg;
      } else {
        selEl.style.background = '';
        selEl.style.color = '';
        selEl.style.borderColor = '';
      }
    }
  };
  applyLook(next);

  // v1.11.26: 保存が終わるまで全画面ロックして誤操作を防ぐ (フリーズ表示)
  showLoading('タグを保存中… そのままお待ちください');
  try {
    await saveShopData(currentShopId, `image tag: ${p.itemManageNumber || p.id} / ${imageId}`);
    // フィルタ表示中は絞り込み結果が変わる可能性があるので再描画
    if (filterTagIds.size > 0) render();
  } catch (err) {
    applyLook(prev); // ロールバック
    toast('保存失敗: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===== ライトボックス (v1.9.1): ギャラリー対応 (左右クリック&矢印キーで切り替え) =====
let lightboxState = { urls: [], index: 0 };

// openLightbox: 単一URLでも、URL配列+startIndexでも呼べる
function openLightbox(imageUrlOrList, startIndex = 0) {
  let urls;
  if (Array.isArray(imageUrlOrList)) {
    urls = imageUrlOrList.filter(Boolean);
  } else {
    urls = imageUrlOrList ? [imageUrlOrList] : [];
  }
  if (urls.length === 0) return;
  lightboxState.urls = urls;
  lightboxState.index = Math.max(0, Math.min(startIndex, urls.length - 1));

  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.className = 'lightbox';
    // v1.11.20: カルーセル表示 (中央=大きく / 左右=隣の画像をうっすら)
    box.innerHTML = `
      <button class="lightbox-close" aria-label="閉じる">×</button>
      <div class="lb-stage">
        <img class="lb-peek lb-peek-prev" src="" alt="">
        <img class="lightbox-img lb-current" src="" alt="" draggable="false">
        <img class="lb-peek lb-peek-next" src="" alt="">
      </div>
      <div class="lightbox-counter"></div>
    `;
    document.body.appendChild(box);

    box.addEventListener('click', (e) => {
      const t = e.target;
      // 閉じるのは✕ボタンだけ (背景クリックでは閉じない)
      if (t.classList.contains('lightbox-close')) { closeLightbox(); return; }
      if (t.classList.contains('lb-peek-prev')) { lightboxPrev(); return; }
      if (t.classList.contains('lb-peek-next')) { lightboxNext(); return; }
      // 中央の画像クリックで「次へ」
      if (t.classList.contains('lb-current')) { lightboxNext(); return; }
      // 背景(暗い部分): クリック位置が右半分=次へ / 左半分=前へ
      if (e.clientX < window.innerWidth / 2) lightboxPrev();
      else lightboxNext();
    });
  }
  updateLightboxImage();
  box.classList.add('open');
  document.addEventListener('keydown', _lightboxKeyHandler);
  document.body.style.overflow = 'hidden';
}

function updateLightboxImage() {
  const box = document.getElementById('lightbox');
  if (!box) return;
  const { urls, index } = lightboxState;
  const url = urls[index];
  if (!url) return;
  const cur = box.querySelector('.lb-current');
  const prevEl = box.querySelector('.lb-peek-prev');
  const nextEl = box.querySelector('.lb-peek-next');
  cur.src = url;
  const multi = urls.length > 1;
  if (multi) {
    prevEl.src = urls[(index - 1 + urls.length) % urls.length];
    nextEl.src = urls[(index + 1) % urls.length];
    prevEl.style.display = '';
    nextEl.style.display = '';
  } else {
    prevEl.style.display = 'none';
    nextEl.style.display = 'none';
    prevEl.removeAttribute('src');
    nextEl.removeAttribute('src');
  }
  const counter = box.querySelector('.lightbox-counter');
  if (counter) {
    if (multi) {
      counter.style.display = 'block';
      counter.textContent = `${index + 1} / ${urls.length}`;
    } else {
      counter.style.display = 'none';
    }
  }
}

function lightboxPrev() {
  if (lightboxState.urls.length <= 1) return;
  lightboxState.index = (lightboxState.index - 1 + lightboxState.urls.length) % lightboxState.urls.length;
  updateLightboxImage();
}
function lightboxNext() {
  if (lightboxState.urls.length <= 1) return;
  lightboxState.index = (lightboxState.index + 1) % lightboxState.urls.length;
  updateLightboxImage();
}

function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (!box) return;
  box.classList.remove('open');
  document.removeEventListener('keydown', _lightboxKeyHandler);
  document.body.style.overflow = '';
}

function _lightboxKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') lightboxNext();
  else if (e.key === 'ArrowLeft') lightboxPrev();
}

// 旧名互換 (もし他で呼ばれていても動くように)
function _lightboxEscHandler(e) { _lightboxKeyHandler(e); }

// ===== 容量確認モーダル (v1.8.0) =====
function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

async function openStorageModal() {
  const modal = document.getElementById('storageModal');
  const loading = document.getElementById('storageLoading');
  const content = document.getElementById('storageContent');
  modal.style.display = 'flex';
  loading.style.display = 'flex';
  content.style.display = 'none';

  try {
    await loadStorageData();
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    console.error('Storage data fetch failed', e);
    loading.innerHTML = `<div style="color:var(--danger);text-align:center;padding:20px;">
      容量情報の取得に失敗しました<br><small>${escapeHtml(e.message)}</small>
    </div>`;
  }
}

async function loadStorageData() {
  if (!auth.pat || !auth.owner || !auth.repo) {
    throw new Error('GitHub設定が未入力です');
  }
  // Trees APIで全ファイルを一発取得 (再帰)
  const branch = auth.branch || 'main';
  const res = await ghFetch(`git/trees/${branch}?recursive=1`);
  if (!res.ok) {
    throw new Error(`Trees API ${res.status}`);
  }
  const data = await res.json();
  const tree = data.tree || [];
  // truncated の場合は警告
  const truncated = data.truncated === true;

  // 集計
  let totalSize = 0;
  let imageCount = 0;
  let imageSize = 0;
  let otherSize = 0;
  const imageExtRe = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic)$/i;
  const files = [];           // {path, size, shopId, isImage}
  const shopAgg = new Map();  // shopId -> {count, size}

  for (const node of tree) {
    if (node.type !== 'blob') continue;
    const size = node.size || 0;
    totalSize += size;
    const path = node.path;
    const isImage = imageExtRe.test(path) && path.includes('/images/');
    let shopId = null;
    const m = path.match(/^data\/([^/]+)\//);
    if (m) shopId = m[1];

    if (isImage) {
      imageCount++;
      imageSize += size;
      if (shopId) {
        const agg = shopAgg.get(shopId) || { count: 0, size: 0 };
        agg.count++;
        agg.size += size;
        shopAgg.set(shopId, agg);
      }
    } else {
      otherSize += size;
    }
    files.push({ path, size, shopId, isImage });
  }

  // 全体サイズ表示
  document.getElementById('storageTotalSize').textContent = formatBytes(totalSize);

  // バー
  const bar = document.getElementById('storageBar');
  const GB = 1024 * 1024 * 1024;
  let percent, color;
  if (totalSize < GB) {
    percent = (totalSize / GB) * 100;
    color = '#059669'; // green
  } else if (totalSize < 5 * GB) {
    percent = ((totalSize - GB) / (4 * GB)) * 100;
    color = '#ea580c'; // orange
  } else {
    percent = 100;
    color = '#dc2626'; // red
  }
  bar.style.width = Math.min(100, Math.max(2, percent)) + '%';
  bar.style.background = color;

  // 画像フォルダ集計
  document.getElementById('storageImageCount').textContent = imageCount.toLocaleString() + ' 件';
  document.getElementById('storageImageSize').textContent = formatBytes(imageSize);
  document.getElementById('storageOtherSize').textContent = formatBytes(otherSize);

  // ショップ別
  const shopListEl = document.getElementById('storageShopList');
  const shopRows = [...shopAgg.entries()].map(([shopId, agg]) => {
    const shop = shops.find(s => s.id === shopId);
    const name = shop ? shop.name : shopId;
    return { shopId, name, count: agg.count, size: agg.size };
  }).sort((a, b) => b.size - a.size);

  if (shopRows.length === 0) {
    shopListEl.innerHTML = '<div class="storage-empty">ショップ別の画像データがありません</div>';
  } else {
    shopListEl.innerHTML = shopRows.map(r => `
      <div class="storage-shop-row">
        <div class="storage-shop-name">${escapeHtml(r.name)}</div>
        <div class="storage-shop-count">${r.count.toLocaleString()} 件</div>
        <div class="storage-shop-size">${formatBytes(r.size)}</div>
      </div>
    `).join('');
  }

  // トップ10
  const topListEl = document.getElementById('storageTopList');
  const top = files.slice().sort((a, b) => b.size - a.size).slice(0, 10);
  if (top.length === 0) {
    topListEl.innerHTML = '<div class="storage-empty">ファイルがありません</div>';
  } else {
    topListEl.innerHTML = top.map((f, i) => {
      const shop = f.shopId ? (shops.find(s => s.id === f.shopId)?.name || f.shopId) : '—';
      const filename = f.path.split('/').pop();
      return `<div class="storage-top-row">
        <div class="storage-top-rank">${i + 1}</div>
        <div class="storage-top-meta">
          <div class="storage-top-name" title="${escapeHtml(f.path)}">${escapeHtml(filename)}</div>
          <div class="storage-top-shop">${escapeHtml(shop)}</div>
        </div>
        <div class="storage-top-size">${formatBytes(f.size)}</div>
      </div>`;
    }).join('');
  }

  if (truncated) {
    topListEl.insertAdjacentHTML('beforeend',
      '<div class="storage-warn">⚠️ ファイル数が多すぎて一部のみ取得しました(GitHub Trees API制限)</div>');
  }
}

// ===== エクスポート機能 (v1.8.4) =====

function saveExportState() {
  try {
    sessionStorage.setItem(SS_EXPORT_MODE, exportMode ? '1' : '0');
    sessionStorage.setItem(SS_EXPORT_SELECTION, JSON.stringify([...exportSelection]));
  } catch (e) { /* ignore */ }
}

function toggleExportMode() {
  exportMode = !exportMode;
  if (!exportMode) exportSelection.clear();
  saveExportState();
  updateExportModeButton();
  updateExportBar();
  render();
}

function updateExportModeButton() {
  const btn = document.getElementById('btnExportMode');
  if (!btn) return;
  btn.classList.toggle('active', exportMode);
  btn.title = exportMode ? 'エクスポート用モードを終了' : 'エクスポート用';
}

function toggleExportSelection(productId) {
  if (exportSelection.has(productId)) exportSelection.delete(productId);
  else exportSelection.add(productId);
  saveExportState();
  updateExportBar();
  // チェックボックスの見た目だけ更新(スクロール位置を維持)
  const cb = document.querySelector(`input[data-export-pid="${productId}"]`);
  if (cb) cb.checked = exportSelection.has(productId);
}

function updateExportBar() {
  const bar = document.getElementById('exportBar');
  if (!bar) return;
  if (exportMode && exportSelection.size > 0) {
    bar.style.display = 'flex';
    const cnt = document.getElementById('exportCount');
    if (cnt) cnt.textContent = exportSelection.size;
  } else {
    bar.style.display = 'none';
  }
}

async function executeExport() {
  if (exportSelection.size === 0) return;
  if (typeof JSZip === 'undefined') {
    toast('JSZipライブラリが読み込まれていません', 'error');
    return;
  }
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データが読み込まれていません', 'error'); return; }

  const targets = data.products.filter(p => exportSelection.has(p.id));
  if (targets.length === 0) {
    toast('エクスポート対象の商品がありません', 'error');
    return;
  }

  // 画像枚数の合計を出す
  let totalImages = 0;
  targets.forEach(p => { totalImages += (p.images || []).length; });
  if (totalImages === 0) {
    toast('選択商品に画像がありません', 'error');
    return;
  }

  const shopCode = (shop.shopCode || 'shop').toLowerCase();
  const zip = new JSZip();
  showLoading(`画像を取得中... 0/${totalImages}`);

  let okCount = 0;
  let failCount = 0;
  let processed = 0;

  for (const p of targets) {
    const manage = p.itemManageNumber || p.id;
    const folderName = `${shopCode}_${manage}`;
    const folder = zip.folder(folderName);
    const sorted = sortImagesByName(p.images || []);
    for (const img of sorted) {
      processed++;
      showLoading(`画像を取得中... ${processed}/${totalImages}`);
      try {
        const res = await fetch(img.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const filename = img.originalName || img.filename;
        folder.file(filename, blob);
        okCount++;
      } catch (e) {
        console.error('Image fetch failed', img.url, e);
        failCount++;
      }
    }
  }

  showLoading('ZIPを生成中...');
  try {
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `export_${shopCode}_${targets.length}items_${stamp}.zip`;

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    hideLoading();
    toast(`${okCount}枚をエクスポートしました${failCount ? ` / 失敗${failCount}件` : ''}`, failCount ? 'error' : 'success');
  } catch (e) {
    hideLoading();
    toast('ZIP生成失敗: ' + e.message, 'error');
  }
}

function clearExportSelection() {
  if (exportSelection.size === 0) return;
  exportSelection.clear();
  saveExportState();
  updateExportBar();
  render();
}

// お気に入りON/OFF切替 (v1.9.0)
async function toggleFavorite(productId, btnEl) {
  const data = dataCache[currentShopId];
  if (!data) return;
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  const favId = getFavoriteTagId();
  if (!favId) { toast('お気に入りタグが見つかりません', 'error'); return; }
  if (!Array.isArray(p.tagIds)) p.tagIds = [];
  const wasFav = p.tagIds.includes(favId);
  // 見た目を即時反転
  if (wasFav) {
    p.tagIds = p.tagIds.filter(x => x !== favId);
    btnEl?.classList.remove('on');
    btnEl?.classList.add('off');
    if (btnEl) btnEl.textContent = '☆';
  } else {
    p.tagIds.push(favId);
    btnEl?.classList.remove('off');
    btnEl?.classList.add('on');
    if (btnEl) btnEl.textContent = '★';
  }
  try {
    await saveShopData(currentShopId, `toggle favorite: ${p.itemManageNumber || p.id}`);
  } catch (err) {
    // ロールバック
    if (wasFav) {
      p.tagIds.push(favId);
      btnEl?.classList.remove('off');
      btnEl?.classList.add('on');
      if (btnEl) btnEl.textContent = '★';
    } else {
      p.tagIds = p.tagIds.filter(x => x !== favId);
      btnEl?.classList.remove('on');
      btnEl?.classList.add('off');
      if (btnEl) btnEl.textContent = '☆';
    }
    toast('保存失敗: ' + err.message, 'error');
  }
}

// ===== 画像編集モーダル (v1.10.0) =====
let _imagesEditingProductId = null;
let _imagesEditSelection = new Set();  // 選択中の画像ID

function openProductImagesModal(productId) {
  const data = dataCache[currentShopId];
  const p = data?.products.find(x => x.id === productId);
  if (!p) return;
  _imagesEditingProductId = productId;
  _imagesEditSelection.clear();
  document.getElementById('imagesEditTitle').textContent = `画像を編集: ${p.itemManageNumber || p.itemName || ''}`;
  renderImagesEditGrid();
  document.getElementById('imagesEditModal').style.display = 'flex';
}

function closeProductImagesModal() {
  document.getElementById('imagesEditModal').style.display = 'none';
  _imagesEditingProductId = null;
  _imagesEditSelection.clear();
}

function renderImagesEditGrid() {
  const data = dataCache[currentShopId];
  const p = data?.products.find(x => x.id === _imagesEditingProductId);
  if (!p) return;
  const grid = document.getElementById('imagesEditGrid');
  const empty = document.getElementById('imagesEditEmpty');
  const sortedImages = sortImagesByName(p.images || []);
  if (sortedImages.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    grid.innerHTML = sortedImages.map(img => {
      const checked = _imagesEditSelection.has(img.id);
      const filename = img.originalName || img.filename || '';
      return `<div class="images-edit-card ${checked ? 'selected' : ''}" data-iid="${img.id}">
        <input type="checkbox" class="images-edit-check" data-edit-img-check="${img.id}" ${checked ? 'checked' : ''}>
        <div class="images-edit-thumb">
          <img src="${escapeHtml(img.url)}" alt="" loading="lazy">
        </div>
        <div class="images-edit-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('[data-edit-img-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.editImgCheck;
        if (cb.checked) _imagesEditSelection.add(id);
        else _imagesEditSelection.delete(id);
        const card = cb.closest('.images-edit-card');
        if (card) card.classList.toggle('selected', cb.checked);
        updateImagesEditSelectionBar();
      });
    });
    // カードの本体クリック(チェックボックス外)でもトグル
    grid.querySelectorAll('.images-edit-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = card.querySelector('input[type="checkbox"]');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      });
    });
  }
  updateImagesEditSelectionBar();
}

function updateImagesEditSelectionBar() {
  const bar = document.getElementById('imagesEditDeleteBar');
  if (!bar) return;
  const count = _imagesEditSelection.size;
  if (count === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    document.getElementById('imagesEditDeleteCount').textContent = count;
  }
}

async function deleteSelectedImagesInModal() {
  if (_imagesEditSelection.size === 0) return;
  if (!confirm(`${_imagesEditSelection.size}枚の画像を削除します。よろしいですか?`)) return;
  const data = dataCache[currentShopId];
  const p = data?.products.find(x => x.id === _imagesEditingProductId);
  if (!p) return;
  const idsToDelete = new Set(_imagesEditSelection);
  const targetImgs = (p.images || []).filter(img => idsToDelete.has(img.id));
  const progress = document.getElementById('imagesEditProgress');
  if (progress) progress.textContent = `削除中... 0/${targetImgs.length}`;
  document.getElementById('imagesEditLoading').style.display = 'flex';

  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < targetImgs.length; i++) {
    const img = targetImgs[i];
    if (progress) progress.textContent = `削除中... ${i + 1}/${targetImgs.length}`;
    try {
      // GitHubから画像を削除
      if (img.path && img.sha) {
        await ghFetch(`contents/${encodeURI(img.path)}`, {
          method: 'DELETE',
          body: JSON.stringify({
            message: `delete image: ${img.path}`,
            sha: img.sha,
            branch: auth.branch || 'main'
          })
        });
      }
      okCount++;
    } catch (e) {
      console.error('Image delete failed', e);
      failCount++;
    }
  }
  // メタデータから削除した画像を除外
  p.images = (p.images || []).filter(img => !idsToDelete.has(img.id));
  try {
    await saveShopData(currentShopId, `delete ${okCount} images from product`);
  } catch (e) {
    toast('JSON保存失敗: ' + e.message, 'error');
  }
  document.getElementById('imagesEditLoading').style.display = 'none';
  _imagesEditSelection.clear();
  renderImagesEditGrid();
  render();
  toast(`${okCount}枚を削除しました${failCount ? ` / 失敗${failCount}件` : ''}`, failCount ? 'error' : 'success');
}

async function uploadImagesToProductInModal(files) {
  if (!files.length) return;
  const data = dataCache[currentShopId];
  const p = data?.products.find(x => x.id === _imagesEditingProductId);
  if (!p) return;
  // 画像ファイルだけに絞る
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    toast('画像ファイルが含まれていません', 'error');
    return;
  }
  document.getElementById('imagesEditLoading').style.display = 'flex';
  const progress = document.getElementById('imagesEditProgress');

  let success = 0;
  let failed = 0;
  for (let i = 0; i < imageFiles.length; i++) {
    const f = imageFiles[i];
    if (progress) progress.textContent = `アップロード中 ${i + 1}/${imageFiles.length}: ${f.name}`;
    try {
      const imgMeta = await uploadImageToGitHub(currentShopId, p.id, f);
      if (!p.images) p.images = [];
      p.images.push(imgMeta);
      success++;
    } catch (e) {
      console.error('Upload failed', e);
      failed++;
    }
  }
  if (progress) progress.textContent = `JSON保存中...`;
  try {
    await saveShopData(currentShopId, `add ${success} images to product`);
  } catch (e) {
    toast('JSON保存失敗: ' + e.message, 'error');
  }
  document.getElementById('imagesEditLoading').style.display = 'none';
  renderImagesEditGrid();
  render();
  toast(`アップロード完了: 成功${success}件${failed ? ` / 失敗${failed}件` : ''}`, failed ? 'error' : 'success');
}

function toggleSort(key) {
  if (sortKey !== key) {
    sortKey = key;
    sortDir = 'asc';
  } else if (sortDir === 'asc') {
    sortDir = 'desc';
  } else {
    sortKey = null;
    sortDir = 'asc';
  }
  // localStorageに保存
  localStorage.setItem(LS_SORT_KEY, sortKey === null ? '' : sortKey);
  localStorage.setItem(LS_SORT_DIR, sortDir);
  render();
}

function productRowHTML(p) {
  const imgCount = (p.images || []).length;
  const isEmpty = imgCount === 0;
  const manage = p.itemManageNumber || '';
  const number = p.itemNumber || '';

  // エクスポートモード用のチェックボックスセル
  const exportCellHTML = exportMode
    ? `<div class="col-export"><input type="checkbox" class="export-checkbox" data-export-pid="${p.id}" ${exportSelection.has(p.id) ? 'checked' : ''}></div>`
    : '';

  const sortedImages = sortImagesByName(p.images || []);

  // v1.11.8: 画像単位の分類タグ用。ドロップダウンに出す分類タグ（お気に入りは除外）
  const favTagIdForImg = getFavoriteTagId();
  const classTagsForImg = getCurrentTags().filter(t => t.id !== favTagIdForImg);

  // v1.11.9: 上部の分類タグでフィルタ中は、その分類が付いた「画像だけ」を表示する。
  //          (お気に入りは商品単位フィルタなので画像の絞り込みには使わない)
  const classFilterIds = filterTagIds.size > 0
    ? [...filterTagIds].filter(id => id !== favTagIdForImg)
    : [];
  let visibleImages = sortedImages;
  if (classFilterIds.length > 0) {
    const matching = sortedImages.filter(im => classFilterIds.includes(im.tagId));
    // マッチ画像がある商品はマッチ画像だけに絞る。
    // (お気に入りフィルタ等で表示されているがマッチ画像が無い商品は従来どおり全画像を表示)
    if (matching.length > 0) visibleImages = matching;
  }

  // basicモードは5枚まで、imagesとdeleteは全部
  const displayImages = (viewMode === 'images' || viewMode === 'delete')
    ? visibleImages
    : visibleImages.slice(0, 5);
  const remaining = visibleImages.length - displayImages.length;

  const imgsHTML = displayImages.map((img, idx) => {
    // ライトボックスは商品の全画像で切り替えたいので、全体配列での位置を渡す
    const realIdx = sortedImages.indexOf(img);
    const isMarked = deleteSelection.has(img.id);
    if (viewMode === 'delete') {
      return `<div class="product-row-thumb delete-mark ${isMarked ? 'marked' : ''}"
        data-delete-toggle="${img.id}"
        title="${escapeHtml(getImageSortKey(img))}">
        <img data-src="${escapeHtml(img.url)}" alt="" class="lazy-thumb">
        ${isMarked ? '<div class="delete-mark-overlay">✕</div>' : ''}
      </div>`;
    }
    // v1.11.8: 画像全体モードでは、各画像の下に「分類タグ」ドロップダウン(1画像1タグ)を表示
    let imgTagSelectHTML = '';
    if (viewMode === 'images') {
      const sel = img.tagId || '';
      const selTag = sel ? classTagsForImg.find(t => t.id === sel) : null;
      const c = selTag ? getTagColor(selTag.color) : null;
      const styleAttr = c ? ` style="background:${c.bg};color:${c.fg};border-color:${c.bg}"` : '';
      const opts = ['<option value="" style="background:#fff;color:#334155">タグなし</option>']
        .concat(classTagsForImg.map(t => {
          const cc = getTagColor(t.color);
          return `<option value="${t.id}" ${t.id === sel ? 'selected' : ''} style="background:${cc.bg};color:${cc.fg}">${escapeHtml(t.name)}</option>`;
        }))
        .join('');
      imgTagSelectHTML = `<select class="img-tag-select" data-img-tag-pid="${p.id}" data-img-tag-id="${img.id}" data-has="${sel ? '1' : '0'}"${styleAttr}>${opts}</select>`;
    }
    return `<div class="img-tag-cell">
      <div class="product-row-thumb" data-lb-pid="${p.id}" data-lb-index="${realIdx}" title="${escapeHtml(getImageSortKey(img))}">
        <img data-src="${escapeHtml(img.url)}" alt="" class="lazy-thumb">
      </div>
      ${imgTagSelectHTML}
    </div>`;
  }).join('');

  // 残り表示(basicモードで5枚超え) — 「+N」は商品モーダルを開く
  const moreHTML = remaining > 0
    ? `<div class="product-row-more" data-open-product="${p.id}" title="残り${remaining}枚">+${remaining}</div>`
    : '';

  const manageCell = manage
    ? `<span class="mono">${escapeHtml(manage)}</span>`
    : `<span class="mono mono-placeholder">10000000</span>`;
  const numberCell = number
    ? `<span class="mono">${escapeHtml(number)}</span>`
    : `<span class="mono mono-placeholder">未設定</span>`;

  // タグ表示 (2x2格子 - ただし「お気に入り」は別UIにするため除外)
  const tagIds = p.tagIds || [];
  const favTagId = getFavoriteTagId();
  const allTags = getCurrentTags();
  const visibleTags = allTags.filter(t => t.id !== favTagId);
  const tagGridHTML = visibleTags.length > 0
    ? `<div class="tag-grid" data-pid="${p.id}">
        ${visibleTags.map(t => {
          const c = getTagColor(t.color);
          const has = tagIds.includes(t.id);
          return `<button class="tag-grid-item ${has ? 'on' : 'off'}"
            data-tag-toggle="${t.id}" data-pid="${p.id}"
            style="--tag-bg:${c.bg};--tag-fg:${c.fg}"
            title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`;
        }).join('')}
      </div>`
    : '';

  // お気に入り専用ボタン (現役/微妙の位置に置く)
  const isFavorite = favTagId && tagIds.includes(favTagId);
  const favoriteCellHTML = favTagId
    ? `<button class="favorite-btn ${isFavorite ? 'on' : 'off'}" data-fav-pid="${p.id}" title="お気に入り">${isFavorite ? '★' : '☆'}</button>`
    : '';

  const addBtnHTML = isEmpty
    ? `<button class="thumb-add" data-add-img="${p.id}" title="画像を追加">
        <span class="thumb-add-icon">＋</span>
        <span class="thumb-add-empty">未登録</span>
      </button>`
    : '';

  const originalStatus = p.status || 'active';
  const pendingStatus = pendingStatusChanges.get(p.id);
  const displayedStatus = pendingStatus !== undefined ? pendingStatus : originalStatus;
  const isPending = pendingStatus !== undefined;
  const statusToggleHTML = `<div class="product-status-toggle ${isPending ? 'pending' : ''}" data-pid="${p.id}">
    <label class="status-radio ${displayedStatus === 'active' ? 'active' : ''}">
      <input type="radio" name="status_${p.id}" value="active" ${displayedStatus === 'active' ? 'checked' : ''} data-status-pid="${p.id}">
      <span>現役</span>
    </label>
    <label class="status-radio ${displayedStatus === 'unsure' ? 'active unsure' : ''}">
      <input type="radio" name="status_${p.id}" value="unsure" ${displayedStatus === 'unsure' ? 'checked' : ''} data-status-pid="${p.id}">
      <span>微妙</span>
    </label>
  </div>`;

  const imagesCellHTML = `<div class="col-images">
    <div class="product-row-images">
      ${addBtnHTML}
      ${imgsHTML}
      ${moreHTML}
    </div>
  </div>`;

  if (viewMode === 'images') {
    // 画像全体モード: 商品番号・画像・お気に入り・タグ操作
    // (現役/微妙は情報編集モーダルで操作)
    const actionsForImagesMode = `<div class="col-actions">
      <div class="edit-btn-group">
        <button class="btn-edit-mini" data-edit-images="${p.id}" title="画像を編集">🖼️ 画像</button>
        <button class="btn-edit-mini" data-edit-info="${p.id}" title="商品情報を編集">📝 情報</button>
      </div>
    </div>`;
    return `<div class="product-row mode-images ${exportMode ? 'with-export' : ''} ${isEmpty ? 'empty' : ''}">
      ${exportCellHTML}
      <div class="col-number">${numberCell}</div>
      <div class="col-manage">${manageCell}</div>
      <div class="col-name"><div class="product-row-name" title="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)}</div></div>
      ${imagesCellHTML}
      ${actionsForImagesMode}
    </div>`;
  }

  if (viewMode === 'delete') {
    // 削除モード: 商品番号・画像のみ
    return `<div class="product-row mode-delete ${exportMode ? 'with-export' : ''} ${isEmpty ? 'empty' : ''}">
      ${exportCellHTML}
      <div class="col-number">${numberCell}</div>
      ${imagesCellHTML}
    </div>`;
  }

  if (viewMode === 'productdelete') {
    // v1.11.29: 商品削除モード。行クリックで商品ごと選択。サムネは読み取り専用。
    const selected = productDeleteSelection.has(p.id);
    const shown = sortedImages.slice(0, 12);
    const moreN = sortedImages.length - shown.length;
    const pdThumbs = shown.map(img =>
      `<div class="product-row-thumb"><img data-src="${escapeHtml(img.url)}" alt="" class="lazy-thumb"></div>`).join('');
    return `<div class="product-row mode-productdelete ${selected ? 'pd-selected' : ''} ${isEmpty ? 'empty' : ''}" data-pd-toggle="${p.id}">
      <div class="col-pd-check">${selected ? '☑' : '☐'}</div>
      <div class="col-number">${numberCell}</div>
      <div class="col-manage">${manageCell}</div>
      <div class="col-name"><div class="product-row-name" title="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)}</div></div>
      <div class="col-images"><div class="product-row-images">${pdThumbs}${moreN > 0 ? `<div class="product-row-more">+${moreN}</div>` : ''}</div></div>
    </div>`;
  }

  // 基礎情報モード: お気に入りを画像の右隣に専用列、現役/微妙は情報編集モーダルへ
  const actionsCellForBasic = `<div class="col-actions">
    ${tagGridHTML}
    <div class="edit-btn-group">
      <button class="btn-edit-mini" data-edit-images="${p.id}" title="画像を編集">🖼️ 画像</button>
      <button class="btn-edit-mini" data-edit-info="${p.id}" title="商品情報を編集">📝 情報</button>
    </div>
  </div>`;
  return `<div class="product-row mode-basic ${exportMode ? 'with-export' : ''} ${isEmpty ? 'empty' : ''}">
    ${exportCellHTML}
    <div class="col-manage">${manageCell}</div>
    <div class="col-number">${numberCell}</div>
    <div class="col-name">
      <div class="product-row-name" title="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)}</div>
    </div>
    ${imagesCellHTML}
    <div class="col-favorite">${favoriteCellHTML}</div>
    ${actionsCellForBasic}
  </div>`;
}

function renderMaterialGrid(entries) {
  const content = document.getElementById('content');
  let list = entries.slice();
  if (searchQuery) {
    list = list.filter(e => (e.name || '').toLowerCase().includes(searchQuery));
  }

  if (list.length === 0) {
    const catName = currentCategory === 'material' ? '素材' : '盛り上げ';
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎨</div>
      <div class="empty-title">${entries.length === 0 ? `${catName}データがありません` : '該当データがありません'}</div>
      <div class="empty-desc">${entries.length === 0 ? '右上の「+ 追加」から登録してください' : '検索条件を変えてみてください'}</div>
    </div>`;
    return;
  }

  const html = `<div class="material-grid">${list.map(e => materialTileHTML(e)).join('')}</div>`;
  content.innerHTML = html;
  content.querySelectorAll('.material-tile').forEach(el => {
    el.addEventListener('click', () => openMaterialModal(el.dataset.id));
  });
}

function materialTileHTML(e) {
  const imgCount = (e.images || []).length;
  const thumb = imgCount > 0
    ? `<img src="${escapeHtml(e.images[0].url)}" alt="">`
    : '🎨';
  return `<div class="material-tile" data-id="${e.id}">
    <div class="material-tile-thumb">${thumb}</div>
    <div class="material-tile-info">
      <div class="material-tile-name">${escapeHtml(e.name)}</div>
      <div class="material-tile-count">${imgCount}枚</div>
    </div>
  </div>`;
}

// 盛り上げ用テーブル形式 (タイトル + 画像横並び)
function renderBoostTable(entries) {
  const content = document.getElementById('content');
  let list = entries.slice();
  if (searchQuery) {
    list = list.filter(e => (e.name || '').toLowerCase().includes(searchQuery));
  }
  if (filterUnregistered) {
    list = list.filter(e => !e.images || e.images.length === 0);
  }

  if (list.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎉</div>
      <div class="empty-title">${entries.length === 0 ? '盛り上げデータがありません' : '該当データがありません'}</div>
      <div class="empty-desc">${entries.length === 0 ? '右上の「+ 追加」から登録してください' : '検索条件を変えてみてください'}</div>
    </div>`;
    return;
  }

  const headerHTML = `
    <div class="product-table-header mode-boost">
      <div class="col-name">タイトル</div>
      <div class="col-images">画像</div>
    </div>
  `;

  const rowsHTML = list.map(e => boostRowHTML(e)).join('');

  content.innerHTML = `<div class="product-table">${headerHTML}${rowsHTML}</div>`;

  // 画像クリック → モーダル
  content.querySelectorAll('[data-open-boost]').forEach(el => {
    el.addEventListener('click', () => openMaterialModal(el.dataset.openBoost));
  });
  // タイトルクリック → モーダル
  content.querySelectorAll('[data-boost-title]').forEach(el => {
    el.addEventListener('click', () => openMaterialModal(el.dataset.boostTitle));
  });
  // 画像追加ボタン
  content.querySelectorAll('[data-add-boost-img]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openMaterialModal(btn.dataset.addBoostImg);
    });
  });
}

function boostRowHTML(e) {
  const sortedImages = sortImagesByName(e.images || []);
  const imgCount = sortedImages.length;
  const isEmpty = imgCount === 0;

  const imgsHTML = sortedImages.map(img => `
    <div class="product-row-thumb" data-open-boost="${e.id}" title="${escapeHtml(getImageSortKey(img))}">
      <img src="${escapeHtml(img.url)}" alt="" loading="lazy">
    </div>
  `).join('');

  const addBtnHTML = isEmpty
    ? `<button class="thumb-add" data-add-boost-img="${e.id}" title="画像を追加">
        <span class="thumb-add-icon">＋</span>
        <span class="thumb-add-empty">未登録</span>
      </button>`
    : '';

  return `<div class="product-row mode-boost ${isEmpty ? 'empty' : ''}">
    <div class="col-name">
      <div class="product-row-name" data-boost-title="${e.id}" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</div>
      ${e.note ? `<div class="boost-note">${escapeHtml(e.note)}</div>` : ''}
    </div>
    <div class="col-images">
      <div class="product-row-images">
        ${addBtnHTML}
        ${imgsHTML}
      </div>
    </div>
  </div>`;
}

// =====================================================
// 商品モーダル (画像アップロード&一覧)
// =====================================================
function openProductModal(productId) {
  currentProductId = productId;
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === productId);
  if (!p) return;

  document.getElementById('productModalTitle').textContent = p.itemName || '(無題)';
  document.getElementById('productModalMeta').textContent = `商品コード: ${p.itemManageNumber || '—'}  |  商品番号: ${p.itemNumber || '—'}  |  Yahoo商品ID: ${p.itemCode || '—'}`;
  renderProductImageGrid(p);
  document.getElementById('productModal').style.display = 'flex';
}

function openProductEditForm(productId) {
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('productEditId').value = p.id;
  document.getElementById('productEditManageNumber').value = p.itemManageNumber || '';
  document.getElementById('productEditNumber').value = p.itemNumber || '';
  document.getElementById('productEditName').value = p.itemName || '';
  document.getElementById('productEditItemCode').textContent = p.itemCode || '—';
  // ステータス(現役/微妙)を反映 (v1.9.0)
  const status = p.status || 'active';
  const statusInputs = document.querySelectorAll('input[name="productEditStatus"]');
  statusInputs.forEach(input => {
    input.checked = input.value === status;
  });
  document.getElementById('productEditModal').style.display = 'flex';
}

async function saveProductEditForm() {
  const id = document.getElementById('productEditId').value;
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === id);
  if (!p) return;
  p.itemManageNumber = document.getElementById('productEditManageNumber').value.trim();
  p.itemNumber = document.getElementById('productEditNumber').value.trim();
  p.itemName = document.getElementById('productEditName').value.trim();
  // ステータス(現役/微妙)も保存 (v1.9.0)
  const checkedStatus = document.querySelector('input[name="productEditStatus"]:checked');
  if (checkedStatus) p.status = checkedStatus.value;

  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `edit product: ${p.itemName}`);
    hideLoading();
    closeModal('productEditModal');
    toast('保存しました', 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

function openMaterialModal(entryId) {
  currentProductId = entryId;
  const data = dataCache[currentShopId];
  const list = currentCategory === 'material' ? data.materials : data.boosts;
  const e = list.find(x => x.id === entryId);
  if (!e) return;
  document.getElementById('productModalTitle').textContent = e.name || '(無題)';
  document.getElementById('productModalMeta').textContent = e.note || '';
  renderProductImageGrid(e);
  document.getElementById('productModal').style.display = 'flex';
}

function getCurrentEntry() {
  const data = dataCache[currentShopId];
  if (!data) return null;
  if (currentCategory === 'material') return data.materials.find(x => x.id === currentProductId);
  if (currentCategory === 'boost') return data.boosts.find(x => x.id === currentProductId);
  // v1.11.16: product / product_all / product_unsure はすべて「商品」として扱う
  //   (以前は 'product' のみ判定していたため、全体タブ[product_all]で「対象が選択されていません」になっていた)
  return data.products.find(x => x.id === currentProductId);
}

function renderProductImageGrid(entry) {
  const grid = document.getElementById('productImageGrid');
  const images = sortImagesByName(entry.images || []);
  if (images.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--text-light)">
      📷 まだ画像がありません。上のエリアからアップロードしてください
    </div>`;
    return;
  }
  grid.innerHTML = images.map(img => `
    <div class="image-tile" data-img-id="${img.id}">
      <div class="image-tile-thumb"><img src="${escapeHtml(img.url)}" alt="" loading="lazy"></div>
      <div class="image-tile-info">
        <div class="image-tile-name" title="${escapeHtml(getImageSortKey(img))}">${escapeHtml(getImageSortKey(img))}</div>
        ${(img.tags && img.tags.length)
          ? `<div class="image-tile-tags">${img.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
          : ''}
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.image-tile').forEach(el => {
    el.addEventListener('click', () => openImageDetail(el.dataset.imgId));
  });
}

async function uploadFiles(files) {
  if (!files.length) return;
  const entry = getCurrentEntry();
  if (!entry) { toast('対象が選択されていません', 'error'); return; }

  const progress = document.getElementById('uploadProgress');
  progress.style.display = 'block';

  let success = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    progress.textContent = `アップロード中 ${i + 1}/${files.length}: ${f.name}`;
    try {
      // v1.11.16: 商品カテゴリ(product/product_all/product_unsure)は entry.id を保存先にする
      const isMatBoost = currentCategory === 'material' || currentCategory === 'boost';
      const productLinkId = isMatBoost ? (entry.productId || null) : entry.id;
      const imgMeta = await uploadImageToGitHub(currentShopId, productLinkId, f);
      if (!entry.images) entry.images = [];
      entry.images.push(imgMeta);
      success++;
    } catch (e) {
      console.error(e);
      failed++;
    }
  }

  progress.textContent = `保存中...`;
  try {
    await saveShopData(currentShopId, `add images x${success}`);
  } catch (e) {
    toast('JSON保存失敗: ' + e.message, 'error');
  }
  progress.style.display = 'none';
  renderProductImageGrid(entry);
  render();
  toast(`アップロード完了: 成功${success}件${failed ? ` / 失敗${failed}件` : ''}`, failed ? 'error' : 'success');
}

// =====================================================
// 画像詳細モーダル
// =====================================================
function openImageDetail(imgId) {
  const entry = getCurrentEntry();
  if (!entry) return;
  const img = (entry.images || []).find(i => i.id === imgId);
  if (!img) return;

  currentImageId = imgId;
  const displayName = getImageSortKey(img);
  document.getElementById('imageDetailImg').src = img.url;
  document.getElementById('imageDetailTitle').textContent = displayName;
  document.getElementById('imageDetailFilename').textContent = displayName;
  document.getElementById('imageDetailDate').textContent = formatDate(img.uploadedAt);
  document.getElementById('imageDetailNote').value = img.note || '';
  document.getElementById('btnDownloadImage').href = img.url;
  document.getElementById('btnDownloadImage').download = img.originalName || img.filename;
  renderImageTags(img.tags || []);
  document.getElementById('imageModal').style.display = 'flex';
}

function renderImageTags(tags) {
  const wrap = document.getElementById('imageDetailTags');
  wrap.innerHTML = tags.map((t, i) => `
    <span class="tag-pill">${escapeHtml(t)}<span class="tag-remove" data-i="${i}">×</span></span>
  `).join('');
  wrap.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i);
      const entry = getCurrentEntry();
      const img = (entry.images || []).find(x => x.id === currentImageId);
      img.tags.splice(i, 1);
      renderImageTags(img.tags);
    });
  });
}

function addTagFromInput() {
  const input = document.getElementById('imageDetailTagInput');
  const v = input.value.trim();
  if (!v) return;
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img.tags) img.tags = [];
  if (!img.tags.includes(v)) img.tags.push(v);
  input.value = '';
  renderImageTags(img.tags);
}

async function saveImageDetail() {
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img) return;
  img.note = document.getElementById('imageDetailNote').value;
  // tagsは追加/削除時に既に反映済み
  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `update image meta: ${img.filename}`);
    hideLoading();
    toast('保存しました', 'success');
    renderProductImageGrid(entry);
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

async function deleteCurrentImage() {
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img) return;
  if (!confirm(`「${img.filename}」を削除します。元に戻せません。本当に削除しますか?`)) return;

  showLoading('画像を削除中...');
  try {
    await deleteImageFromGitHub(img);
    entry.images = entry.images.filter(x => x.id !== currentImageId);
    await saveShopData(currentShopId, `delete image: ${img.filename}`);
    hideLoading();
    closeModal('imageModal');
    renderProductImageGrid(entry);
    render();
    toast('削除しました', 'success');
  } catch (e) {
    hideLoading();
    toast('削除失敗: ' + e.message, 'error');
  }
}

function copyImageUrl() {
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img) return;
  navigator.clipboard.writeText(img.url).then(() => {
    toast('URLをコピーしました', 'success');
  });
}

// =====================================================
// エントリー追加 (素材/盛り上げ)
// =====================================================
function openEntryForm() {
  // v1.11.16: 商品カテゴリ(product/product_all/product_unsure)では手動追加不可
  if (currentCategory !== 'material' && currentCategory !== 'boost') {
    toast('「商品」は同期で自動追加されます。「+ 商品同期」をご利用ください', 'error');
    return;
  }
  document.getElementById('entryFormId').value = '';
  document.getElementById('entryFormCategory').value = currentCategory;
  document.getElementById('entryFormName').value = '';
  document.getElementById('entryFormNote').value = '';

  // 商品プルダウン
  const sel = document.getElementById('entryFormProductId');
  sel.innerHTML = '<option value="">紐づけなし (ショップ共通)</option>';
  const data = dataCache[currentShopId];
  (data.products || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.itemName} (${p.itemNumber || p.itemCode})`;
    sel.appendChild(opt);
  });

  document.getElementById('entryFormTitle').textContent = currentCategory === 'material' ? '素材を追加' : '盛り上げを追加';
  document.getElementById('entryFormModal').style.display = 'flex';
}

async function saveEntryForm() {
  const name = document.getElementById('entryFormName').value.trim();
  if (!name) { toast('名前を入力してください', 'error'); return; }
  const cat = document.getElementById('entryFormCategory').value;
  const productId = document.getElementById('entryFormProductId').value || null;
  const note = document.getElementById('entryFormNote').value;

  const entry = {
    id: 'ent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name,
    productId,
    note,
    images: [],
    createdAt: new Date().toISOString()
  };

  const data = dataCache[currentShopId];
  if (cat === 'material') data.materials.push(entry);
  else if (cat === 'boost') data.boosts.push(entry);

  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `add ${cat}: ${name}`);
    hideLoading();
    closeModal('entryFormModal');
    toast('追加しました', 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

// =====================================================
// 設定モーダル
// =====================================================
function openSettings() {
  document.getElementById('settingPat').value = auth.pat || '';
  document.getElementById('settingOwner').value = auth.owner || '';
  document.getElementById('settingRepo').value = auth.repo || '';
  document.getElementById('settingBranch').value = auth.branch || 'main';
  // PATは開くたびにマスク状態に戻す (v1.9.2)
  const patInput = document.getElementById('settingPat');
  const patBtn = document.getElementById('btnTogglePat');
  if (patInput) patInput.type = 'password';
  if (patBtn) patBtn.textContent = '👁 表示';
  renderShopsList();
  document.getElementById('settingsModal').style.display = 'flex';
}

function renderShopsList() {
  const wrap = document.getElementById('shopsList');
  if (shops.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light);font-size:13px">まだショップがありません</div>';
    return;
  }
  wrap.innerHTML = shops.map(s => `
    <div class="shop-row">
      <div class="shop-row-info">
        <div class="shop-row-name">${escapeHtml(s.name)}</div>
        <div class="shop-row-meta">${escapeHtml(s.mall)} / ${escapeHtml(s.shopCode || '—')}</div>
        <div class="shop-row-url" title="このショップ専用のURL。ブラウザで開いてスピードダイアルに登録できます">🔗 <code>?shop=${escapeHtml(shopSlug(s))}</code><button type="button" class="shop-url-copy" data-copyurl="${s.id}">URLをコピー</button></div>
      </div>
      <div class="shop-row-actions">
        <button class="btn-icon-mini" data-edit="${s.id}">編集</button>
        <button class="btn-icon-mini danger" data-del="${s.id}">削除</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openShopForm(b.dataset.edit)));
  wrap.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteShop(b.dataset.del)));
  // v1.11.38: ショップ専用URLをクリップボードへ
  wrap.querySelectorAll('[data-copyurl]').forEach(b => b.addEventListener('click', () => {
    const s = shops.find(x => x.id === b.dataset.copyurl);
    if (!s) return;
    let url;
    try {
      const u = new URL(location.href);
      u.search = '';
      u.hash = '';
      u.searchParams.set(URL_SHOP_PARAM, shopSlug(s));
      url = u.toString();
    } catch (e) { url = `?shop=${shopSlug(s)}`; }
    const done = () => toast('URLをコピーしました: ' + url, 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => prompt('コピーしてください', url));
    } else {
      prompt('コピーしてください', url);
    }
  }));
}

function saveSettings() {
  auth.pat = document.getElementById('settingPat').value.trim();
  auth.owner = document.getElementById('settingOwner').value.trim();
  auth.repo = document.getElementById('settingRepo').value.trim();
  auth.branch = document.getElementById('settingBranch').value.trim() || 'main';
  saveAuth();
  toast('設定を保存しました', 'success');
  closeModal('settingsModal');
  // 現在のショップデータを再ロード
  delete dataCache[currentShopId];
  loadCurrentShopData().then(() => render());
}

// =====================================================
// ショップ追加・編集
// =====================================================
function openShopForm(shopId) {
  document.getElementById('shopFormId').value = shopId || '';
  if (shopId) {
    const s = shops.find(x => x.id === shopId);
    if (!s) return;
    document.getElementById('shopFormTitle').textContent = 'ショップを編集';
    document.getElementById('shopFormName').value = s.name || '';
    document.getElementById('shopFormMall').value = 'yahoo';
    document.getElementById('shopFormCode').value = s.shopCode || '';
    document.getElementById('shopFormAppId').value = s.appId || '';
    document.getElementById('shopFormAccessKey').value = s.accessKey || '';
  } else {
    document.getElementById('shopFormTitle').textContent = 'ショップを追加';
    document.getElementById('shopFormName').value = '';
    document.getElementById('shopFormMall').value = 'yahoo';
    document.getElementById('shopFormCode').value = '';
    document.getElementById('shopFormAppId').value = '';
    document.getElementById('shopFormAccessKey').value = '';
  }
  document.getElementById('shopFormModal').style.display = 'flex';
  // v1.11.7: Access Keyを開くたびにマスク状態に戻す
  const ak = document.getElementById('shopFormAccessKey');
  const akBtn = document.getElementById('btnToggleAccessKey');
  if (ak) ak.type = 'password';
  if (akBtn) akBtn.textContent = '👁 表示';
}

function saveShopForm() {
  const id = document.getElementById('shopFormId').value;
  const name = document.getElementById('shopFormName').value.trim();
  if (!name) { toast('ショップ名を入力してください', 'error'); return; }
  const obj = {
    id: id || ('shop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    name,
    mall: 'yahoo',
    // Yahoo版: shopCode には YahooストアID (seller_id) を入れる。URLの ?shop= やZIPのフォルダ名にも使う
    shopCode: document.getElementById('shopFormCode').value.trim().toLowerCase(),
    appId: document.getElementById('shopFormAppId').value.trim(),
    accessKey: document.getElementById('shopFormAccessKey').value.trim()
  };
  if (id) {
    const i = shops.findIndex(x => x.id === id);
    if (i >= 0) shops[i] = obj;
  } else {
    shops.push(obj);
    if (!currentShopId) currentShopId = obj.id;
  }
  saveAuth();
  renderShopsList();
  renderShopTabs();
  closeModal('shopFormModal');
  toast('保存しました', 'success');
  if (currentShopId === obj.id) {
    delete dataCache[currentShopId];
    loadCurrentShopData().then(() => render());
  }
}

function deleteShop(shopId) {
  const s = shops.find(x => x.id === shopId);
  if (!s) return;
  if (!confirm(`ショップ「${s.name}」を削除します。\n※GitHub上のデータは残ります。完全削除はGitHubから手動で行ってください。\n本当に削除しますか?`)) return;
  shops = shops.filter(x => x.id !== shopId);
  if (currentShopId === shopId) {
    currentShopId = shops[0]?.id || null;
    localStorage.setItem(LS_CURRENT_SHOP, currentShopId || '');
  }
  delete dataCache[shopId];
  saveAuth();
  renderShopsList();
  renderShopTabs();
  loadCurrentShopData().then(() => render());
  toast('削除しました', 'success');
}

// =====================================================
// ユーティリティ
// =====================================================
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function goHome() {
  currentCategory = 'product';
  searchQuery = '';
  filterUnregistered = false;
  document.getElementById('searchInput').value = '';
  document.getElementById('filterUnregistered').checked = false;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === 'product'));
  render();
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Yahoo v1.0.0: 表示時間を文字数に合わせる (エラーは最低8秒)。クリックで閉じる。
//   楽天版は一律2.8秒で、長いエラー理由が読み切れなかった。前のタイマーも消すようにした
//   (消さないと、続けて出したトーストが前のタイマーで早く消える)。
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  if (!el.dataset.clickBound) {
    el.dataset.clickBound = '1';
    el.addEventListener('click', () => { el.className = el.className.replace(/\bshow\b/, '').trim(); });
  }
  const len = String(msg || '').length;
  const ms = Math.min(15000, Math.max(type === 'error' ? 8000 : 2800, len * 90));
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.className = 'toast' + (type ? ' ' + type : ''); }, ms);
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || '処理中...';
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}
