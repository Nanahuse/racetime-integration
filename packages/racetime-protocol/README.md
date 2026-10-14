# @nanahuse/racetime-protocol

RaceTime Integration v4の公開型・定数・メッセージ名。ESM/CommonJSの両方に型宣言を含み、実行時依存は期間処理に使う `@js-temporal/polyfill` のみです（NodeCG・Google SDK・Player Managerへの実行時依存はありません）。

利用バンドルのmanifestに `"bundleDependencies": {"racetime-integration": "^0.5.0"}` を指定してください。

```ts
import {BUNDLE_NAME, type RaceTimeAPI} from "@nanahuse/racetime-protocol";

const api = nodecg.extensions[BUNDLE_NAME] as RaceTimeAPI;
const watched = await api.request("watchRace", {url: "https://racetime.gg/ootr/your-race"});
if (watched.ok) {
  // Initial HTTP load has succeeded; the race is non-null.
  const race = watched.data.state.race;
  console.log(race.raceId);
  await api.request("unwatchRace", {watchId: watched.data.watchId});
}
```

ブラウザからは `operationMessageName(operation)` をメッセージ名、`BUNDLE_NAME` を送信先として使用します。全応答は `Response<T>` です。APIバージョンは4で、旧バージョンとの互換実装は提供しません（v3との互換レイヤーはありません）。

| Operation | Request | Response data |
| --- | --- | --- |
| fetchRace | `{url}` | `ResolvedRace`（単発HTTP取得＋Player解決。監視は開始しない） |
| watchRace | `{url}` | `{watchId, state}`（初回HTTP成功後、race非null） |
| unwatchRace | `{watchId}` | `{released}`（再実行時false） |
| getWatch | `{watchId}` | `RaceState \| null` |
| getRace | `{url}` | `RaceState \| null`（監視中） |
| listRaces | `undefined` | `RacesState` |
| listGameMappings | `undefined` | `{records, settingsRevision}` |
| findGameMapping | `{categorySlug}` | `{record, settingsRevision}` |
| saveGameMapping | `{mapping, expectedRevision, settingsRevision}` | `{record, action, settingsRevision}` |
| deleteGameMapping | `{categorySlug, expectedRevision, settingsRevision}` | `{deleted: true, settingsRevision}` |
| listCategoryMappings | `undefined` | `{records, settingsRevision}` |
| findCategoryMapping | `{categorySlug, goal}` | `{record, settingsRevision}` |
| saveCategoryMapping | `{mapping, expectedRevision, settingsRevision}` | `{record, action, settingsRevision}` |
| deleteCategoryMapping | `{categorySlug, goal, expectedRevision, settingsRevision}` | `{deleted: true, settingsRevision}` |
| resolveCategoryMapping | `{categorySlug, goal}` | `{status: "resolved", mappings: ResolvedCategoryMapping[]} \| {status: "unregistered"} \| {status: "inconsistent", message}` |
| getSpeedrunLeaderboards | `{categorySlug, goal, refresh?}` | 解決状態と条件ごとの `{mapping, top, fetchedAt, state, entries, stale}` |
| getSpeedrunPlayerBests | `{categorySlug, goal, playerIds, refresh?}` | 解決状態と条件ごとのPlayer別PB状態・Run情報 |
| searchSpeedrunGames | `{query}` | `{games}` |
| getSpeedrunGameOptions | `{gameId}` | `{game, categories, levels, platforms, regions, timingMethods}` |
| getSpeedrunCategoryVariables | `{categoryId}` | `{variables}` |
| initializeSpreadsheet | `{settings}` | `{gameMappings, categoryMappings}` |
| getSettings | `undefined` | `{revision, settings}` |
| updateSettings | `{settings, expectedRevision}` | `{revision, settings}` |

## 監視と更新状態

各watchRaceは独立したwatchIdを返し、同一URLのHTTP/WebSocketを共有します。初回HTTP失敗時はエラー応答となり、そのリクエストの参照を残さず、再接続もしません。他レースの既存監視は維持されます。初回HTTP成功後のWebSocket接続・Player解決は非同期です。接続障害からは最終成功スナップショットを保持して自動復帰します。

最後のwatchIdを解除すると監視と参加者解決の待機を停止します。利用側はwatchIdの所有期間と解除を管理してください。ブラウザの再読込だけでは解除されません。

`RACES_REPLICANT`（racetime-races、名前空間racetime-integration）は非永続の `RacesState` を公開します。再起動後は再購読が必要です。

- `revision`: セッションの公開状態が更新されるたびに増加。
- `raceRevision`: レーススナップショットが変化したときに増加。RaceTime自身の版は `race.version`。
- `participantsRevision`: 参加者解決結果を採用したときに増加。
- `resolution.state`: idle / pending / ready / error。空の参加者一覧でも解決状態を判別可能。
- `resolution.raceRevision` / `directoryRevision`: 採用結果に対応するレース版とPlayer Directory版。pending中の参加者情報は前回値の場合があります。

