# racetime-integration

NodeCG 2.8向けのRaceTime連携バンドル。複数の利用者でレース監視を共有し、Player Manager v3で参加者を解決、Google Sheetsでカテゴリ対応を管理します。Speedrun.comの条件別Leaderboardと参加者PBもExtension経由で取得できます。

## 開発

Node.js 24、pnpm 12.9.1を使用します。Player ManagerのGit依存も同じpnpmでprepareします。異なる版への自動切替はエラーにし、固定した依存コミットのprepareだけを許可しています。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm test` はプロトコルとNodeCG拡張をビルドして境界テストを実行します。`pnpm dev` は拡張の変更を監視してビルドします。NodeCGの再起動は別途行ってください。

## CIとバージョン管理

Player Managerと同じ構成で、PRとmainへのpush時に`Check`を実行します。Node.js 24 / pnpm 12.9.1とpnpmキャッシュを使い、固定lockfileでのインストール、バージョン検証、型チェック、lint、テスト、ビルドを行います。

ルートとProtocolのpackage.jsonは同じ`MAJOR.MINOR.PATCH`に揃えて更新してください。現在のバージョンは`0.7.0`です。パッケージ版と公開APIの`API_VERSION`は別に管理します。mainへのpushで`Check`が成功すると、`Tag`がそのコミットのバージョンで注釈付きタグ`vX.Y.Z`を作成します。既存タグやmainが先へ進んだ実行はスキップし、最新リリースタグ以下の新規バージョンは拒否します。

## NodeCGへの配置

NodeCGの `bundles/racetime-integration` に配置して `pnpm install --frozen-lockfile`、`pnpm build` を実行します。同じNodeCGに `player-manager` >=3.0.0 を配置してください。bundleDependenciesで読込み順を指定しています。

DashboardにはOverview / Mappings / Settingsがあります。OverviewではURLからレースの監視を追加し、監視一覧で選んだレースのRaceTime情報、イベントログ、Speedrun.com Mapping、参加者とPB、条件別Leaderboardを表示します。イベントログはレース詳細内にあり、Overview表示中に受信した全レースのイベントの最新100件を受信順に保持します。詳細から「監視を停止」を実行すると、確認のうえ共有中の監視セッション全体を停止します。Leaderboardと参加者PBは選択中の監視レースの情報に基づき、Leaderboardは順位・プレイヤー名・記録時間・日付を表示します。Mappingの保存・削除後はLeaderboardと参加者PBを再解決します。公開APIの `fetchRace` は引き続き単発取得を提供しますが、Dashboardに単発取得操作はありません。NodeCGの外部バンドルもDashboardと同じ `RaceTimeAPI.request()` を利用できます。

## Google Spreadsheet

初回起動時の設定はNodeCGルートの `cfg/racetime-integration.json` で指定できます。

```json
{
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "categoryMappingsSheet": "CategoryMappings"
}
```

起動後はgetSettings/updateSettingsで取得・変更できます。変更はracetime-settings Replicantへ永続化され、次回起動時は保存された設定が優先されます。新しい表へのアクセスと形式を検証できた場合だけ切り替えます。spreadsheetId:nullで無効化できます。Sheets未設定時もレース機能は利用可能です。

設定には `maxResolvedMappings`（Any展開の最大件数、初期値20）も含まれます。DashboardのSettings画面（表示名「Any展開の最大件数」）から1以上の整数で変更・保存できます。この値を持たない旧設定は、他の項目とrevisionを変更せずに20を補完して読み込みます。

`leaderboardTop`（初期値20）はLeaderboardの取得順位上限です。Settings画面の「リーダーボード取得順位数」から1以上の安全な整数で変更できます。SRCが同順位として返したRunはすべて表示します。旧設定ではrevisionを変えずに20を補完します。OverviewのLeaderboardと公開APIはExtensionの共通5分キャッシュを使います。

公開APIの `getSpeedrunLeaderboards` と `getSpeedrunPlayerBests` は、RaceTimeのcategorySlug/goalから保存済みMappingを解決します。`Any` は具体条件へ展開され、LeaderboardとPBは条件ごとに分かれます。Leaderboard応答にはPlayer Managerの表示名を反映しますが、プレイヤーごとのPBは付加しません。PBは別の `getSpeedrunPlayerBests` 操作でSRC Personal Bests APIから取得する公式記録です。Game、Category、Levelと `obsoletes: true` のVariable値で照合し、SRCが返すPrimary Timeと順位をそのまま使います。`obsoletes: false` のVariableやPlatform、Region、Emulator、Timing MethodはPB照合に使いません。PB検索は `leaderboardTop` に依存しません。PB状態は `found` / `not_found` / `unlinked` / `error` です。複数SRCアカウントでは公式PBから最速を選び、一部の取得に失敗した場合は部分結果だけで確定しません。

`Any` が複数Mappingへ展開されたときは、LeaderboardをMapping単位で返します。一部の取得が失敗しても他のMappingの成功結果を保持し、失敗Mappingに正常キャッシュがある場合は `stale: true` を付けて返します。再取得は対象条件のキャッシュだけを更新し、失敗結果は正常値としてキャッシュしません。

Google Sheets APIを有効化し、ADCで使うアカウントに表の編集権限を付与してください。認証はgoogle-auth-libraryの[Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)を使います。スコープは `https://www.googleapis.com/auth/spreadsheets`。独自の資格情報ファイル設定は設けません。

