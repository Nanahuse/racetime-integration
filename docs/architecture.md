# アーキテクチャ

このページは実装者向けに、現在の構成と設計上の制約を説明します。

## 全体構成

Extension（`src/extension/index.ts`）が、外部との接続を持つ各サービスを組み立てます。

- `HttpRaceTimeClient`: RaceTimeのHTTP取得
- `RaceService`: レース監視セッションの管理
- `ParticipantResolver`: Player Manager v3による参加者の解決
- `MappingService`: Game MappingとCategory Mappingの管理
- `GoogleSheetsClient`: Spreadsheetへのアクセス
- `HttpSpeedrunClient`: Speedrun.com APIの呼び出し
- `SpeedrunRecordService`: LeaderboardとPBの取得、キャッシュ

公開Protocol（`packages/racetime-protocol`）が、型・定数・メッセージ名・日時処理を提供します。Extensionの外からはNodeCGメッセージ、`racetime-integration`拡張の`RaceTimeAPI.request()`、Replicantを通じて操作します。

## RaceTime連携

- 初回取得と再接続ではHTTPでスナップショットを取得します。接続後はWebSocketの`race.data`を検証して直接採用します。HTTPキャッシュは状態更新の判定に使いません。
- 古い接続世代、低いRaceTime version、解除後の応答は公開しません。
- HTTPとWebSocketハンドシェイクのタイムアウトは各10秒です。
- 初回成功後の切断は1/2/5/10/30秒のバックオフで再接続し、WebSocket接続に成功するとバックオフの試行回数をリセットします。
- 取得したRaceTime DTOは`mapRace`で正規化します。日時と期間は内部でTemporal値として保持し、公開時にISO 8601文字列へ戻します。公開モデルにTemporalインスタンスは含みません。

`watchRace`の成功条件は初回HTTP取得の成功です。WebSocket接続の完了とPlayer解決の完了は、それぞれ別の状態として公開します。初回HTTPに失敗した場合は参照も再試行も残しません。

## 監視セッション

同じURLの監視は1つのセッションとして共有します。各`watchRace`は独立した`watchId`を返し、最後の`watchId`を解除するとセッションと参加者解決の待機を停止します。

`forceUnwatchRace`は、指定したURLの監視セッションを同期的に破棄します。同じレースに紐づくすべての`watchId`（ほかのバンドルが保持するものも含む）を無効化し、監視・再接続タイマー・実行中のPlayer解決を停止します。RaceTimeのレース自体は変更しません。

接続状態と解決状態は`RaceState`として公開します。`revision`は状態公開のたびに、`raceRevision`はレーススナップショットが変化したときに、`participantsRevision`は参加者解決の結果を採用したときに増加します。

## Player解決

- Player Manager v3の公開`list`でDirectoryを1スナップショット取得し、Playerに属するRaceTimeアカウント（Primary/Secondaryを問わない）をRaceTime IDで照合します。
- `player-manager.v3.directoryChanged`を受けると、監視中のレースを再解決します。前の世代は破棄し、解決の期限は15秒です。
- 同一のRaceTime IDが複数のPlayerに属する場合は、任意に選ばず解決失敗（unavailable）として扱います。
- 紐付けのない参加者はunresolved、障害時はunavailableです。
- 独自のPlayer作成や、Twitch名による推測は行いません。

## マッピングとSpreadsheet

- `MappingService`がGame MappingとCategory Mappingを扱い、Revisionを独立して管理します。
- リポジトリは`GoogleSheetsClient`を通じてワークシートを読み書きします。列はヘッダー名で照合します。
- `initializeSpreadsheet`は、不足シートの作成、空シートへのヘッダー設定、正常な既存シートの維持を行います。不正な既存データがある場合は、変更を始める前にエラーを返します。
- Sheets操作と設定変更はプロセス内で直列化します。外部アプリや別プロセスとの排他は提供しません。書き込みは自動リトライせず、応答が不明な場合は再読込みで成功有無を確認します。
- 削除は既知列の値を消去し、追加列や数式は残します。

## Speedrun.com

- `searchSpeedrunGames` / `getSpeedrunGameOptions` / `getSpeedrunCategoryVariables`は、手動選択用のゲーム・カテゴリ・Level・Variablesなどを取得します。SRC v1 APIは認証不要です。
- LeaderboardとPBは、解決済みの各条件で取得します。条件別キャッシュのTTLは5分で、同時要求は共有し、HTTPの並行数は4に制限します。
- 再取得に失敗して直前の正常値がある場合は`stale: true`を付けて返します。通信失敗は正常値としてキャッシュしません。
- レースの通常更新はSRC取得を開始しません。マッピングの保存・削除後にLeaderboardと参加者PBを再解決します。

## 公開インターフェース

- Replicant: 非永続の`racetime-races`（`RacesState`）と、永続の`racetime-settings`（`SettingsState`）を公開します。参照専用として扱い、変更にはAPIを使用してください。
- メッセージ: `racetime.v4.*`の名前で操作とイベントを送受信します。イベントの購読先は送信元の名前空間`racetime-integration`です。
- イベント: `race-events.ts`が、採用前後のRaceと開始済み判定からイベントを検出します。初回スナップショットは比較基準のみを確立します。レース状態を公開した後に通知し、送信の完了は待ちません。

## 非同期処理と競合

- Player解決の結果が採用済みのレース版とDirectory版より古い場合は公開しません。pending中の参加者情報は前回値の場合があります。
- 設定更新時は新しい接続許可先を直ちに適用し、許可外となった監視セッションを停止します。Spreadsheetに関する設定が変わらない更新では、Sheetsの再検証やリポジトリの作り直しを行いません。
- Dashboardの編集はGameとCategoryで独立したセッションとして保持し、保存時の`expectedRevision`はセッション基準を使います。保存・削除・再読込の実行中はフォーム入力を禁止します。

## Settingsの復旧

保存済みの`racetime-settings`が不正な場合は、Extensionはマウントを失敗させず、既定設定（`revision: 0`、`spreadsheetId: null`、`gameMappingsSheet: "GameMappings"`、`categoryMappingsSheet: "CategoryMappings"`、`maxResolvedMappings: 20`、`leaderboardTop: 20`、`allowedRaceOrigins: ["https://racetime.gg"]`）へ初期化して永続化し、警告を記録して起動を続けます。

`maxResolvedMappings`、`leaderboardTop`、`allowedRaceOrigins`を持たない既存設定は、他の項目とrevisionを変更せずに初期値を補完して読み込みます。項目は存在するが値が不正な場合は、通常の設定検証で拒否します。この復旧はSpreadsheetの内容を変更しません。

## 既知の制約

- Level固有Variable: SRCのVariableはスコープを持ちますが、現行実装はスコープと選択中Levelを照合しません。per-levelカテゴリでLevel固有Variableを扱う場合、解決結果が選択中のLevelに対応しないことがあります。
- 表示レイアウトへの適用、配信への出力、レース履歴、RaceTimeチャットの送信は含みません。
