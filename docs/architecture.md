# アーキテクチャ

このページは実装者向けに、データがどのように取得・処理・公開されるかと、設計上の責務を説明します。コードの名称は関連箇所を調べるための参照として最後にまとめます。

## データの流れ

racetime-integrationは、RaceTimeから取り込んだレース情報をNodeCG内で共有し、任意でSpeedrun.comの記録を付加します。

1. 取得: レースの初回取得と再接続ではHTTPでスナップショットを取得し、接続後はWebSocketの`race.data`を検証して直接採用します。
2. 検証と正規化: 取得したデータを内部モデルへ変換し、日時・期間を検証します。古い世代や低いバージョンの応答は採用しません。
3. 保持: 同じURLの監視は1つのセッションとして共有し、その状態を`RacesState`としてReplicantへ公開します。
4. 参加者解決: Player ManagerのDirectoryを参照し、RaceTimeアカウントからプレイヤーを特定します。
5. 公開: Replicant、NodeCGメッセージ、`RaceTimeAPI`で状態を公開し、変化はイベントとして通知します。
6. 追加の記録取得: マッピングが登録されていれば、解決した条件ごとにSpeedrun.comのLeaderboardとPBを取得します。

## 取得（HTTPとWebSocket）

初回取得と再接続ではHTTPでスナップショットを取得し、接続後はWebSocketの`race.data`を検証して直接採用します。HTTPキャッシュは状態更新の判定には使いません。古い接続世代、低いRaceTime version、解除後の応答は公開しません。HTTPとWebSocketハンドシェイクのタイムアウトは各10秒で、初回成功後の切断は1/2/5/10/30秒のバックオフで再接続し、WebSocket接続に成功するとバックオフの試行回数をリセットします。取得したRaceTimeのDTOは正規化し、日時と期間は内部でTemporal値として保持して、公開時にISO 8601文字列へ戻します。公開モデルにTemporalインスタンスは含みません。

`watchRace`の成功条件は初回HTTP取得の成功です。WebSocket接続の完了とPlayer解決の完了は、それぞれ別の状態として公開します。初回HTTPに失敗した場合は参照も再試行も残しません。

## 監視セッションの共有

同じURLの監視は1つのセッションとして共有します。各`watchRace`は独立した`watchId`を返し、最後の`watchId`を解除するとセッションと参加者解決の待機を停止します。これにより、複数の利用者や複数のバンドルが同じレースを監視しても、HTTPとWebSocketの接続は1つにまとまります。

`forceUnwatchRace`は、指定したURLの監視セッションを同期的に破棄します。同じレースに紐づくすべての`watchId`（ほかのバンドルが保持するものも含む）を無効化し、監視・再接続タイマー・実行中のPlayer解決を停止します。RaceTimeのレース自体は変更しません。

接続状態と解決状態は`RaceState`として公開します。`revision`は状態公開のたびに、`raceRevision`はレーススナップショットが変化したときに、`participantsRevision`は参加者解決の結果を採用したときに増加します。

## スナップショットとイベント

状態はReplicantの現在のスナップショットとして公開し、変化はイベントとして通知します。イベントは採用前後のスナップショットと開始済み判定から、監視セッション単位で検出します。初回スナップショットは比較基準のみを確立し、通知しません。

