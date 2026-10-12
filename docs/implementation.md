# v1実装と検証

調査基点はracetime-integration mainの4db1cdf。PR #1のレビューを反映し、現行Player Manager 2.2.1 / API v2（85ef6e5f78503f443b61627fc08c4a9675850cb0）に接続する。

## 責務と公開契約

- RaceTime: HTTP取得、WebSocket通知での再取得、再接続、レースIDと結果の正規化。
- RaceService: URLごとの共有監視、初回成功後の購読成立、失敗時の解放、Player解決とRevision管理。
- Player Manager: v2 findへRaceTime IDで問い合わせる。レース参加者から独自にPlayerを作成・更新しない。公開resolveDisplayNameでSnapshotの表示名を確定し、directoryChangedで再解決する。
- CategoryMappings: 既存14列、ADC、一覧・検索・新規・更新・削除。保存した版のrevisionと設定revisionで意図しない上書きを拒否。
- 設定: 取得と更新、新接続先の事前検証、NodeCG Replicantへの永続化。
- Protocol: 上記契約の型・定数・メッセージ名。ESM/CommonJSを提供。

watchRaceの成功条件は初回HTTP取得成功。WebSocket接続完了やPlayer解決完了は別の状態として公開する。接続不良を受けても既存Activeの判断に使えるRaceを返す。初回HTTP失敗時には参照も再試行も残さない。

表示レイアウト、配信への適用、Player登録UI、Speedrun.com検索・PB取得、レース履歴、RaceTimeチャット送信は含めない。nodecg-race-layouts/player-managerの変更は行わない。

## 非同期処理と競合

- HTTPとWebSocketハンドシェイクは各10秒でタイムアウト。
- 初回成功後の切断は1/2/5/10/30秒のバックオフで復帰。HTTP再同期成功までバックオフをリセットしない。
- race.dataをHTTP再取得の通知として扱い、進行中取得中の通知を集約。接続開始時にも再取得して購読の隙間を補う。
- 古い接続世代・低いRaceTime version・解除後の応答は公開しない。
- Player解決中のdirectoryChangedを集約し、前の世代を破棄。findの前後でDirectory revisionを比較し、変化したらバッチ全体を再実行。15秒の期限、最大3回の整合性再試行。
- Sheets操作と設定変更をプロセス内で直列化。外部編集・複数プロセスに対する分散ロックは提供しない。
- Sheets書込みは自動リトライなし。応答不明時には再読込みで成功有無を確認。
- 削除は14列の値を消去する。追加列や数式は残し、既知列が空の行は一覧から除外。

## Player Managerのサブアカウント

確認した2.2.1のPlayer型とidentityKeys/find実装は、単一racetimeアカウントを検索対象にする。サブアカウントの配列や検索契約はまだないため、現時点でサブアカウント対応を保証しない。将来の変更はPlayer Manager側の公開findの契約とプロトコル更新に合わせて対応し、RaceTime側に独自検索を追加しない。

## 検証

境界テストはHTTP・WebSocket、初回購読失敗、複数利用者、v2 findとdirectoryChanged、結果正規化、マッピング競合・削除・設定切替、NodeCGメッセージ応答、ビルド済みCommonJS拡張、ProtocolのESM/CommonJSを対象にする。

前回実装では公開レース1件でHTTP取得・実WebSocket接続・解除を確認済み。今回の変更はモックによる外部境界とCIで検証する。

未実施: 実ADCによる対象Spreadsheetの読書き、実Player Managerを含む運用NodeCGでの通し確認、npmレジストリへのpublish。

## 参照

- [RaceTime公式 Race model](https://github.com/racetimeGG/racetime-app/blob/master/racetime/models/race.py)
- [RaceTime公式API仕様](https://github.com/racetimeGG/racetime-app/wiki/Public-API-endpoints)
- [ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
- [Player Manager公開Protocol](https://github.com/Nanahuse/player-manager/tree/85ef6e5f78503f443b61627fc08c4a9675850cb0/packages/player-manager-protocol)
