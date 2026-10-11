# @nanahuse/racetime-protocol

NodeCG RaceTime Integration v1 の公開型と定数。NodeCG・Google SDK・Player Managerの実行時依存はありません。ESMとCommonJSの両方に型宣言を含みます。

```ts
import {BUNDLE_NAME, type RaceTimeAPI} from "@nanahuse/racetime-protocol";

const api = nodecg.extensions[BUNDLE_NAME] as RaceTimeAPI;
const watched = await api.request("watchRace", {url: "https://racetime.gg/ootr/your-race"});
if (watched.ok) {
  // Keep watchId for the entire lifetime of the consumer.
  await api.request("unwatchRace", {watchId: watched.data.watchId});
}
```

別バンドルのmanifestに `"bundleDependencies": {"racetime-integration": "^0.1.0"}` を指定してください。ブラウザからは `operationMessageName(operation)` をメッセージ名、`BUNDLE_NAME` を送信先として利用できます。応答はすべて `Response<T>` です。

監視状態は `RACES_REPLICANT` (`racetime-races`) / 名前空間 `racetime-integration` の `RacesState` で公開されます。参照専用として扱ってください。永続化されず、NodeCG再起動後は再購読が必要です。

| Operation | Request | Response data |
| --- | --- | --- |
| fetchRace | `{url}` | `Race`（単発HTTP取得） |
| watchRace | `{url}` | `{watchId, state}`（監視開始、取得は非同期） |
| unwatchRace | `{watchId}` | `{released}`（再実行時false） |
| getRace | `{url}` | `RaceState \| null`（監視中のスナップショット） |
| listRaces | `undefined` | `RacesState` |
| resolveParticipants | `{url}` | `Participant[]` |
| findCategoryMapping | `{categorySlug, goal}` | `CategoryMapping \| null` |
| saveCategoryMapping | `{mapping}` | 保存した `CategoryMapping` |

各 `watchRace` は独立したwatchIdを返します。同じURLはHTTP/WebSocket監視を共有し、最後のwatchIdの解除時に停止します。接続状態とエラーはRaceStateに含まれ、再接続中も最終成功スナップショットを保持します。切断やブラウザ再読込みでwatchIdは自動解除されないため、利用側が所有期間を管理してください。

`Participant` は解決状態とplayerIdを返します。表示名・登録画面・Playerの更新はPlayer ManagerのAPIを利用してください。`unavailable` は依存先の障害で、`unresolved` と区別されます。Player Manager側で登録・変更した後は `resolveParticipants` で再解決できます。

パッケージのビルド・配布確認:

```sh
pnpm --filter @nanahuse/racetime-protocol build
pnpm --filter @nanahuse/racetime-protocol pack
```

このリポジトリでの実装は公開可能なパッケージ成果物を用意します。レジストリへのpublishは別途リリース時に行います。
