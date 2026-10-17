# v4実装と検証

調査基点はracetime-integration mainの4db1cdf。PR #1のレビューを反映し、Player Manager 3.0.0 / Protocol v3（タグ `v3.0.0`）に接続する。racetime-integration自身の公開Protocolは `v4` とし、Player Manager Protocol v3とは独立して扱う。v2ではマッピングモデルを分割し、Dashboardを追加した。v3では単発取得でもPlayer解決を行う。v4ではCategory Variableに `Any` を指定でき、解決時に定義済みの全Valueへ直積展開する。完走時間は `Temporal.Duration` として解析し、公開時はISO 8601期間文字列へ戻す。

## 責務と公開契約

0.6.0ではRaceTimeの作成・開始・終了・中止日時、カウントダウン・制限時間、説明、ranked・recordable・recorded、制限時間での完了／中止設定、API提供の参加者総数・完走人数・DNF/DQ人数、参加者の完走日時を追加した。公開フィールドの意味と型は[Protocol](../packages/racetime-protocol/README.md#レース詳細と時間情報)を参照。API_VERSION=4、`racetime.v4.*`、`RacesState.schemaVersion=1`、CIのタグ発行方式は維持する。

Protocolの `datetime.ts` に `parseRaceInstant` / `serializeRaceInstant` と `parseRaceDate` / `serializeRaceDate` を追加し、既存のDuration関数と同じnull保持・不正値拒否を適用する。タイムゾーンのない日時をUTCと推測せず、日付から時刻を暗黙除去しない。日時は `Temporal.Instant`、期間は `Temporal.Duration`、SRC記録日は `Temporal.PlainDate` で検証する。ナノ秒までの精度と意味を保ってISO 8601へ戻す。

RaceTime DTOの日時・期間はTemporal値で保持し、`mapRace` でUTC日時／Duration文字列へ変換する。新しい必須項目の欠落、型不一致、不正日時・期間、負数・安全な整数でない人数は `invalid_payload`。nullを許す日時もキーは必須とし、開始・終了・中止・完走日時の推測補完は行わない。`Entrant.finishedAt` と `RaceResult.finishedAt` は同じ日時、`finishTime` / `time` は同じ経過時間を表す。ranked・recordable・recordedは独立して保持し、人数は配列から再計算しない。

SRC時間は取得境界でDurationとして検証・シリアライズし、PB比較は既存どおり `Temporal.Duration.compare` を使用する。SRC記録日は共通のPlainDate解析で検証する。Leaderboard/PBの `fetchedAt` は `Temporal.Now.instant()` を共通関数で文字列化し、5分キャッシュの期限もInstantで保持・比較する。公開文字列を返す既存のSpeedrunClientインターフェースは維持し、サービスごとの重複DTOは追加しない。PB照合、アカウント集約、公式順位、同時要求共有、refresh・staleの扱いは維持する。

単発取得・監視は同じ `mapRace` を使う。直接API・NodeCGメッセージ・Replicantはいずれも同じISO文字列のモデルを公開するため、監視状態の比較・structuredCloneにTemporal値は入らない。WebSocketのrace.dataによる再取得、version処理、バックオフ、監視共有、古い応答の破棄、最終正常スナップショット保持、Player解決は変更しない。毎秒のHTTP取得・Replicant更新は追加しない。

Overviewの `RaceFields` を単発取得・監視で共有し、新しい詳細とAPI提供の人数を表示する。参加者の完走日時も結果欄に追加した。日時は `formatRaceInstant` が利用環境のローカルタイムゾーンで表示し、nullは「未設定」、Durationは既存の経過時間表示、infoはReactの通常テキストとして扱う。Rankingsの最終取得日時も共通の日時表示を使う。PB表示・参加者操作・マッピング編集・レース切り替えは維持する。

- RaceTime: HTTP取得、WebSocket通知での再取得、再接続、レースIDと結果の正規化。`finish_time` は共通の `parseRaceDuration` で `Temporal.Duration` に解析し、未検証の期間文字列を取得境界より内側へ渡さない。
- RaceService: 単発取得のHTTP取得・Player解決、URLごとの共有監視、初回成功後の購読成立、失敗時の解放、Revision管理。
- Player Manager: 公開 `list` でDirectoryを取得し、Playerに属するRaceTime Account（`service === "racetime"`、`identity.userId`）をPrimary/Secondaryの区別なく検索する。`find` は使わない。RaceTime側でPlayerを作成・更新せず、公開 `resolveDisplayName` で表示名を確定し、`player-manager.v3.directoryChanged` で再解決する。
- Game Mappings: RaceTimeゲーム（categorySlugが一意キー）とSRCゲームをGameMappingsシートで対応付ける。
- Category Mappings: RaceTime Goal（categorySlug + goalが一意キー）をSRCカテゴリへCategoryMappingsシートで対応付ける。親Game Mappingを必須とし、SRC Game ID/Nameを重複保存しない。
- 親子整合性: 親の無いCategory登録、子の有る親のSRCゲーム変更・削除、親のSRCゲームに属さないSRCカテゴリをサーバー側で拒否する。
- 統合参照: resolveCategoryMappingでGame MappingとCategory Mappingを結合し、具体的な問い合わせ条件の配列（`ResolvedCategoryMapping[]`）を返す。未登録（unregistered）と不整合（inconsistent）を区別する。`Any` は定義済みの全Valueへ展開し、複数 `Any` は直積とする。各結果は安定した `key` と表示用 `label` を持ち、結果に `Any` は残らない。
- 展開上限: `Settings.maxResolvedMappings`（初期値20）を上限とする。上限以下は全件、超過時は部分結果を返さず `expansion_limit_exceeded`（件数と上限を含む）を返す。判定はBigIntで直積生成前に正確に行い、極端に大きな直積でも全件生成しない。上限はマッピング不整合ではない。
- Category VariableのAny: `obsoletes === true`・`userDefined === false`・定義済みValueが1件以上あるVariableにのみ `{mode: "any"}` を許可する。保存時はAPIとUIの両方で検証し、未知Variable・不正Value・対象外VariableへのAnyを拒否する。自由記述型は対象外。UIは保存済みVariableと現在のSRC定義を照合し、Any対象外になったVariableとSRCから削除されたVariableを不整合として表示する。削除されたVariableは保存済みIDと警告を示し、その設定をDraftから除去できる（自動削除・自動初期化はしない。確定は通常の保存）。
- Speedrun.com: ゲーム・カテゴリ・Level・Variables・Platform・Region・Timing Methodの選択肢に加えて、Leaderboardと個人PBを取得する。LeaderboardはSRC v1の `top` と条件フィルターを使い、同順位を含む全RunをSRC順位のまま返す。Run内プレイヤー参照はLeaderboard直下のembedded player一覧へIDで結び付け、guestも保持する。PBはユーザーごとに `game` を指定したPersonal Bests APIを全ページ取得し、Game/Category/Levelと `obsoletes: true` のVariable値で照合する。`top` は指定せず、SRCの公式Primary Timeと `place` をそのまま使う。`obsoletes: false` のVariable、Platform、Region、Emulator、Timing MethodはPB照合に使わない。Player ManagerのPrimary/Secondaryアカウントから該当する公式PBを集約し、一部取得失敗は部分結果で確定しない。SRC HTTP要求は4件まで並列化し、5分キャッシュ、同時要求共有、条件別refresh、stale応答をExtension内で管理する。Any展開時のLeaderboard取得状態とstale結果はMappingごとに返す。失敗応答は正常値としてキャッシュしない。カテゴリ所属ゲームは既存どおりカテゴリ詳細 `links` の `rel: "game"` から解決する。
- Protocol: 上記契約の型・定数・メッセージ名。Leaderboard/PBは既存 `racetime.v4.*` に操作を追加し、API_VERSIONとMESSAGE_PREFIXを維持する。完走時間とSRC時間は公開では検証済みISO 8601期間文字列、比較は `Temporal.Duration` を利用する。`parseRaceDuration` / `serializeRaceDuration` と `Temporal` を公開する。
- Spreadsheet初期化: `initializeSpreadsheet` で指定Spreadsheetへ `GameMappings`/`CategoryMappings` ワークシートを準備する。
- Dashboard: `RaceTime Integration` パネル（fullbleed）。Overview / Rankings / Mappings / Settingsを公開Protocol経由で操作し、Replicantは参照専用とする。OverviewのPB要求は参加者とレース情報の表示とは独立し、SRC障害はRaceTime表示に波及しない。

watchRaceの成功条件は初回HTTP取得成功。WebSocket接続完了やPlayer解決完了は別の状態として公開する。接続不良を受けても既存Activeの判断に使えるRaceを返す。初回HTTP失敗時には参照も再試行も残さない。fetchRaceは同じHTTP取得と `mapRace` 正規化で1回だけ取得し、watchRaceと同じParticipantResolverで参加者を解決して `ResolvedRace`（race / participants / resolution）を返す。watchId・WebSocket・監視セッションを生成せず、既存の監視状態やReplicantを変更しない。Player Manager取得失敗時もレース情報は保持し、参加者をunavailable・resolutionをerrorとして返す。`mapRace` は解析済みの `Temporal.Duration` を `serializeRaceDuration` でISO 8601期間文字列へ戻すため、公開データやReplicantに `Temporal.Duration` は混入しない。`Entrant.finishTime` と `RaceResult.time` は同じ期間を表し、記録なしは `null` とする。

表示レイアウト、配信への適用、レース履歴、RaceTimeチャット送信は含めない。nodecg-race-layouts/player-managerの変更は行わない。

## 非同期処理と競合

- HTTPとWebSocketハンドシェイクは各10秒でタイムアウト。
- 初回成功後の切断は1/2/5/10/30秒のバックオフで復帰。HTTP再同期成功までバックオフをリセットしない。
- race.dataをHTTP再取得の通知として扱い、進行中取得中の通知を集約。接続開始時にも再取得して購読の隙間を補う。
- 古い接続世代・低いRaceTime version・解除後の応答は公開しない。
- Player解決は公開 `list` の1スナップショットから行い、directoryChangedを集約して前の世代を破棄する。15秒の期限。同一RaceTime IDが複数Playerに属する場合は任意選択せず解決失敗として扱う。
- 正常な `directoryChanged` はRevisionの大小に関わらず再解決の契機とする（v3は同一Revisionで内容が変わり得る）。
- Sheets操作と設定変更をプロセス内で直列化。外部編集・複数プロセスに対する分散ロックは提供しない。
- Sheets書込みは自動リトライなし。応答不明時には再読込みで成功有無を確認。
- 削除は既知列の値を消去する。追加列や数式は残し、既知列が空の行は一覧から除外。
- Game MappingとCategory MappingのRevisionは独立して管理し、更新・削除は保存済みrevisionとの一致を要求する。
- Dashboardの編集はGame/Categoryで独立した編集セッションとして保持し、保存の `expectedRevision` はセッション基準を使う。再読込で期待Revisionだけを差し替えない。保存・削除・再読込の実行中はフォーム入力を禁止し、保存要求後に編集状態が変化しないようにする。Settingsは競合状態（none/unavailable/ready）を区別し、最新設定の取得に失敗しても保存を禁止し続け、「最新設定を再取得」から復旧する。

## Spreadsheet形式と初期化

- GameMappings: `racetime_category_slug, racetime_category_name, src_game_id, src_game_name, updated_at`。
- CategoryMappings: `racetime_category_slug, racetime_goal, src_category_id, src_category_name, src_level_id, src_variables, src_platform_id, src_region_id, src_emulator, src_timing_method, updated_at`。
- `src_variables` はValue IDを表す文字列、または `Any` を表す `{"mode":"any"}` を持つJSONオブジェクト。文字列形式の既存データを読み込め、`Any` の保存・再読込で選択状態を失わない。未知の変則オブジェクトは検証エラーとする。列追加・データ移行は行わない。
- カラム順の並び替え、未知の追加カラム・数式の保持、必須項目と重複キーの検証、settingsRevisionによる接続先変更検出に対応する。
- ヘッダー/行/重複キーの検証は `parseSheetValues` をRepositoryと初期化処理で共有し、正常なシート形式の判定を一致させる。
- 初期化（`initializeSpreadsheet`）は両シートを先に検査し、不正な非空データがあれば変更を開始しない。不足シートは作成、完全に空のシートにはヘッダーを書き込む。正常な既存シート（並び替え・追加列・データを含む）は変更しない。再実行は冪等で、途中失敗後は未完了分のみ完了できる。初期化は保存済みSettingsと `settingsRevision` を変更しない。
- 空判定は `A1:ZZ` の取得だけで判断せず、`empty` の場合のみ `valueRenderOption: "FORMULA"` でワークシート全体を再取得し、`trim()` せずに内容の有無を確認する。数式が空文字列を返す場合や、ZZ列より右側の内容も保護する。
- 旧14列形式の移行・読込・互換処理は提供しない。新しい2シート構成のみを正規とする。

## Player ManagerのAccount

Player Manager v3のPlayerは複数Accountを持ち、各Accountは `service` と `identity`（RaceTimeは `userId`）を持つ。racetime-integrationはDirectoryの全PlayerのRaceTime Accountを走査して参加者を解決し、Primary/Secondaryいずれでも同じPlayerへ解決する。SnapshotのTwitchはv3で `userId` を持たないため `null` とし、Account IDを流用しない。サブアカウントの管理UIは実装せず、公開APIの範囲で参加者解決だけを行う。

## 起動時Settings復旧

保存済み `racetime-settings` が不正な場合（例: `gameMappingsSheet` 欠落）、Extensionはマウントを失敗させず、既定設定（`revision: 0`、`spreadsheetId: null`、`gameMappingsSheet: "GameMappings"`、`categoryMappingsSheet: "CategoryMappings"`、`maxResolvedMappings: 20`）へ初期化して永続化し、NodeCG loggerへ警告を記録して起動を継続する。`maxResolvedMappings` を持たない既存の永続化済み設定は、他項目とrevisionを変更せずに20を補完して読み込む（欠落だけを理由に設定全体をリセットしない）。フィールドが存在して値が不正な場合は通常の設定検証で拒否する。bundleConfigが有効なら現在の初期値生成規則を維持する。設定形式の不正（`invalid_input`）以外の例外は再スローする。この復旧はSpreadsheetの内容を変更しない。

## Dashboard

- `dashboardPanels` に `racetime-integration`（title `RaceTime Integration`、fullbleed）を定義し、Vite + React + TypeScriptでビルドする。出力は `dashboard/`（CIのbuildで生成）。
- Overview: `racetime-races` Replicantから監視中レース、接続状態、参加者解決状況を表示する。URLによる単発取得はfetchRaceを使用し、watchIdは生成しない。単発取得も監視と同じ参加者表示・操作（解決済み表示名、編集リンク、登録・紐付け、unavailable理由、順位・完走時間・結果ステータス）を使う。順位未設定は「—」と表示する。完走時間はISO 8601文字列をそのまま出さず、取得・パース処理とは分離した表示処理で `Temporal.Duration` から累積時間（例 `1:02:03.45`、24時間以上は日数に分割しない、小数秒末尾のゼロは省略、`null` は「—」）へ整形する。単発取得に監視用メタデータは表示しない。Player Managerの登録は公開APIのbeginRegistrationで得たURLへ遷移し、編集はProtocolの `playerEditUrl` を使う。beginRegistrationは登録セッションの開始で登録完了ではないため、開始直後の再取得は行わず、利用者が同じURLを「再取得」して最新の解決結果を反映できる。単発取得の古いHTTP応答と、表示対象が変わった後の古い登録結果は世代管理で破棄し、取得中と登録開始中の状態は互いの完了で解除しない。別レース取得中は表示中レースの登録操作を無効化し、登録操作の重複判定は表示対象ごとに行う（監視レースには制限しない）。レース詳細と参加者の間にSpeedrun.comマッピングセクションを表示し、表示中レースのGame/Category Mappingの登録状況（未登録・登録済み・不整合・読込失敗）を確認してOverview内で登録・編集・削除できる。マッピング対象は `race.category.slug` と `race.category.goal` で決まり、URLやRace IDを含めない。RaceTime識別キーは自動入力して編集不可とし、未登録時の初期DraftはRaceTime情報のみで未保存扱いにしない。マッピング読込失敗は未登録とみなさず原因を表示して保存を禁止する。保存はGame/Categoryを別々に行い、Game未登録時はCategory保存を禁止する。表示対象が変わった場合のみ編集セッションを初期化し、同じマッピング対象のレース間や監視更新ではDraftを維持する。未保存変更がある場合のレース切り替え（確認待ちの単発取得結果を保持）・タブ移動・編集パネルを閉じる操作は破棄確認を表示し、保存・削除中は対象切り替えを禁止する。登録URL・登録エラーは結果が属する表示対象に対応させ、表示対象が実際に変わったときだけクリアする（同じレースの再取得や、表示対象が変わらない取得失敗では維持する）。マッピングの保存・削除・再読込中はWorkspaceを破棄せず、保存中に到着した取得結果は適用せず理由を表示して破棄する（自動再適用・再試行はしない）。単発取得の開始ボタンはマッピング保存中は無効化する。監視レースの外部更新でMapping対象（`categorySlug`+`goal`）が変わった場合、未保存編集がある間は現在の編集対象とレース情報を維持し、破棄して最新状態を表示するか編集を続けるかを確認する（削除時も同様に未保存編集を保護する）。監視対象のエントリは存在するが `race` が一時的に null の場合は削除扱いせず、表示・編集対象・Draft・進行中の登録を維持し、Race情報が復旧した時点で最新状態へ切り替えられる。Mapping対象が変わらない通常更新（participantsRevision・接続状態など）は従来どおり反映し、未保存変更がなければ新しい対象へ自動的に切り替える。保存・削除・再読込中は外部更新による対象切り替えを行わない。監視対象の削除などでレース表示が終了する場合は、そのレースの参加者登録要求・登録結果を無効化する（同一レースのGoal/カテゴリ変更では登録要求を無効化しない）。
- Mappings: 左にGame Mapping一覧・検索、右に選択ゲームの詳細とCategory Mapping一覧を表示する。SRCは手動検索・選択のみで、自動マッピング・候補提案・類似度評価は行わない。競合時は最新状態の採用／最新状態からの再編集（差分表示）を提示し、解決まで保存を禁止する。設定変更（settings_changed）は新保存先を読み込み、旧編集を自動適用しない。Overviewと同じ `MappingWorkspace`（manageモード）を使い、SRC検索・保存・削除・競合解決を共有する。保存済みVariableと現在のSRC定義を照合し、Any対象外になったVariableはエラー表示して保存を禁止する。SRCから削除されたVariableは保存済みIDと警告を表示し、その設定をDraftから削除する操作を提供する（自動削除せず、確定は通常の保存。Revertで保存済み状態へ戻る）。
- Settings: Spreadsheet URL/ID、両シート名、Any展開の最大件数（数値入力、初期値20）、接続状態、Spreadsheetリンク、保存、初期化、エラー詳細を表示する。URLはIDへ正規化する。Any展開の最大件数は保存前に検証し、1以上の整数でない場合はエラー表示して保存を禁止する。保存（updateSettings）で両シートを検証できた場合のみ「利用可能」と表示する。初期化は未保存入力に対して実行でき、保存や `settingsRevision` を変更しない（初期化の入力項目にAny展開の最大件数は含めない）。初期化中の入力変更・保存を禁止し、入力を変更したら初期化結果表示をクリアする。Google認証情報の入力UIは設けない。

## 検証

境界テストはHTTP・WebSocket、初回購読失敗、複数利用者、単発取得でのPlayer解決（完走済み・進行中・Primary/Secondary・未登録・障害時フォールバック・RaceTime失敗・監視を開始しない・HTTP取得の重複なし・監視との解決結果一致）、単発取得失敗時の未保存マッピング編集保持、保存リロード中の取得失敗でのWorkspace維持、保存中に到着した取得結果の破棄と通知、表示対象変更時の登録URL・登録エラーのクリア、表示対象が変わらない取得失敗での登録結果維持、監視レースの外部更新による未保存編集の保護（対象変更・削除・通常更新の反映・保存中の外部更新保護）と監視対象削除時の登録要求・登録結果の無効化（成功・失敗・編集継続・表示解除）と一時的な `race === null` 時の表示・Draft維持、タブ切り替え確認時の保存中遷移禁止、Player Manager v3のPrimary/Secondary解決・Account移動・削除・不正Directory・v3以外、Revision非依存のdirectoryChanged、結果正規化、SRCカテゴリ所属ゲームの `links` 解決（`rel: "game"` の抽出・不正URI・リンク欠落の拒否）と保存時の所属ゲーム整合性、Game/Category MappingのCRUD、親子整合性、Revision競合、2シートの読込・保存・列順変更・追加カラム保持、設定切替の整合性、Category VariableのAny（具体値のみ＝1件・追加SRC通信なし、Any1つ＝全候補、複数Any＝直積、固定値との混在、未指定との混在、各結果のValue ID、安定keyとlabel、結果にAnyが残らない、SRC選択肢変更の反映、SRC通信失敗時に部分成功しない、対象外Variable・未知Variable・不正Value・不正オブジェクトの拒否、保存済みAnyとSRC定義の不整合、保存・再読込・UI選択）、Any展開の上限（初期値20、19・20件成功、21件超過、設定30で21件成功、部分結果を返さない、直積生成前の判定、極端に大きい直積の安全な拒否、Anyなしの解決に無影響）、Settings（旧設定への20補完と他項目維持、上限の保存・再読込、変更が次の解決へ反映、不正値の拒否、競合検出、Settings画面の未保存変更検出）、削除・変更されたVariable（有効なAnyの編集、Any対象外Variableの不整合表示と具体値への修正、削除されたVariableの検出・Draftからの除去・解消までの保存禁止・Revert、OverviewとMappingsの一致）、SRC検索・選択情報、Spreadsheet初期化（数式・範囲外・空白の保護、再実行、途中失敗）、起動時Settings復旧、Overviewからのマッピング状態表示・初回読込完了前の編集禁止・Game/Category登録・既存編集・競合表示・読込失敗時の詳細保持と再読込・レース切り替え確認・同一対象の編集維持・監視更新でのDraft維持・保存中の切り替え禁止、finish_timeの期間解析（時・分・秒・0秒・日・24時間以上・ナノ秒精度・`null`・不正文字列・負の期間・年/月/週の拒否・parse/serialize/再parseの等価性、HTTP境界での `invalid_payload`、`mapRace` での公開文字列化と `Temporal` 非混入、fetchRaceとwatchRaceの一致、完走していない参加者の `null` 維持、Dashboardの経過時間表示と小数秒精度）、Dashboardと公開APIの通信・編集ロック・競合復旧・単発取得表示・登録操作の競合、ビルド済みCommonJS拡張、ProtocolのESM/CommonJSを対象にする。

0.6.0の追加境界テストは、TimestampのUTC正規化・オフセット・null・ナノ秒精度・再解析の等価性、不正日付・タイムゾーンなし日時・不正Durationの拒否、開始前／進行中／終了／中止レース、新フィールドの必須性・型・人数の検証、完走経過時間と完走日時の区別、直接API／メッセージ／Replicantの一致、監視更新と不正応答時の正常スナップショット保持、Temporal非混入、SRCのLeaderboard／PBの時間・日付境界、複数アカウントPBのナノ秒比較・日単位の比較、5分キャッシュと期限切れ失敗時のstale、Dashboardのローカル日時・期間・null・説明のテキスト表示を対象にする。

`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`（17ファイル349件）、`pnpm build` はすべて成功。依存関係の追加はなく、0.6.0へのpackage.json更新によるlockfileの変更も不要。

2026-10-17にRaceTimeの公開API `races/data` と `/kh2fmr/powerful-knuckles-9844/data` を読み取り、開始前レースの新フィールドを確認した。opened_atはUTC日時、started_at／ended_at／cancelled_at／finished_atはnull、start_delayは `P0DT00H00M15S`、time_limitは `P1DT00H00M00S`、記録関連と制限時間処理はboolean、人数は整数だった。実APIの進行中・終了・中止状態は未確認であり、状態別の取得はfixtureによる境界テストで検証した。

未実施: 実NodeCG 2.8環境でのDashboard起動と公開APIとの実通信、実ADCによる対象Spreadsheetの読書き・初期化、実Speedrun.com API・実Player Manager v3を含む運用NodeCGでの通し確認、npmレジストリへのpublish。

## 既知の制限（今回のスコープ外）

- Level固有Variable: SRCのVariableは `scope`（`global` / `full-game` / `all-levels` / `single-level`、`single-level` は対象Level IDを持つ）を持ち、`GET /categories/{id}/variables` はカテゴリに適用されるVariable（per-levelカテゴリでは各Level向けの `single-level` を含む）を返す。現行実装は `scope`・`category` を取得せず、選択中 `levelId` とVariableのスコープを照合しない。この制限は具体的なValue選択にも共通し、Any導入で新たに生じたものではない。per-levelカテゴリでLevel固有Variableを扱う場合、解決結果が選択中Levelに対応しない可能性がある。Levelスコープの厳密な対応は今回のAny修正とは独立した機能拡張のため、本PRには含めない。

## 参照

- [RaceTime公式 Race model](https://github.com/racetimeGG/racetime-app/blob/master/racetime/models/race.py)
- [RaceTime公式API仕様](https://github.com/racetimeGG/racetime-app/wiki/Public-API-endpoints)
- [Speedrun.com公式API仕様](https://github.com/speedruncomorg/api)
- [ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
- [Player Manager公開Protocol](https://github.com/Nanahuse/player-manager/tree/v3.0.0/packages/player-manager-protocol)
