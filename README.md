# racetime-integration

NodeCG向けのRaceTime連携バンドルです。RaceTimeのレース情報をNodeCGで取得して共有し、ほかのバンドルから利用できるようにします。同じレースの監視は複数の利用者で共有でき、参加者はPlayer Manager v3で解決します。Google Sheetsによるカテゴリ対応の管理と、Speedrun.comの条件別Leaderboard・参加者の自己ベスト（PB）の取得は任意の追加機能です。

## 主な機能

- 共有監視: RaceTimeのURLを登録すると、初回はHTTPで取得し、以降はWebSocketで状態を更新します。同じURLの監視は利用者間で共有されます。
- 公開API: NodeCGメッセージ、`racetime-integration`拡張の`RaceTimeAPI`、Replicantを通じて、ほかのバンドルがレース情報を利用できます。
- レース状態変化イベント: 開始予定の設定・変更、開始、完走、完走取り消し、中止をNodeCGメッセージで通知します。
- 参加者の解決: Player Manager v3のDirectoryを参照し、RaceTimeアカウントからプレイヤーを特定します。
- Google Sheetsマッピング（任意）: RaceTimeのカテゴリとGoalを、Speedrun.comのゲームとカテゴリに対応付けます。
- Speedrun.com連携（任意）: 条件別Leaderboardと、参加者の公式PBを取得します。
- Dashboard: Overview / Mappings / Settingsの3画面です。監視の追加、レース詳細とタイマー、イベントログ、マッピングの編集、各種設定を行います。

## 動作要件

- NodeCG 2.8
- Node.js 24
- pnpm 12.9.1
- Player Manager 3.0.0以上（同じNodeCGに配置）

## 導入

NodeCGの`bundles/racetime-integration`に配置し、依存関係のインストールとビルドを行います。同じNodeCGにPlayer Managerを配置してください。

手順の詳細は[導入と初期設定](docs/getting-started.md)を参照してください。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [導入と初期設定](docs/getting-started.md) | 配置、ビルド、初期設定、Google SheetsとRaceTime接続先の準備 |
| [Dashboardの使い方](docs/dashboard.md) | Overview / Mappings / Settingsの操作 |
| [マッピング](docs/mappings.md) | RaceTimeとSpeedrun.comの対応付け、シート構成、`Any` |
| [公開API](packages/racetime-protocol/README.md) | ほかのバンドル向けの操作、契約、イベント |
| [開発](docs/development.md) | 開発環境、コマンド、CI、バージョン管理 |
| [アーキテクチャ](docs/architecture.md) | 現在の設計と技術的な制約 |

## ライセンス

Apache-2.0
