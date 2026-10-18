# 導入と初期設定

このページではracetime-integrationをNodeCGに配置してレースの監視を始めるまでの手順を説明します。導入はGoogle Sheetsを必要としない基本セットアップと、Speedrun.comの記録を扱う場合だけ行う追加セットアップに分かれます。

## 前提

- NodeCG 2.8
- Node.js 24
- pnpm 12.9.1
- Player Manager 3.xを同じNodeCGに配置

## 基本セットアップ

Google Sheetsを設定しなくても、レースの監視と参加者の解決は利用できます。

1. このリポジトリをNodeCGの`bundles/racetime-integration`に配置します。
2. バンドルのディレクトリで依存関係をインストールします。

   ```sh
   pnpm install --frozen-lockfile
   ```

3. ビルドします。ExtensionのCommonJSとDashboardが生成されます。

   ```sh
   pnpm build
   ```

4. Player Manager（`player-manager`）を同じNodeCGの`bundles`に配置します。racetime-integrationは`bundleDependencies`でPlayer Managerの読込み順を指定しています。
5. NodeCG本体のディレクトリへ移動して起動します。`pnpm install`と`pnpm build`はバンドルのディレクトリで実行しますが、`nodecg start`はNodeCG本体のディレクトリで実行します。

   ```sh
   nodecg start
   ```

6. Dashboardを開き、`RaceTime Integration`パネルを表示します。

### 動作確認

1. `Overview`タブの「URLで監視を追加」にRaceTimeのレースURLを入力し、「監視を追加」を押します。
2. 監視一覧にレースが追加され、レース詳細とタイマーが表示されることを確認します。
3. 画面上部のPlayer Managerバッジが`Ready`になっていることを確認します。

### うまくいかないとき

- Player Managerバッジが`Unavailable`や`Error`: Player Managerが`bundles`に配置されているか、対応バージョン（3.x）かを確認してください。racetime-integrationは起動していても、Player Managerが無いと参加者を解決できません。
- 「監視を追加」でエラーになる: 接続先が許可されていない可能性があります。`allowedRaceOrigins`（後述）にそのOriginを追加してください。標準では`https://racetime.gg`だけが許可されています。
- `nodecg start`が見つからない、または何も起きない: `nodecg start`はNodeCG本体のディレクトリで実行してください。バンドルのディレクトリで実行しても起動しません。

## 設定の保存場所

設定は2か所に分かれます。役割を混同しないようにしてください。

- `cfg/racetime-integration.json`: NodeCGのバンドル設定です。初回起動時の初期値として使います。指定できるのは`spreadsheetId`、`gameMappingsSheet`、`categoryMappingsSheet`だけです。
- DashboardのSettings画面が管理する永続設定（`racetime-settings` Replicant）: `spreadsheetId`、`gameMappingsSheet`、`categoryMappingsSheet`、`allowedRaceOrigins`、`maxResolvedMappings`、`leaderboardTop`を保持します。

保存された永続設定がある場合、次回起動時はそちらが優先され、`cfg`の値は使われません。`cfg`は保存設定がまだ無いときの初期値です。

### cfg/racetime-integration.jsonの例

```json
{
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "gameMappingsSheet": "GameMappings",
  "categoryMappingsSheet": "CategoryMappings"
}
```

`gameMappingsSheet`と`categoryMappingsSheet`の初期値はそれぞれ`GameMappings`と`CategoryMappings`です。

## RaceTime接続先

監視できるRaceTimeの接続先は`allowedRaceOrigins`で管理します。初期値は`https://racetime.gg`です。自ホストのRaceTimeを使う場合は、Settings画面の「RaceTime接続設定」で接続先を追加して保存してください。

- HTTPSのOriginを登録できます。
- HTTPは`localhost`、`127.0.0.1`、`[::1]`のループバックに限ります。
- Originにはパス、クエリ、フラグメント、認証情報を指定できません。
- `localhost`はブラウザーではなく、NodeCG Extensionが動作している環境を指します。

## 追加セットアップ: Speedrun.com連携

Speedrun.comのLeaderboardや参加者のPBを取得する場合だけ、次の設定を行います。レースの監視だけを使う場合は不要です。

