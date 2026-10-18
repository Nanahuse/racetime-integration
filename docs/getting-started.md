# 導入と初期設定

このページではracetime-integrationをNodeCGに配置して動かすまでの手順を説明します。Google SheetsとSpeedrun.com連携は任意です。使用しない場合でもレースの監視と参加者の解決は利用できます。

## 前提

- NodeCG 2.8
- Node.js 24
- pnpm 12.9.1
- Player Manager 3.0.0以上を同じNodeCGに配置

## 配置とビルド

1. このリポジトリをNodeCGの`bundles/racetime-integration`に配置します。
2. バンドルのディレクトリで依存関係をインストールします。

   ```sh
   pnpm install --frozen-lockfile
   ```

3. ビルドします。ExtensionのCommonJSとDashboardが生成されます。

   ```sh
   pnpm build
   ```

4. Player Manager（`player-manager`）を同じNodeCGの`bundles`に配置します。`racetime-integration`は`bundleDependencies`でPlayer Managerの読込み順を指定しています。

5. NodeCGを起動します。

   ```sh
   nodecg start
   ```

Dashboardを開くと、`RaceTime Integration`パネルが表示されます。

## 初期設定の考え方

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

## Google Sheets（任意）

マッピングを保存する場合は、次の順に準備します。

1. Google CloudでGoogle Sheets APIを有効にします。
2. Application Default Credentials（ADC）で使うアカウントに、対象Spreadsheetの編集権限を付与します。
3. 認証は[Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)を使います。スコープは`https://www.googleapis.com/auth/spreadsheets`です。資格情報ファイルを指定する設定はありません。

### 初期化と保存の違い

DashboardのSettings画面では、「Spreadsheetを初期化」と「保存」は別の操作です。

- **Spreadsheetを初期化**: 入力中のSpreadsheetへ`GameMappings`と`CategoryMappings`のワークシートを準備します。不足シートは作成し、空のシートにはヘッダーを書き込みます。設定は保存せず、`settingsRevision`も変更しません。
- **保存**: 入力内容を永続設定へ保存します。Spreadsheetの接続先を変更した場合は、保存時に両シートを読み込んで検証できた場合だけ切り替えます。

新しいSpreadsheetを使い始めるときは、次を順に行います。

1. Settings画面でSpreadsheet URLまたはID、両シート名を入力します。
2. 「Spreadsheetを初期化」でシートを準備します。
3. 「保存」で接続を確定します。

Spreadsheetを設定しない（`spreadsheetId`を空にする）と、マッピング機能は無効になります。Sheets未設定でもレース機能は利用できます。

シートの列構成とマッピングの詳細は[マッピング](mappings.md)を参照してください。

## 動作確認

1. Dashboardの`Overview`タブを開きます。
2. 「URLで監視を追加」にRaceTimeのレースURLを入力し、「監視を追加」を押します。
3. 監視一覧にレースが表示され、レース詳細とタイマーが表示されることを確認します。
4. 画面上部のPlayer Managerバッジが`Ready`になっていることを確認します。`Unavailable`や`Error`の場合はPlayer Managerの配置と起動を確認してください。

Google Sheetsを設定した場合は、Settingsタブの接続状態が「利用可能」になっていることも確認します。
