# Dashboardの使い方

`RaceTime Integration`パネルはOverview / Mappings / Settingsの3つのタブで構成されます。画面上部には、監視中のレース数とPlayer Managerの状態を示すバッジが表示されます。

未保存の変更がある状態でタブを切り替えようとすると、「未保存の変更があります。破棄して移動しますか？」と確認されます。

## Overview

Overviewはレースの監視と、選択したレースの情報を扱う画面です。左側に監視一覧、右側にレース詳細を表示します。

### 監視を追加する

1. 左側の「URLで監視を追加」にRaceTimeのレースURLを入力します。
2. 「監視を追加」を押します。処理中はボタンが「追加中…」になります。

同じURLをすでに監視している場合は、新しく監視を開始せず、そのレースを選択します。監視を開始できたレースは自動的に選択されます。失敗した場合は、右側の上部にエラーが表示されます。

### 監視一覧

「監視中のレース」に、監視中のレースが並びます。各項目には次の情報が表示されます。

- レースID（未取得のときはURL）とレースタイマー
- `RaceTime: {status}`（未取得のときは「未取得」）
- `Connection: {connection} · E{participantsRevision}`

一覧のタイマーは選択していないレースも含めて1秒ごとに更新されます。項目をクリックするとレースを選択します。

### レースタイマー

選択したレースの詳細の先頭に「レースタイマー」が表示されます。状態に応じて「開始待ち」「カウントダウン」「進行中」「終了」「中止」「未取得」のいずれかのラベルと、10分の1秒精度の時計を表示します。

RaceTimeへの接続が`reconnecting`または`error`のときは、最新の状態と同期されていない可能性がある旨の注意が表示されます。

### レース情報

レースのスナップショットから、次の項目を表示します。

- `Race ID`、`Game / Goal`、`RaceTime status`、`Entrants`
- 作成日時、開始日時、終了日時、中止日時
- カウントダウン、制限時間
- レース説明
- 記録対象設定、記録可能状態、記録済み状態
- 完走人数、DNF / DQ人数
- 制限時間到達時の処理
- `Connection`、Matched / Unresolved / Unavailable、`Race revision`、`Participants revision`

日時は利用環境のローカルタイムゾーンで表示し、未設定の日時は「未設定」と表示します。スナップショットを取得できていない場合は「レース情報を取得できていません。」と表示します。

### イベントログ

「イベントログ」には監視中に受信したレース状態変化イベントが、受信時刻・イベント名・詳細の順で表示されます。イベント名は`raceStartScheduled`、`raceStarted`、`entrantFinished`、`entrantFinishUndone`、`raceCancelled`です。

- 表示するのは選択中のレースに属するイベントだけです。
- 保持件数はレースURLごとに最大100件で、古いものから破棄します。
- 履歴はDashboardを開いている間だけ保持します。Overviewを閉じる、または再読込すると失われます。
- 消去用のボタンはありません。

### Speedrun.comマッピング

「Speedrun.com マッピング」には選択中のレースに対応するGame MappingとCategory Mappingの要約が表示されます。未登録の場合は「未登録」と表示します。「編集」を押すと、この場でマッピングを編集できます。

Game MappingがないのにCategory Mappingを表示しようとすると、「Game Mappingが未登録のため不整合です。先にGame Mappingを登録してください。」と表示します。

マッピングの編集操作はMappingsタブと同じです。

### 参加者とPB

「参加者」にはRaceTimeの参加者と、Player Managerでの解決結果、Speedrun.comのPBを表示します。列はRaceTime / Player / SRC / Twitch / PB / 結果 / 状態です。

- 未解決（unresolved）の参加者には「登録・紐付け」ボタンがあります。押すとPlayer Managerの登録画面のURLを取得し、新しいタブで開きます。
- 解決済みの参加者には「編集 ↗」リンクがあり、Player Managerの編集画面を新しいタブで開きます。
- PBを再取得するには「PBを再取得」を押します。

PB列は、読み込み中は「取得中…」、取得失敗は「取得失敗」、未取得は「取得待ち」、記録なしは「記録なし」、未連携は「未連携」、古いキャッシュは「古いデータ」と表示します。