### 1. Google Sheets APIを有効にする

Google CloudのプロジェクトでGoogle Sheets APIを有効にします。

### 2. 認証情報を用意する

racetime-integrationは[Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)（ADC）でGoogleへ認証します。必要なスコープは`https://www.googleapis.com/auth/spreadsheets`です。資格情報ファイルを指定する専用の設定はなく、ADCの標準的な方法で用意します。

**サービスアカウントを使う場合**

1. Google Cloudでサービスアカウントを作成し、JSON鍵をダウンロードします。
2. `GOOGLE_APPLICATION_CREDENTIALS`にJSON鍵のファイルパスを設定します。この環境変数は、NodeCGを起動するプロセスから参照できる必要があります。NodeCGをサービスや別ユーザーで起動している場合は、その環境に合わせて設定してください。
3. サービスアカウントのメールアドレスに、対象Spreadsheetの編集権限を付与します。
4. JSON鍵は認証情報そのものです。Gitへコミットしないでください。

**ユーザーアカウントを使う場合**

`gcloud auth application-default login`でログインします。このコマンドが既定で要求するスコープは`openid`、`userinfo.email`、`https://www.googleapis.com/auth/cloud-platform`、`https://www.googleapis.com/auth/sqlservice.login`です。`cloud-platform`はGoogle Cloudのスコープで、Google Sheetsへのアクセスに必要なSheets用スコープは含まれません。

Sheetsを扱うには、Sheets用のスコープを`--scopes`で明示します。Google Cloud外のサービス（SheetsやDrive）のスコープを要求する場合、GoogleはOAuthクライアントIDを作成し、`--client-id-file`で渡す方法を案内しています。

```sh
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform \
  --client-id-file=clientid.json
```

`clientid.json`は、Google Cloud Consoleで作成したOAuthクライアント（デスクトップアプリ）のクライアントIDです。`--scopes`と`--client-id-file`の詳細は[gcloud auth application-default loginのリファレンス](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/login)を、ADCの仕組みは[ADCのドキュメント](https://docs.cloud.google.com/docs/authentication/application-default-credentials)を参照してください。

### 3. Spreadsheetを準備する

DashboardのSettings画面で、Spreadsheet URLまたはIDと両シート名を入力し、次の順に操作します。

1. 「Spreadsheetを初期化」で、`GameMappings`と`CategoryMappings`のワークシートを準備します。不足シートは作成し、空のシートにはヘッダーを書き込みます。この操作は設定を保存しません。
2. 「保存」で接続を確定します。接続先を変更した場合は、保存時に両シートを読み込んで検証できた場合だけ切り替わります。

### 4. マッピングを登録する

RaceTimeのカテゴリ・GoalとSpeedrun.comのゲーム・カテゴリを対応付けます。手順と具体例は[マッピング](mappings.md)を参照してください。

### うまくいかないとき

- 保存時に接続できない（`spreadsheet_unavailable`）: 認証方式に応じて確認します。
  - サービスアカウント: `GOOGLE_APPLICATION_CREDENTIALS`がNodeCGの起動プロセスから参照できるか、対象Spreadsheetへの編集権限があるかを確認してください。
  - ユーザーアカウント: `gcloud auth application-default login`で`https://www.googleapis.com/auth/spreadsheets`スコープを付与したか、対象Spreadsheetへのアクセス権があるかを確認してください。この方式では`GOOGLE_APPLICATION_CREDENTIALS`を設定しないでください。
  - いずれの場合も、Google Sheets APIが有効になっているかを確認してください。
- シート形式が不正（`invalid_sheet`）: 既存シートに想定と異なる内容があると初期化が中止されます。シートを空にするか、想定どおりのヘッダーにそろえてから、もう一度初期化してください。
- LeaderboardやPBが取得できない: マッピングが未登録の場合はLeaderboardとPBを取得できません。まずマッピングを登録してください。

シートの列構成は[マッピング](mappings.md)を参照してください。

## 次の手順

- 監視や設定の操作は[Dashboardの使い方](dashboard.md)を参照してください。
- ほかのバンドルからの利用は[公開API](../packages/racetime-protocol/README.md)を参照してください。