`Participant.player` はPlayer ID、Player revision、表示名、関連アカウントを含むSnapshotです。Player Manager v3の公開 `list` でDirectoryを取得し、RaceTime Account（Primary/Secondaryを問わない）をRaceTime IDで照合します。directoryChanged通知で監視中のレースを自動再解決します。独自のPlayer作成・Twitch名による推測は行いません。障害時はunavailable、紐付けなしはunresolved、同一RaceTime IDが複数Playerに属する場合はunavailableです。

`Race.raceId` はcategorySlug/raceSlugです。`Race.results` はdone→finished、dnf→dnf、dq→dq、その他→otherに正規化済みです。順位も提供します。

## 完走時間（期間）

完走時間はISO 8601期間文字列（例 `PT1H2M3.45S`）で公開します。`Entrant.finishTime` と `RaceResult.time` は同じ参加者の同じ期間を表し、記録の無い参加者は `null` です。内部では標準の `Temporal.Duration` として扱い、公開Protocolの共通関数で相互変換します。

- `parseRaceDuration(value)` は文字列を `Temporal.Duration` へ復元します。`null` はそのまま返し、負の期間と年・月・週（基準日が無いと経過時間として曖昧なため）を拒否し、不正な文字列は例外にします。不正値を `0` や `null` に読み替えません。
- `serializeRaceDuration(value)` は `Temporal.Duration` を精度を保ったISO 8601文字列へ戻します。`null` はそのまま返します。`parseRaceDuration` と同じ検証を適用するため、負の期間と年・月・週を含む `Temporal.Duration` はシリアライズできません。

期間の比較・計算には `Temporal.Duration` の標準APIをそのまま使います。パッケージは `Temporal` も再エクスポートするため、利用側で別途polyfillを導入する必要はありません。

```ts
import {
  type RaceDuration,
  Temporal,
  parseRaceDuration,
} from "@nanahuse/racetime-protocol";

const time: RaceDuration | null = parseRaceDuration(race.results[0]?.time ?? null);
if (time) {
  console.log(time.total({unit: "seconds"}));
  console.log(Temporal.Duration.compare(time, parseRaceDuration("PT1H")!));
}
```

## 単発取得

`fetchRace` はRaceTimeからHTTPで1回だけ取得し、その `race.entrants` を同じPlayer解決処理で解決して `ResolvedRace` を返します。`ResolvedRace` は `{race, participants, resolution}` です。

- `resolution.state` は解決処理全体の成功・失敗を表す。解決できた場合は `ready`、Player Managerの取得失敗またはタイムアウト時は `error`。
- 紐付けのない参加者が存在するだけでは `error` にしない（`Participant.status` は `unresolved`）。
- `resolution.directoryRevision` は採用結果に対応するPlayer Directory版。失敗時は `null`。
- RaceTime取得に失敗した場合は通常のAPIエラー応答となり、レース情報は返さない。
- 単発取得はwatchId・WebSocket接続・監視セッションを生成せず、既存の監視状態やReplicantを変更しない。解決のための追加のHTTP取得は行わない。
- 登録・紐付けを行った後に最新の解決結果を得るには、同じURLで再度 `fetchRace` を呼ぶ。

## マッピングと設定

マッピングはGame MappingとCategory Mappingの2シートに分かれ、Revisionは独立して管理します。

`GameMapping` はRaceTimeゲーム（`racetime.categorySlug`が一意キー）とSRCゲームを対応付けます。`CategoryMapping` はRaceTime Goal（`categorySlug + goal`が一意キー）をSRCカテゴリへ対応付けます。Category Mappingは親Game Mappingを参照し、SRC Game ID/Nameは重複保存しません。

`MappingRecord` は `{mapping, revision}` です。revisionは保存行に対応する不透明な文字列として扱ってください。

- 新規登録: `expectedRevision: null`。既存ならmapping_conflict。
- 更新: find/listで得たrevisionを送信。削除済み・変更済みならmapping_conflict。
- 削除: 同じrevision契約。既知列の値を消去し、追加列や数式を保持。
- Revert: find系で保存済みの値を読み直す。

親子整合性はサーバー側で保証します。親Game Mappingが無いCategory Mappingの登録はgame_mapping_missing、子が存在する親のSRC Game ID変更・削除はgame_mapping_conflict、SRCカテゴリが親のSRCゲームに属さない場合はcategory_not_in_gameを返します。

各書込みにはfind/listと同時に得たsettingsRevisionも必要です。接続先変更後の古いリクエストはsettings_changedになります。保存成功時のactionはcreated / updatedです。

`resolveCategoryMapping` はGame MappingとCategory Mappingを結合し、SRCの問い合わせ条件となる `ResolvedCategoryMapping[]` を返します。未登録は `unregistered`、Category Mappingはあるが親Game Mappingが無い場合や保存済みの `Any` が現在のSRC定義と整合しない場合は `inconsistent` を返します。利用側が2シートを直接結合する必要はありません。

### Category VariableのAny

