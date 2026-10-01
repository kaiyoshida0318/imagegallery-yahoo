# ImageGallery Yahoo版

Yahoo!ショッピングの自社商品画像を、LP制作用に商品ごと・画像ごとに分類して管理するツールです。
楽天版 `kaiyoshida0318/imagegallery` v1.11.41 を複製し、商品の取り込みだけをYahoo用に作り直しています。

- 本番URL（予定）: https://kaiyoshida0318.github.io/imagegallery-yahoo/
- バージョン: Yahoo v1.0.0

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` / `app.js` / `style.css` / `sw.js` / `logo-header.png` | ツール本体（ビルド不要の静的サイト） |
| `.github/workflows/yahoo-sync.yml` | Yahoo商品一覧を取得するワークフロー |
| `scripts/yahoo-fetch.mjs` | ワークフローから実行される取得スクリプト（Node 20、依存なし） |
| `.github/workflows/compress-images.yml` | 画像圧縮（楽天版と同じ） |
| `data/` | データ置き場（最初は空） |

## 初回セットアップ

1. **リポジトリを作る**: GitHubで `imagegallery-yahoo` を **Public** で新規作成。
2. **ファイルを置く**: ZIPの中身をアップロード。
   ⚠️ `.github` は「.」で始まるフォルダなので、Macでは Finder に表示されずアップロードから漏れがちです。
   漏れた場合は GitHub の「Add file → Create new file」でファイル名欄に `.github/workflows/yahoo-sync.yml` と打ち、中身を貼り付けてください。
3. **GitHub Pagesを有効化**: Settings → Pages → Branch: `main` / `/(root)`。
4. **Yahoo Client ID を登録**: Settings → Secrets and variables → Actions → New repository secret
   - Name: `YAHOO_CLIENT_ID`
   - Secret: Yahoo!デベロッパーネットワークでアプリ登録すると発行される Client ID
5. **PATを用意**（Fine-grained token の場合）: 対象リポジトリ `imagegallery-yahoo` に
   - Contents: **Read and write**（データ・画像の保存）
   - Actions: **Read and write**（「Yahooから同期」でワークフローを起動）
6. **ツールを開いて設定**: ⚙️設定 → PAT / オーナー / リポジトリ `imagegallery-yahoo` を入力 → 「＋ショップを追加」で
   ショップ名と **YahooストアID**（ストアURL `store.shopping.yahoo.co.jp/○○/` の ○○）を入れる。
7. **商品を取り込む**: 「＋ 商品追加」→ 次のどれか
   - **Yahooから同期（自動取得）** … Actionsが商品検索APIで一覧を取得 → 確認画面 → 「取り込む」（1,000件で1〜2分）
   - **商品CSVから取り込み** … ストアクリエイターProの商品データCSV（`data.csv`、Shift_JISのままでOK）。非公開商品も入ります
   - **取得済みの一覧を取り込む** … GitHubのActions画面から手動実行した後など

2人目以降は、⚙️設定ではなく「🔗共有」の共有コードを読み込むと、同じショップIDで同じデータを見られます。

## 商品取り込みの仕組み

```
[ツール] ＋商品追加 → Yahooから同期
   │  workflow_dispatch（PATで起動）
   ▼
[GitHub Actions] yahoo-fetch.mjs → Yahoo商品検索API (V3 itemSearch)
   │  data/{shopId}/yahoo-products.json をコミット（gallery.json には触れない）
   ▼
[ツール] 完了を待って yahoo-products.json を読む → 確認画面 → 「取り込む」で gallery.json にマージして保存
```

- Yahoo商品検索APIはCORSヘッダを返さないため、ブラウザからは直接呼べません。APIはActionsが呼びます。
- Client IDは GitHub Secrets にだけ置き、ブラウザには保存しません。
- マージは追加と「商品名・価格・URL・サムネURL」の更新だけ。**画像・タグ・商品番号・ステータスには触れず、一覧に無い商品も削除しません。**
- 商品コードは大文字小文字を区別せずに照合します（YahooのURLは小文字のため）。

### 引き継ぎ資料からの変更点

- **Actionsは gallery.json を直接書きません。** 資料の方式Aは「Actionsが gallery.json にマージしてコミット」でしたが、
  ツールで画像を編集中の人の保存（409 → SHA取り直し → 手元の内容で上書き）とぶつかると、Actionsが足した商品が消えます。
  そこでActionsは `yahoo-products.json` を書くだけにし、マージはブラウザ側の1か所（CSV取り込みと共通）で行います。
- **APIの `code` は「ストアID_商品コード」形式**でした（公式ドキュメント確認済み）。スクリプトで接頭辞を外しています。
- **1,000件の上限**は、価格帯で検索を分割して回避しています。同じ価格の商品が1,000件以上ある場合だけ取りきれず、警告が出ます。
- **localStorage のキーを `imagegallery_yahoo_` に変更**しました。楽天版と同じドメイン（kaiyoshida0318.github.io）で動くため、
  同じキーだと楽天版の設定（リポジトリ名・ショップ一覧）を読んでしまい、保存すると楽天版の設定を上書きします。
  Service Worker のキャッシュ名も `imagegallery-yahoo-` で始め、削除は自分のキャッシュだけに限定しています。

## 定期実行（任意）

`yahoo-sync.yml` の `schedule:` の2行のコメントを外すと、毎日午前3時（JST）に、一度でも同期したショップの一覧を取り直します。
取り込みはツールの「取得済みの一覧を取り込む」で行ってください（自動では gallery.json に入りません）。

## うまくいかないとき

「🔄 GitHub同期」→ 診断ログの「📋 コピー（AIに貼る用）」を押して、そのまま貼ってください。
PAT・Client ID（`appid=`）は自動で伏せ字になります。Actionsが失敗した場合は、失敗した手順とエラー文がトーストと診断ログに出ます。

| 表示 | 対処 |
|---|---|
| ワークフロー「yahoo-sync.yml」が見つかりません | `.github/workflows/yahoo-sync.yml` がアップロードされているか確認 |
| PATにGitHub Actionsを実行する権限がありません | PATに Actions: Read and write を追加 |
| Client IDが未登録です | Secrets に `YAHOO_CLIENT_ID` を登録 |
| Yahoo APIが認証を拒否しました | Client ID の値を確認 |
| 商品が0件でした | ストアIDを確認（ストアURLの `store.shopping.yahoo.co.jp/○○/` の部分） |

## 開発ルール（楽天版から継続）

- 変更は原則 `app.js` の1ファイルのみ。新しいUIやCSSは `init()` から注入する。変更のたびに `APP_VERSION` を上げる。
- `gallery.json` のキーを増やすときは `_buildShopDataFromJson()` と `_saveShopDataOnce()` の両方を直す。
- localStorage / sessionStorage のキーは必ず `imagegallery_yahoo_` で始める。
- テストはモックサーバーで `/sw.js` を404にする（真っ黒スクショの誤検知防止）。
