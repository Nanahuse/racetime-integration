# 開発

開発環境の構築、ソース構成、コマンド、テスト、CIについて説明します。

## 環境

- Node.js 24（`.nvmrc`は`24`）
- pnpm 12.9.1（`packageManager`で固定）

Player ManagerのProtocolはGit依存として取得します。取得先は`@nanahuse/player-manager`のタグ`v3.0.0`に固定しています。異なる版へ自動で切り替えず、固定した依存のビルドだけを許可します（`pnpm-workspace.yaml`の`pmOnFail: error`と`allowBuilds`）。

## コマンド

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

| コマンド | 内容 |
| --- | --- |
| `pnpm install --frozen-lockfile` | lockfileどおりに依存をインストール |
| `pnpm typecheck` | Protocolのビルド後、ExtensionとDashboardを型チェック |
| `pnpm lint` | Biomeでチェック |
| `pnpm format` | Biomeで整形 |
| `pnpm test` | ProtocolとExtensionをビルドし、テストを実行 |
| `pnpm build` | Extension（CommonJS）とDashboardをビルド |
| `pnpm dev` | ビルド後、Extensionの変更を監視して再ビルド |
| `pnpm start` | `nodecg start` |

`pnpm dev`はExtensionを再ビルドしますが、NodeCGの再起動は行いません。反映にはNodeCGの再起動が必要です。Dashboardの出力は`dashboard/`、Extensionの出力は`extension/index.js`です。

## ソース構成

| 場所 | 内容 |
| --- | --- |
| `src/extension/index.ts` | 各サービスを組み立て、NodeCGのIPCを配線する |
| `src/api.ts` | 公開操作の入口とリクエストの検証 |
| `src/service.ts` | 監視セッションと`RacesState`の管理 |
| `src/race-events.ts` | レース状態変化イベントの検出 |
| `src/mappings.ts`、`src/resolve.ts` | マッピングの管理と`Any`の展開 |
| `src/speedrun-records.ts` | LeaderboardとPBの取得・キャッシュ |
| `src/integrations/` | RaceTime・Player Manager・Spreadsheet・Speedrun.comとの接続 |
| `packages/racetime-protocol/` | 公開型・定数・メッセージ名 |
| `ui/dashboard/` | Dashboard（Vite + React + TypeScript） |
| `test/` | 境界と表示のテスト |

## テスト

`pnpm test`は`pnpm build:extension`を実行してから`vitest run --dir test`を実行します。テストファイルは`test/`にあります。変更した場所に応じて、次のテストを確認してください。

| 変更対象 | 主なテスト |
| --- | --- |
| RaceTimeの取得・監視・Player解決 | `test/racetime.test.ts`、`test/service.test.ts` |
| レース状態変化イベント | `test/race-events.test.ts`、`test/nodecg-race-events.test.ts` |
| 日時・期間の解析 | `test/datetime.test.ts`、`test/duration.test.ts` |
| マッピングとSpreadsheet | `test/mappings.test.ts`、`test/sheets.test.ts` |
| Speedrun.comのLeaderboardとPB | `test/speedrun.test.ts`、`test/speedrun-records.test.ts` |
| 公開APIとメッセージ | `test/nodecg.test.ts`、`test/racetime.test.ts` |
| Dashboard | `test/dashboard-*.test.tsx` |

テストはHTTPやWebSocketの境界、Player Managerの解決、マッピング、Speedrun.com、日時・期間、Dashboardの表示と操作を対象にします。

## CI

`Check`ワークフローはPull Requestと`main`へのpushで実行します。Node.js 24とpnpm 12.9.1を使い、次の順に検証します。

1. `pnpm install --frozen-lockfile`
2. バージョン検証（`node .github/scripts/check-version.mjs`）
3. バージョン検証スクリプトのテスト
4. `pnpm typecheck`
5. `pnpm lint`
6. `pnpm test`
7. `pnpm build`

## バージョン管理

ルートの`package.json`と`packages/racetime-protocol/package.json`は、同じ`MAJOR.MINOR.PATCH`に揃えて更新します。この一致はCIで検証します。

公開APIの`API_VERSION`はパッケージ版とは別に管理します。現在は`API_VERSION=4`、メッセージ名は`racetime.v4.*`、`RacesState.schemaVersion=1`です。

`main`へのpushで`Check`が成功すると、`Tag`ワークフローがそのコミットのバージョンで注釈付きタグ`vX.Y.Z`を作成します。次の場合はタグを作成しません。

- 同じタグがすでに存在する。
- タグ作成の間に`main`が先へ進んだ。
- 新しいバージョンが最新のリリースタグ以下である。

## Protocolの配布

公開Protocolは独立したパッケージとして扱います。パッケージの内容と、レジストリへの公開手順は[Protocol README](../packages/racetime-protocol/README.md)を参照してください。
