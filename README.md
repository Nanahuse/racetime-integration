# racetime-integration

NodeCG向けのRaceTime連携バンドルです。RaceTime.ggのレース情報の取得・監視・共有を中心に、Player Managerによる参加者の解決、Google Sheetsによるマッピング管理、Speedrun.comのLeaderboard・PBの取得を担当します。同じレースの監視は複数の利用者で共有できます。

## できること

- DashboardでRaceTimeのレースを監視し、開始予定・進行状況・タイマー・イベントを確認できます。
- 未登録の参加者をPlayer Managerのプレイヤーに紐付けて、レースの参加者を確認できます。
- ほかのNodeCGバンドルが公開API・Replicant・イベントを通じて同じレース情報を利用できます。
- RaceTimeとSpeedrun.comの対応付け（マッピング）を登録し、条件別Leaderboardと参加者の自己ベスト（PB）を取得できます。

## システム内での位置付け

| 層 | 役割 |
| --- | --- |
| RaceTime.gg | レース・参加者・進行状況・結果の提供元 |
| racetime-integration | レース情報の取得・監視・共有、参加者の解決、マッピング管理、Speedrun.com記録の取得 |
| Dashboard | 監視・確認・設定を行う画面 |
| 外部NodeCGバンドル | 公開API・Replicant・イベントを利用する利用者 |

## 依存と任意機能

- Player Manager 3.xは必須のバンドル依存です。RaceTimeの参加者をプレイヤーへ解決するために使います。
- Google Sheetsによるマッピング管理は任意機能です。
- Speedrun.comのLeaderboardとPBの取得は任意機能です。取得するには、先にマッピングを登録する必要があります。
- Google Sheetsを設定しなくても、RaceTimeの監視とPlayer Managerによる参加者解決は利用できます。

## 役割の範囲

このバンドルは、配信レイアウトの生成や、RaceTime上でのレース進行の操作は行いません。これらはほかのバンドルやRaceTime側で行ってください。

## 動作要件

- NodeCG 2.8
- Node.js 24
- pnpm 12.9.1
- Player Manager 3.x（同じNodeCGに配置）

## 導入

NodeCGの`bundles/racetime-integration`に配置し、依存関係のインストールとビルドを行います。同じNodeCGにPlayer Managerを配置してください。

手順は[導入と初期設定](docs/getting-started.md)を参照してください。Speedrun.com連携は任意で、必要な場合だけ追加の設定を行います。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [導入と初期設定](docs/getting-started.md) | 配置、ビルド、起動、Google SheetsとRaceTime接続先の準備 |
| [Dashboardの使い方](docs/dashboard.md) | 監視、確認、参加者の紐付け、マッピング、設定の操作 |
| [マッピング](docs/mappings.md) | RaceTimeとSpeedrun.comの対応付けと記録の取得 |
| [公開API](packages/racetime-protocol/README.md) | ほかのバンドルから利用するための操作と契約 |
| [開発](docs/development.md) | 開発環境、コマンド、テスト、CI |
| [アーキテクチャ](docs/architecture.md) | データの流れと設計上の責務 |

## ライセンス

Apache-2.0
