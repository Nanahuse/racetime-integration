# v1実装の範囲と照合事項

調査基点: `origin/main` の `4db1cdf`（Initial commit）。

参照チャット「RaceTime連携分離提案」の取得結果では、仕様本文は参照記号だけでした。以下は今回の依頼本文と既存バンドルから構成した実装です。過去に合意されたAPI名・詳細なv1スコープとの照合は、仕様本文の入手後に行う必要があります。

## 責務

- RaceTime: raceページURLの正規化、HTTP取得、通知を契機に再取得するWebSocket監視、失敗時の再接続。
- RaceService: 正規化URLごとに監視を共有、watchId単位で参照を管理、参加者解決結果の世代管理。
- Player Managerアダプター: `@nanahuse/player-manager-protocol` v1.0.1の `resolve` だけを使用。レースの参加者から独自にPlayerを作成・更新しない。
- CategoryMappings: 既存14列のエンコードを維持。ADCでGoogle Sheetsを読み書きする。
- 公開プロトコル: 型・定数・メッセージ名を独立パッケージに配置。
- NodeCG: 非永続Replicant、v1メッセージ、extension公開APIを接続。serverStoppingで接続と再試行を終了。

表示レイアウト、配信への適用、参加者編集UI、Player登録UI、Speedrun.comの検索・PB取得、レース履歴、RaceTimeチャット送信は含めません。

## 失敗と競合

- HTTPは10秒でタイムアウト。転送は拒否し、racetime.gg以外への取得を防止。
- WebSocket接続は10秒でタイムアウト。1/2/5/10/30秒の上限付きバックオフで再接続。
- HTTPによる再同期が成功するまでバックオフをリセットしない。
- 再取得中の通知は集約し、進行中取得後に1回再取得。接続開始時にも再取得して購読開始の隙間を補う。
- 切断前の応答・停止後の応答・古いversion・入れ替え前の参加者解決結果は現状態に適用しない。
- Sheets書込みはこのプロセス内で直列化。プロセス間ロックや人による同時編集の排他は提供しない。複数writerによる同じ表への同時編集は避ける。
- Google書込みの自動リトライは無効。応答を失った場合には保存が成功している可能性があるため、再読込みで確認する。
- 未知列は更新しない。欠落列・重複ヘッダー・重複キー・不正JSON等がある表は保存前に拒否。

## 検証範囲

テストはHTTP、WebSocket、Player Managerの公開境界、Sheetsクライアント、NodeCGのメッセージ応答とビルド成果物を対象にする。外部サービスのアカウントや実データには書き込まない。

実ADCによる対象Spreadsheetの読書き、実Player Managerを含むNodeCG運用環境での監視、npmレジストリへの公開は未実施。既存nodecg-race-layouts/player-managerの移行は今回の対象外。

実行結果: Node 24.19.0 / pnpm 11.19.0で型検査、lint、ビルド、34件の境界テスト、protocol packが成功。公開レース1件（12参加者）に対するビルド済みAPIのHTTP取得、実WebSocket接続、最後のwatchId解除も成功。RaceTimeへの書込みは行っていない。

## 参照実装

- [RaceTime公式 Race model](https://github.com/racetimeGG/racetime-app/blob/master/racetime/models/race.py)
- [RaceTime公式API仕様](https://github.com/racetimeGG/racetime-app/wiki/Public-API-endpoints)
- [Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
- Nanahuse/nodecg-race-layouts の RaceTime HTTPパーサとCategoryMappingsの形式
- Nanahuse/player-manager の公開プロトコル v1.0.1
