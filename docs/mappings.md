# マッピング

マッピングはRaceTimeのレースをSpeedrun.comの記録に対応付ける機能です。Game MappingとCategory Mappingの2段階に分かれ、それぞれ別のワークシートに保存します。Spreadsheetの準備は手作業よりDashboardの初期化を使うことを推奨します。

## Game MappingとCategory Mapping

- Game Mapping: RaceTimeのカテゴリ（`categorySlug`）とSpeedrun.comのゲームを対応付けます。`racetime_category_slug`が一意キーです。
- Category Mapping: RaceTimeのGoal（`categorySlug` + `goal`）をSpeedrun.comのカテゴリに対応付けます。`categorySlug` + `goal`が一意キーで、親となるGame Mappingが必須です。SRCのゲームIDとゲーム名はCategory Mappingに重複して保存しません。

Category Mappingを保存するときは、SRCカテゴリが親Game MappingのSRCゲームに属するかをサーバー側で確認します。属さない場合は`category_not_in_game`エラーになります。

## シート構成

`GameMappings`の列は次のとおりです。

```text
racetime_category_slug,racetime_category_name,src_game_id,src_game_name,updated_at
```

`CategoryMappings`の列は次のとおりです。

```text
racetime_category_slug,racetime_goal,src_category_id,src_category_name,src_level_id,src_variables,src_platform_id,src_region_id,src_emulator,src_timing_method,updated_at
```

列はヘッダー名で照合するため、順序は自由です。ただし重複した列名は検証エラーになります。キーとなる列は次のとおりです。

- Game Mappingのキー: `racetime_category_slug`
- Category Mappingのキー: `racetime_category_slug` + `racetime_goal`

`src_variables`はJSONオブジェクトで、Variable IDをキーに、Value IDを表す文字列または`Any`を表す`{"mode":"any"}`を持ちます。`src_emulator`は`true` / `false` / 空欄、`src_timing_method`は`realtime` / `realtime_noloads` / `ingame` / 空欄です。

シートは自動作成しません。DashboardのSettings画面の「Spreadsheetを初期化」で作成するか、同じヘッダーで手動準備してください。

## Any

`Any`は、Variableの定義済みのすべてのValueを対象にする指定です。`"any"`という文字列は特別扱いせず、Value IDとしてのみ扱います。

`Any`を指定できるのは、次の条件をすべて満たすVariableだけです。

- `obsoletes === true`
- `userDefined === false`
- 定義済みのValueが1件以上ある

自由記述型のVariableには指定できません。条件を満たさないVariableへの`Any`は`invalid_input`エラーになります。

`resolveCategoryMapping`は`Any`を定義済みのすべてのValueへ展開します。複数の`Any`がある場合は直積を返します。展開後の各結果は表示用の`label`と安定した`key`を持ちます。

### 展開の上限

展開件数の上限はSettingsの`maxResolvedMappings`（初期値20）で設定します。

- 上限以下なら全件を返します。
- 上限を超える場合は部分結果を返さず、`expansion_limit_exceeded`エラーになります。
- 上限の判定は直積を生成する前に行うため、極端に大きな直積でも全件を生成しません。
- 上限はマッピングの不整合ではなく、設定された制限として扱います。

## 探索結果の状態

`resolveCategoryMapping`は次のいずれかを返します。

- `resolved`: 解決できた具体的な問い合わせ条件の配列。
- `unregistered`: Game MappingまたはCategory Mappingが未登録。
- `inconsistent`: Category Mappingはあるが親Game Mappingがない、または保存済みの`Any`が現在のSRC定義と整合しない。

結果に`Any`は残りません。

## LeaderboardとPBの照合条件

- Leaderboard: 解決した各条件でSRCのLeaderboardを取得します。取得順位の上限は`leaderboardTop`です。SRCが同順位として返したRunはすべて返します。Timing Methodを指定した場合はその時間、指定しない場合はSRCのPrimary Timeを使います。
- PB（自己ベスト）: SRC Personal Bests APIの公式記録を使います。Game、Category、Levelと`obsoletes === true`のVariable値で照合し、SRCのPrimary Timeと順位をそのまま使います。`obsoletes === false`のVariable、Platform、Region、Emulator、Timing Methodは照合に使いません。

複数のSRCアカウントを持つプレイヤーでは、該当する公式PBの中から最速を選びます。一部の取得に失敗した場合は、部分結果だけで確定しません。

## 保存の競合

一覧・検索で得た`revision`と`settingsRevision`を、保存・削除時に送信します。これにより、古い画面からの上書きや、別のSpreadsheetへの誤書込みを拒否します。`expectedRevision: null`は新規登録専用です。

Game MappingとCategory MappingのRevisionは独立して管理します。接続先のSpreadsheetが変わった後の古いリクエストは`settings_changed`になります。

## 既知の制約

SRCのVariableはスコープ（`global` / `full-game` / `all-levels` / `single-level`）を持ちますが、現行実装はスコープと選択中Levelを照合しません。per-levelカテゴリでLevel固有Variableを使う場合、解決結果が選択中のLevelに対応しないことがあります。