イベントの種類と発火条件は[公開API](../packages/racetime-protocol/README.md#レース状態変化イベント)を参照してください。レース状態を公開した後に通知し、送信の完了は待ちません。イベント履歴は保持せず、観測できなかった変化は再現できません。

## 永続化するデータとしないデータ

- `racetime-races`（非永続）: 監視中のレースの現在状態。NodeCGの再起動で失われ、再購読が必要です。
- `racetime-settings`（永続）: Spreadsheetの接続先、シート名、接続許可先、各種上限などの設定。

レースの履歴やイベントログは永続化しません。

## 参加者解決

Player Manager v3の公開`list`でDirectoryを1スナップショット取得し、Playerに属するRaceTimeアカウント（Primary/Secondaryを問わない）をRaceTime IDで照合します。`player-manager.v3.directoryChanged`を受けると監視中のレースを再解決し、前の世代は破棄します。解決の期限は15秒です。同一のRaceTime IDが複数のPlayerに属する場合は任意に選ばず解決失敗（unavailable）として扱い、紐付けのない参加者はunresolved、障害時はunavailableです。独自のPlayer作成やTwitch名による推測は行いません。

## マッピングとSpeedrun.com

Game MappingとCategory MappingはRevisionを独立して管理し、Spreadsheetの2つのワークシートへ保存します。列はヘッダー名で照合します。`initializeSpreadsheet`は、不足シートの作成、空シートへのヘッダー設定、正常な既存シートの維持を行い、不正な既存データがある場合は変更を始める前にエラーを返します。

Speedrun.comのLeaderboardとPBは、マッピングから解決した条件ごとに取得します。条件別キャッシュのTTLは5分で、同時要求は共有し、HTTPの並行数は4に制限します。再取得に失敗して直前の正常値がある場合は`stale: true`を付けて返し、通信失敗は正常値としてキャッシュしません。レースの通常更新はSpeedrun.comの取得を開始せず、マッピングの保存・削除後にLeaderboardと参加者PBを再解決します。

## 非同期処理と競合

- Player解決の結果が採用済みのレース版とDirectory版より古い場合は公開しません。pending中の参加者情報は前回値の場合があります。
- Sheets操作と設定変更はプロセス内で直列化します。外部アプリや別プロセスとの排他は提供しません。書き込みは自動リトライせず、応答が不明な場合は再読込みで成功有無を確認します。
- 設定更新時は新しい接続許可先を直ちに適用し、許可外となった監視セッションを停止します。Spreadsheetに関する設定が変わらない更新では、Sheetsの再検証やリポジトリの作り直しを行いません。
- Dashboardの編集はGameとCategoryで独立したセッションとして保持し、保存時の`expectedRevision`はセッション基準を使います。保存・削除・再読込の実行中はフォーム入力を禁止します。

## Settingsの復旧

保存済みの`racetime-settings`が設定検証に失敗した場合は、次のように扱います。

- 保存済みの`allowedRaceOrigins`が存在し、その値が不正なときは復旧せず、起動エラーになります。
- それ以外の検証エラー（`invalid_input`）では、既定設定へ初期化して永続化し、警告を記録して起動を続けます。
- 検証エラー以外の例外はそのまま送出し、マウントは失敗します。

復旧に使う既定設定は`cfg/racetime-integration.json`を反映します。`spreadsheetId`は`cfg`の値、または未指定なら`null`、`gameMappingsSheet`と`categoryMappingsSheet`は`cfg`の値、または`GameMappings`と`CategoryMappings`です。`allowedRaceOrigins`は`["https://racetime.gg"]`、`maxResolvedMappings`と`leaderboardTop`は20、`revision`は0です。このため、復旧後の`spreadsheetId`が必ず`null`になるとは限りません。

保存済み設定が有効でも、`maxResolvedMappings`、`leaderboardTop`、`allowedRaceOrigins`のいずれかが欠落している場合は、他の値とrevisionを保ったまま既定値で補完します。

この復旧はSpreadsheetの内容を変更しません。

## コードの参照

Extension（`src/extension/index.ts`）が各サービスを組み立てます。

| 責務 | 主な実装 |
| --- | --- |
| RaceTimeのHTTP取得 | `src/integrations/racetime/client.ts` |
| WebSocket監視と再接続 | `src/integrations/racetime/watcher.ts` |
| 監視セッションの管理 | `src/service.ts` |
| イベントの検出 | `src/race-events.ts` |
| 参加者の解決 | `src/integrations/players.ts` |
| マッピングの管理 | `src/mappings.ts`、`src/integrations/spreadsheet/` |
| マッピングの解決と`Any`展開 | `src/resolve.ts` |
| Speedrun.comの取得 | `src/integrations/speedrun/client.ts` |
| LeaderboardとPBのキャッシュ | `src/speedrun-records.ts` |
| 公開API | `src/api.ts` |
| 公開型・定数・メッセージ名 | `packages/racetime-protocol/src/` |
| Dashboard | `ui/dashboard/` |

## 既知の制約

- Level固有Variable: SRCのVariableはスコープを持ちますが、現行実装はスコープと選択中Levelを照合しません。per-levelカテゴリでLevel固有Variableを扱う場合、解決結果が選択中のLevelに対応しないことがあります。
- 表示レイアウトへの適用、配信への出力、レース履歴、RaceTimeチャットの送信は含みません。
