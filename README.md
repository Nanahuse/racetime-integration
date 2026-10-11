# racetime-integration

NodeCG 2.8向けのRaceTime連携バンドル。複数の利用バンドルでレース監視を共有し、参加者解決をPlayer Managerに委譲します。

## 開発

Node.js 24、pnpm 11.19.0を使用します。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test` はプロトコルとNodeCG拡張をビルドした後に境界テストを実行します。`pnpm dev` は拡張の変更を監視してビルドします。NodeCGの再起動は別途行ってください。

## NodeCGへの配置

NodeCGの `bundles/racetime-integration` にこのリポジトリを配置し、`pnpm install --frozen-lockfile`、`pnpm build` を実行します。同じNodeCGに `player-manager` >=1.0.1 <2 を配置してください。NodeCGはbundleDependenciesに従って読込み順序を決めます。

このバンドルの画面はありません。利用バンドルは公開APIとReplicantを利用します。Exampleのdashboard、graphics、assetCategoriesは削除しています。

## Google Spreadsheet（任意）

NodeCGルートの `cfg/racetime-integration.json`:

```json
{
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "categoryMappingsSheet": "CategoryMappings"
}
```

Google Sheets APIを有効化し、ADCで使用するアカウントに対象表の編集権限を付与します。認証は `google-auth-library` のApplication Default Credentialsを使用します。`GOOGLE_APPLICATION_CREDENTIALS`、ローカルADC、実行環境のサービスアカウントなど、[ADCの標準探索](https://docs.cloud.google.com/docs/authentication/application-default-credentials)を使用し、バンドル独自の認証ファイル設定は設けません。必要なスコープは `https://www.googleapis.com/auth/spreadsheets` です。ローカルのユーザーADCではSheetsスコープを明示して発行してください。

未設定でもレース取得・監視・参加者解決は使用できます。マッピングAPIは `spreadsheet_unavailable` を返します。

既存のCategoryMappingsタブに次のヘッダーが必要です（順序は自由）。空の表やタブは自動作成しません。

```text
racetime_category_slug,racetime_category_name,racetime_goal,src_game_id,src_game_name,src_category_id,src_category_name,src_level_id,src_variables,src_platform_id,src_region_id,src_emulator,src_timing_method,updated_at
```

キーはtrimした `racetime_category_slug` と `racetime_goal` の組です。`src_variables` は文字列値のJSONオブジェクト、`src_emulator` は文字列 `true` / `false` / 空欄、`src_timing_method` は `realtime` / `realtime_noloads` / `ingame` / 空欄です。更新は既知列だけに行い、追加列・数式を保持します。欠落列・重複キーなどは書込み前に拒否し、このプロセス内の保存を直列化します。

## 公開API

[@nanahuse/racetime-protocol](packages/racetime-protocol/README.md)に操作一覧と利用例があります。

- `racetime.v1.*` メッセージ、送信先 `racetime-integration`
- `nodecg.extensions['racetime-integration']` の `RaceTimeAPI`
- 非永続 `racetime-races` Replicantの `RacesState`

同一URLを複数回監視すると監視接続を共有します。各利用者は返されたwatchIdを保存し、利用終了時に `unwatchRace` を呼びます。最後の参照がなくなるとHTTP取得・WebSocket・再接続タイマーを停止します。NodeCG再起動後は再購読が必要です。

参加者はRaceTime IDとTwitch情報をPlayer Managerの `resolve` に渡して解決します。登録・修正後は `resolveParticipants` を呼び出して再解決してください。Playerを独自に作成・更新する経路はありません。

[実装範囲・仕様照合事項・制約](docs/implementation.md)も参照してください。直前のチャットの仕様本文が取得できていないため、公開API名の照合は未完です。
