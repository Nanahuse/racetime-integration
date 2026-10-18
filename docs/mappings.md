# マッピング

マッピングはRaceTimeのレースをSpeedrun.comの記録に対応付ける機能です。

RaceTimeではカテゴリとGoal、Speedrun.comではゲームとカテゴリを、それぞれ別に管理しています。どちらも似た名前を持ちますが、対応関係は自動では分かりません。そこで、RaceTimeのカテゴリ・GoalをSpeedrun.comのゲーム・カテゴリへ登録しておき、その対応関係を使って、レースに合ったLeaderboardと参加者のPBを取得します。

マッピングを登録しなくてもレースの監視はできます。ただし、Speedrun.comの記録は取得できません。

## 具体例

たとえば、RaceTimeのカテゴリ`sm64`のGoal「120 Star」を、Speedrun.comのゲーム「Super Mario 64」のカテゴリ「120 Star」に対応付けるとします。このときは、次の2つを登録します。

1. Game Mapping: RaceTimeカテゴリ`sm64` → SRCゲーム「Super Mario 64」
2. Category Mapping: RaceTimeの`sm64` + Goal「120 Star」 → SRCカテゴリ「120 Star」

すると、RaceTimeの`sm64`の「120 Star」レースを監視している間、そのレースに対応するSRCカテゴリのLeaderboardと、参加者のSRCアカウントのPBを取得できるようになります。

## Game MappingとCategory Mapping

- Game Mapping: RaceTimeのカテゴリ（`categorySlug`）とSpeedrun.comのゲームを対応付けます。`racetime_category_slug`が一意キーです。
- Category Mapping: RaceTimeのGoal（`categorySlug` + `goal`）をSpeedrun.comのカテゴリに対応付けます。`categorySlug` + `goal`が一意キーで、親となるGame Mappingが必須です。SRCのゲームIDとゲーム名はCategory Mappingに重複して保存しません。

登録はDashboardのMappingsタブ、またはOverviewのマッピング欄から行います。操作は[Dashboardの使い方](dashboard.md#mappingsタブ)を参照してください。

Category Mappingを保存するときは、SRCカテゴリが親Game MappingのSRCゲームに属するかをサーバー側で確認します。属さない場合は`category_not_in_game`エラーになります。

## 登録後に取得できるもの

- Leaderboard: 登録した各条件でSRCのLeaderboardを取得します。取得順位の上限は設定`leaderboardTop`です。SRCが同順位として返したRunはすべて返します。Timing Methodを指定した場合はその時間、指定しない場合はSRCのPrimary Timeを使います。
- PB（自己ベスト）: SRCが返す公式記録を使います。Game、Category、Levelと`obsoletes === true`のVariable値で照合し、SRCのPrimary Timeと順位をそのまま使います。`obsoletes === false`のVariable、Platform、Region、Emulator、Timing Methodは照合に使いません。

複数のSRCアカウントを持つプレイヤーでは、該当する公式PBの中から最速を選びます。一部の取得に失敗した場合は、部分結果だけで確定しません。

## Any

`Any`は、Variableの定義済みのすべてのValueを対象にする指定です。たとえば、Variable Aに3つのValue、Variable Bに2つのValueがある状態で両方に`Any`を指定すると、3 × 2 = 6通りの条件が生成され、条件ごとにLeaderboardとPBを取得します。1つの`Any`からは、そのVariableのValueの数だけ条件が生まれます。

`"any"`という文字列は特別扱いせず、Value IDとしてのみ扱います。

`Any`を指定できるのは、次の条件をすべて満たすVariableだけです。

- `obsoletes === true`
- `userDefined === false`
- 定義済みのValueが1件以上ある

自由記述型のVariableには指定できません。条件を満たさないVariableへの`Any`は指定できません。

### 展開の上限

展開件数の上限はSettingsの`maxResolvedMappings`（初期値20）で設定します。

- 上限以下なら全件を返します。
- 上限を超える場合は部分結果を返さず、`expansion_limit_exceeded`エラーになります。
- 上限の判定は直積を生成する前に行うため、極端に大きな直積でも全件を生成しません。
- 上限はマッピングの不整合ではなく、設定された制限として扱います。

6通りの条件が生成される上の例は、`maxResolvedMappings`が20以上なら全件取得できます。

## 解決結果

登録したマッピングは`categorySlug`と`goal`から具体的な問い合わせ条件へ解決されます。`resolveCategoryMapping`は次のいずれかを返します。

- `resolved`: 解決できた具体的な問い合わせ条件の配列。
- `unregistered`: Game MappingまたはCategory Mappingが未登録。
- `inconsistent`: Category Mappingはあるが親Game Mappingがない、または保存済みの`Any`が現在のSRC定義と整合しない。

結果に`Any`は残りません。

## シート構成

マッピングはSpreadsheetの2つのワークシートに保存します。シートは自動作成しません。DashboardのSettings画面の「Spreadsheetを初期化」で作成するか、同じヘッダーで手動準備してください。

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

## 保存の競合

一覧・検索で得た`revision`と`settingsRevision`を、保存・削除時に送信します。これにより、古い画面からの上書きや、別のSpreadsheetへの誤書込みを拒否します。`expectedRevision: null`は新規登録専用です。

Game MappingとCategory MappingのRevisionは独立して管理します。接続先のSpreadsheetが変わった後の古いリクエストは`settings_changed`になります。

## 既知の制約

SRCのVariableはスコープ（`global` / `full-game` / `all-levels` / `single-level`）を持ちますが、現行実装はスコープと選択中Levelを照合しません。per-levelカテゴリでLevel固有Variableを使う場合、解決結果が選択中のLevelに対応しないことがあります。
