# @nanahuse/racetime-protocol

RaceTime Integration v1の公開型・定数・メッセージ名。ESM/CommonJSの両方に型宣言を含み、NodeCG・Google SDK・Player Managerへの実行時依存はありません。

利用バンドルのmanifestに `"bundleDependencies": {"racetime-integration": "^0.1.0"}` を指定してください。

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

ブラウザからは `operationMessageName(operation)` をメッセージ名、`BUNDLE_NAME` を送信先として使用します。全応答は `Response<T>` です。

| Operation | Request | Response data |
| --- | --- | --- |
| fetchRace | `{url}` | `Race`（単発HTTP取得） |
| watchRace | `{url}` | `{watchId, state}`（初回HTTP成功後、race非null） |
| unwatchRace | `{watchId}` | `{released}`（再実行時false） |
| getWatch | `{watchId}` | `RaceState \| null` |
| getRace | `{url}` | `RaceState \| null`（監視中） |
| listRaces | `undefined` | `RacesState` |
| resolveParticipants | `{url}` | `Participant[]`（監視中なら状態も更新） |
| findCategoryMapping | `{categorySlug, goal}` | `{record, settingsRevision}` |
| listCategoryMappings | `undefined` | `{records, settingsRevision}` |
| saveCategoryMapping | `{mapping, expectedRevision, settingsRevision}` | `{record, action, settingsRevision}` |
| deleteCategoryMapping | `{categorySlug, goal, expectedRevision, settingsRevision}` | `{deleted: true, settingsRevision}` |
| getSettings | `undefined` | `{revision, settings}` |
| updateSettings | `{settings, expectedRevision}` | `{revision, settings}` |

## 監視と更新状態

各watchRaceは独立したwatchIdを返し、同一URLのHTTP/WebSocketを共有します。初回HTTP失敗時はエラー応答となり、そのリクエストの参照を残さず、再接続もしません。他レースの既存監視は維持されます。初回HTTP成功後のWebSocket接続・Player解決は非同期です。接続障害からは最終成功スナップショットを保持して自動復帰します。

最後のwatchIdを解除すると監視と参加者解決の待機を停止します。利用側はwatchIdの所有期間と解除を管理してください。ブラウザの再読込みだけでは解除されません。

`RACES_REPLICANT`（racetime-races、名前空間racetime-integration）は非永続の `RacesState` を公開します。再起動後は再購読が必要です。

- `revision`: セッションの公開状態が更新されるたびに増加。
- `raceRevision`: レーススナップショットが変化したときに増加。RaceTime自身の版は `race.version`。
- `participantsRevision`: 参加者解決結果を採用したときに増加。
- `resolution.state`: idle / pending / ready / error。空の参加者一覧でも解決状態を判別可能。
- `resolution.raceRevision` / `directoryRevision`: 採用結果に対応するレース版とPlayer Directory版。pending中の参加者情報は前回値の場合があります。

これらのカウンターは監視セッション内でのみ比較してください。同じURLでも最後の解除後に再購読すれば新しいセッションになります。

`Participant.player` はPlayer ID、Player revision、表示名、関連アカウントを含むSnapshotです。Player Manager v2のfindをRaceTime IDで呼び、directoryChanged通知で自動再解決します。独自のPlayer作成・Twitch名による推測は行いません。障害時はunavailable、紐付けなしはunresolvedです。

`Race.raceId` はcategorySlug/raceSlugです。`Race.results` はdone→finished、dnf→dnf、dq→dq、その他→otherに正規化済みです。順位とISO 8601形式の完走時間も提供します。

## マッピングと設定

`MappingRecord` は `{mapping, revision}` です。revisionは保存済み14列に対応する不透明な文字列として扱ってください。

- 新規登録: `expectedRevision: null`。既存ならmapping_conflict。
- 更新: find/listで得たrevisionを送信。削除済み・変更済みならmapping_conflict。
- 削除: 同じrevision契約。既知14列の値を消去し、追加列や数式を保持。
- Revert: findCategoryMappingで保存済みの値を読み直す。

各書込みにはfind/listと同時に得たsettingsRevisionも必要です。接続先変更後の古いリクエストはsettings_changedになります。保存成功時のactionはcreated / updatedです。

設定は `{spreadsheetId: string | null, categoryMappingsSheet: string}`。spreadsheetIdがnullなら無効化します。updateSettingsは新しい表を読込み・検証してから切替え、失敗時は旧設定を保持します。`SETTINGS_REPLICANT`（racetime-settings）へ永続化されます。設定ReplicantとレースReplicantは参照専用として扱い、変更にはAPIを使ってください。

Sheetsの同時操作・設定変更はプロセス内で直列化します。外部アプリや別プロセスが読み書きの間に変更することを排他する契約ではありません。

## 配布

```sh
pnpm --filter @nanahuse/racetime-protocol pack
```

レジストリへのpublishは別途リリース時に実施します。