### Speedrun.com Leaderboard

選択中のレースのマッピングに基づき、条件別Leaderboardを表示します。「再取得」で最新の記録を取得します。

### 監視を停止する

詳細の「監視を停止」を押すと、確認ダイアログが開きます。確認して実行すると、そのレースの監視セッション全体を停止します。

この操作は共有監視セッション全体に適用されます。ほかのバンドルが保持しているwatchIdも無効になりますが、RaceTime上のレース自体は変更されません。

## Mappings

MappingsはRaceTimeとSpeedrun.comのマッピングを編集する画面です。左側にGame Mapping一覧と検索、右側に選択したゲームの詳細とCategory Mapping一覧を表示します。

### Game Mapping

- 「＋ 新規」で新しいGame Mappingを作成します。
- `RaceTime category slug（一意キー）`と`RaceTime category name（表示用）`を入力します。一意キーは作成後に変更できません。変更する場合は削除して登録し直します。
- SRCゲームは「Speedrun.com ゲーム（手動選択）」で検索し、検索結果から選びます。自動マッピングや候補の提案は行いません。
- 「Game Mappingを保存」で保存し、「削除」で削除します。

子Category Mappingがある場合は、SRCゲームの変更と削除ができません。

### Category Mapping

- ゲームを選択した状態で、Category Mappingsの「＋ 新規 Goal」から作成します。
- `RaceTime Goal`、`SRC Category（必須）`を指定します。
- per-levelカテゴリでは`Level`、そのほか必要に応じて`Platform`、`Region`、`Emulator`、`Timing Method`を指定します。
- Variablesはカテゴリの定義に従って値を選びます。`Any（すべて）`を選べるVariableでは、定義済みのすべての値を対象にできます。
- 「Category Mappingを保存」で保存し、「削除」で削除します。

### 競合の解決

マッピングが別の場所で更新されていると、保存時に競合が検出されます。この場合は「最新状態を採用」か「最新状態から再編集」を選びます。競合を解決するまで保存はできません。「最新状態から再編集」では、以前の入力内容が比較用に残ります。

### Variablesの検証

- 保存済みの`Any`が現在のSpeedrun.com定義で利用できない場合は、値を選び直すまで保存できません。
- Speedrun.comから削除されたVariableがある場合は、警告と「削除」ボタンが表示されます。下書きから削除するまで保存できません。
- PB区分を特定するVariableが未選択の場合は保存できません。

`Any`の詳細は[マッピング](mappings.md)を参照してください。

## Settings

SettingsはSpreadsheetの接続とRaceTimeの接続先を設定する画面です。

### Spreadsheet

- `Spreadsheet URL または ID`、`GameMappings シート名`、`CategoryMappings シート名`を入力します。
- `Any展開の最大件数`（初期値20）と`リーダーボード取得順位数`（初期値20）は、1以上の整数で入力します。
- 「保存」は入力内容を永続設定へ保存します。Spreadsheetの接続先を変更した場合は、両シートを検証できた場合だけ切り替えます。
- 「Spreadsheetを初期化」は、入力中のSpreadsheetに両シートを準備します。この操作は設定を保存しません。
- 接続状態バッジは保存時に両シートを検証できた場合だけ「利用可能」になります。

初期化と保存の順序は[導入と初期設定](getting-started.md)を参照してください。Google認証情報の入力は不要です（ADCを使用します）。

### RaceTime接続設定

監視できるRaceTimeの接続先（`allowedRaceOrigins`）を編集します。初期値は`https://racetime.gg`です。HTTPSのOriginと、`localhost`などのループバックHTTPを登録できます。追加・削除は「保存」で確定します。

## 誤解しやすい動作

- 「監視を停止」はそのレースの共有監視セッション全体を止めます。ほかのバンドルの監視も解除されます。
- イベントログは永続化されません。Overviewを閉じると失われます。
- 監視一覧のタイマーは選択していないレースも常に動作します。
- レース情報の更新や削除が外部で起きた場合、未保存のマッピング編集があると勝手に切り替わらず、確認が表示されます。
- 保存や再読込の実行中は、タブの切り替えとフォームの操作が禁止されます。