`CategoryMapping.speedrunCom.variables` の各値は具体的なValue ID（文字列）または `{mode: "any"}` です。`"any"` という文字列は特別扱いしません。`obsoletes === true`・`userDefined === false`・定義済みValueが1件以上あるVariableにのみ `Any` を指定でき、それ以外への指定は `invalid_input` です。`Any` は自由記述型Variableには提供しません。

`resolveCategoryMapping` は `Any` を定義済みの全Valueへ展開し、複数の `Any` がある場合は直積を返します。各結果は安定した `key`（Game ID・Category ID・Level ID・正規化したVariableの組とその他条件から生成）と表示用 `label`（展開されたVariable名とValue名）を持ち、結果に `Any` は残りません。`Any` を含まない場合は具体的なマッピング1件の配列を返し、追加のSRC通信は行いません。展開アルゴリズムはSpreadsheetやHTTP通信に依存しません。

展開件数には上限があり、Settingsの `maxResolvedMappings`（初期値20）で設定します。上限以下なら全件を返します。上限超過時は部分結果を返さず、公開APIは `expansion_limit_exceeded` エラー（作成しようとした件数と現在の上限を含むメッセージ）を返します。これはマッピングの不整合ではなく設定された上限として扱われ、`inconsistent` や `internal_error` にはなりません。上限判定は直積を生成する前に行われ、極端に大きな直積でも全件を生成しません。`Any` を含まない解決には影響しません。DashboardのSettings画面（表示名「Any展開の最大件数」）から変更・保存できます。

`initializeSpreadsheet` は指定されたSpreadsheetへ `GameMappings` と `CategoryMappings` のワークシートを準備します。不足シートは作成（`created`）、空シートにはヘッダーを設定（`initialized`）し、正常な既存シートは変更しません（`unchanged`）。不正な既存データがある場合は変更せずエラーを返します。初期化はSettingsを永続化せず、`settingsRevision` も変更しません。保存前に利用者が明示的に接続先を確定してください。

設定は `{spreadsheetId: string | null, gameMappingsSheet: string, categoryMappingsSheet: string, maxResolvedMappings: number, leaderboardTop: number}`。spreadsheetIdがnullなら無効化します。`maxResolvedMappings` と `leaderboardTop` は1以上の安全な整数（初期値20）で、0以下・小数・負数・NaN・Infinity・数値以外・安全な整数範囲外は拒否します。どちらかを持たない既存の永続化済み設定は、他の値とrevisionを変更せずに20を補完して読み込みます。updateSettingsは両シートを読込み・検証してから切替え、失敗時は旧設定を保持します。`SETTINGS_REPLICANT`（racetime-settings）へ永続化されます。設定ReplicantとレースReplicantは参照専用として扱い、変更にはAPIを使ってください。

## Speedrun.com検索

`searchSpeedrunGames` / `getSpeedrunGameOptions` / `getSpeedrunCategoryVariables` は手動選択用にSRCのゲーム・カテゴリ・Level・Variables・Platform・Region・Emulator・Timing Methodを取得します。SRC v1 APIは認証不要です。

## Speedrun.com Leaderboard / PB

両操作は `categorySlug` と `goal` から既存Mappingを解決し、`Any` を `maxResolvedMappings` の範囲内で具体的な条件へ展開します。条件ごとに独立した結果を返し、`mapping.key` で識別します。未登録は `unregistered`、MappingとSRC定義の不一致は `inconsistent`、SRC通信失敗は `Response` のerrorになります。

`getSpeedrunLeaderboards` は設定 `leaderboardTop` をSRCの `top` に渡します。SRCの `place` を維持し、同順位のRunをすべて返します。RunはID、URL、検証済みISO 8601時間、日付、ユーザー/ゲスト情報を含みます。Timing Method指定時はその時間、未指定時はSRC Primary Timeを使用します。

`getSpeedrunPlayerBests` は `playerIds` のPlayer Manager Player IDごとに、Primary/Secondaryの全SRCアカウントを検索します。SRC Personal Bestsから現行の有効Runを取得し、Game/Category/Level、Variables、Platform、Region、Emulator、Timing Methodを照合して最速を `Temporal.Duration` で選びます。PB状態は `found` / `not_found` / `unlinked` / `error` です。Leaderboard上位n位への掲載有無には依存しません。

Extension内の条件別キャッシュは5分TTLで、同時要求は共有し、HTTP並行数を4に制限します。`refresh: true` で再取得します。再取得に失敗して直前の正常値がある場合は `stale: true` を付けて返し、キャッシュなしの失敗はerrorです。DashboardとNodeCG外部バンドルは同じ公開Protocolとキャッシュを使用します。レース監視更新はSRC取得を開始しません。

Sheetsの同時操作・設定変更はプロセス内で直列化します。外部アプリや別プロセスが読み書きの間に変更することを排他する契約ではありません。

## 配布

```sh
pnpm --filter @nanahuse/racetime-protocol pack
```

レジストリへのpublishは別途リリース時に実施します。
