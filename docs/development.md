# 開発

開発環境の構築、コマンド、CI、バージョン管理について説明します。

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

## テスト

`pnpm test`は`pnpm build:extension`を実行してから`vitest run --dir test`を実行します。テストファイルは`test/`にあり、HTTP・WebSocketの境界、Player Managerの解決、マッピングとSpreadsheet、Speedrun.comのLeaderboardとPB、日時・期間の解析、Dashboardの表示と操作などを対象にします。

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
