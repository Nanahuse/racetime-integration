# v2実装と検証

調査基点はracetime-integration mainの4db1cdf。PR #1のレビューを反映し、現行Player Manager 2.2.1 / API v2（85ef6e5f78503f443b61627fc08c4a9675850cb0）に接続する。v2ではマッピングモデルを分割し、Dashboardを追加した。

## 責務と公開契約

- RaceTime: HTTP取得、WebSocket通知での再取得、再接続、レースIDと結果の正規化。
- RaceService: URLごとの共有監視、初回成功後の購読成立、失敗時の解放、Player解決とRevision管理。
- Player Manager: v2 findへRaceTime IDで問い合わせる。レース参加者から独自にPlayerを作成・更新しない。公開resolveDisplayNameでSnapshotの表示名を確定し、directoryChangedで再解決する。
- Game Mappings: RaceTimeゲーム（categorySlugが一意キー）とSRCゲームをGameMappingsシートで対応付ける。
- Category Mappings: RaceTime Goal（categorySlug + goalが一意キー）をSRCカテゴリへCategoryMappingsシートで対応付ける。親Game Mappingを必須とし、SRC Game ID/Nameを重複保存しない。
- 親子整合性: 親の無いCategory登録、子の有る親のSRCゲーム変更・削除、親のSRCゲームに属さないSRCカテゴリをサーバー側で拒否する。
- 統合参照: resolveCategoryMappingでGame MappingとCategory Mappingを結合し、未登録（unregistered）と不整合（inconsistent）を区別して返す。
- Speedrun.com: 手動選択用にゲーム・カテゴリ・Level・Variables・Platform・Region・Timing Methodを検索・取得する。PB/WR/Leaderboardは含めない。
- Protocol: 上記契約の型・定数・メッセージ名。ESM/CommonJSを提供。API_VERSIONは2、MESSAGE_PREFIXはracetime.v2。旧v1互換は提供しない。
- Dashboard: `RaceTime Integration` パネル（fullbleed）。Overview / Mappings / Settingsを公開Protocol経由で操作し、Replicantは参照専用とする。

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
- 削除は既知列の値を消去する。追加列や数式は残し、既知列が空の行は一覧から除外。
- Game MappingとCategory MappingのRevisionは独立して管理し、更新・削除は保存済みrevisionとの一致を要求する。

## Spreadsheet形式

- GameMappings: `racetime_category_slug, racetime_category_name, src_game_id, src_game_name, updated_at`。
- CategoryMappings: `racetime_category_slug, racetime_goal, src_category_id, src_category_name, src_level_id, src_variables, src_platform_id, src_region_id, src_emulator, src_timing_method, updated_at`。
- カラム順の並び替え、未知の追加カラム・数式の保持、必須項目と重複キーの検証、settingsRevisionによる接続先変更検出に対応する。
- 旧14列形式の移行・読込・互換処理は提供しない。新しい2シート構成のみを正規とする。

## Player Managerのサブアカウント

確認した2.2.1のPlayer型とidentityKeys/find実装は、単一racetimeアカウントを検索対象にする。サブアカウントの配列や検索契約はまだないため、現時点でサブアカウント対応を保証しない。将来の変更はPlayer Manager側の公開findの契約とプロトコル更新に合わせて対応し、RaceTime側に独自検索を追加しない。

## Dashboard

- `dashboardPanels` に `racetime-integration`（title `RaceTime Integration`、fullbleed）を定義し、Vite + React + TypeScriptでビルドする。出力は `dashboard/`（CIのbuildで生成）。
- Overview: `racetime-races` Replicantから監視中レース、接続状態、参加者解決状況を表示する。URLによる単発取得はfetchRaceを使用し、watchIdは生成しない。Player Managerの登録は公開APIのbeginRegistrationで得たURLへ遷移する。編集は不変のPlayer Directoryパネルへリンクする。
- Mappings: 左にGame Mapping一覧・検索、右に選択ゲームの詳細とCategory Mapping一覧を表示する。SRCは手動検索・選択のみで、自動マッピング・候補提案・類似度評価は行わない。保存はmapping_conflict時に編集内容を保持し再読込を促す。
- Settings: Spreadsheet URL/ID、両シート名、接続状態、Spreadsheetリンク、保存、エラー詳細を表示する。URLはIDへ正規化する。保存（updateSettings）で両シートを検証できた場合のみ「利用可能」と表示する。Google認証情報の入力UIは設けない。

## 検証

境界テストはHTTP・WebSocket、初回購読失敗、複数利用者、v2 findとdirectoryChanged、結果正規化、Game/Category MappingのCRUD、親子整合性、Revision競合、2シートの読込・保存・列順変更・追加カラム保持、設定切替の整合性、SRC検索・選択情報、Dashboardと公開APIの通信、Player Manager登録URL、ビルド済みCommonJS拡張、ProtocolのESM/CommonJSを対象にする。

前回実装では公開レース1件でHTTP取得・実WebSocket接続・解除を確認済み。今回の変更はモックによる外部境界とCIで検証する。

未実施: 実NodeCG 2.8環境でのDashboard起動と公開APIとの実通信、実ADCによる対象Spreadsheetの読書き、実Speedrun.com API・実Player Managerを含む運用NodeCGでの通し確認、npmレジストリへのpublish。

## 参照

- [RaceTime公式 Race model](https://github.com/racetimeGG/racetime-app/blob/master/racetime/models/race.py)
- [RaceTime公式API仕様](https://github.com/racetimeGG/racetime-app/wiki/Public-API-endpoints)
- [Speedrun.com公式API仕様](https://github.com/speedruncomorg/api)
- [ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
- [Player Manager公開Protocol](https://github.com/Nanahuse/player-manager/tree/85ef6e5f78503f443b61627fc08c4a9675850cb0/packages/player-manager-protocol)