既存のCategoryMappingsタブに次のヘッダーが必要です（順序自由）。空の表やタブは自動作成しません。

```text
racetime_category_slug,racetime_category_name,racetime_goal,src_game_id,src_game_name,src_category_id,src_category_name,src_level_id,src_variables,src_platform_id,src_region_id,src_emulator,src_timing_method,updated_at
```

キーはtrimしたracetime_category_slugとracetime_goalの組です。src_variablesはValue ID文字列または `Any` を表す `{"mode":"any"}` を持つJSON、src_emulatorは文字列true/false/空欄、src_timing_methodはrealtime/realtime_noloads/ingame/空欄です。更新・削除は既知列だけを対象にします。

`Any` は `obsoletes === true`・`userDefined === false`・定義済みValueが1件以上あるVariableにのみ指定でき、解決時に定義済みの全Valueへ直積展開されます。展開件数が `maxResolvedMappings` を超える場合は部分結果を返さず `expansion_limit_exceeded` エラーになります。Dashboardでは、Any対象外になったVariableは不整合としてエラー表示して保存を禁止し、SRCから削除されたVariableは保存済みIDと警告を表示して、その設定をDraftから削除できます（確定は通常の保存操作）。

一覧・検索結果のrevisionとsettingsRevisionを保存・削除時に送ることで、古い画面からの上書きや別Spreadsheetへの誤書込みを拒否します。expectedRevision:nullは新規登録専用です。

## 公開API

[@nanahuse/racetime-protocol](packages/racetime-protocol/README.md)に全操作と契約を記載しています。

監視中のレースの状態変化をNodeCGメッセージで通知します。イベント一覧・購読方法・通知条件は[Protocolのイベント契約](packages/racetime-protocol/README.md#レース状態変化イベント)を参照してください。

- racetime.v4.*メッセージ、送信先racetime-integration
- nodecg.extensions['racetime-integration'] のRaceTimeAPI
- 非永続racetime-races Replicantと永続racetime-settings Replicant

watchRaceは初回HTTP成功後に非nullのRaceとwatchIdを返します。初回失敗時は参照・再接続処理を残しません。各利用者がwatchIdを管理し、終了時にunwatchRaceで解除してください。

fetchRaceはURLからRaceTimeを1回だけHTTP取得し、その参加者をwatchRaceと同じPlayer解決処理で解決して `{race, participants, resolution}` を返します。watchId・WebSocket・監視セッションは生成せず、既存の監視状態を変更しません。Player Managerの取得に失敗してもレース情報は返し、参加者はunavailableになります。

Player Manager v3の公開listでDirectoryを取得し、Primary/Secondaryを問わずRaceTime AccountをRaceTime IDで照合して表示名などを含むSnapshotを提供します。directoryChanged通知で監視中のレースを自動再解決します。レース状態とPlayer解決のRevisionおよびpending/ready/errorも公開します。Race.resultsは放送で使用する結果ステータスに正規化済みです。

Raceには作成・開始・終了・中止日時、カウントダウン・制限時間、説明、記録対象設定（ranked）・記録可能状態（recordable）・記録済み状態（recorded）、API提供の参加者総数・完走人数・DNF/DQ人数、制限時間到達時の処理を含みます。参加者の `finishedAt` は完走日時で、経過時間の `finishTime` / `RaceResult.time` とは異なります。Overviewは監視中の選択レースでこれらを表示します。公開APIの `fetchRace` は従来どおり単発取得用のデータ取得APIとして利用できます。日時は利用環境のローカルタイムゾーン、期間は経過時間形式、null日時は「未設定」、説明は通常のテキストで表示します。

時間情報はすべての公開インターフェース（直接API・NodeCGメッセージ・Replicant）でISO 8601文字列です。絶対日時はUTC（例 `2026-01-01T01:02:18.123456789Z`）、期間はDuration（例 `PT1H2M3.45S`）、SRC記録日は日付のみ（例 `2026-01-01`）。Protocolの共通関数で内部の `Temporal.Instant` / `Temporal.Duration` / `Temporal.PlainDate` に変換できます。タイムゾーンなしの日時、不正な日付、負または年・月・週を含む期間は拒否し、nullは保持します。公開モデルにTemporalインスタンスは含みません。API_VERSION=4、メッセージ名 `racetime.v4.*`、RacesState.schemaVersion=1は維持します。

実装範囲・検証状況は[implementation.md](docs/implementation.md)に記載しています。
