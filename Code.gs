/** Calendar Emoji Time Lock - エントリーポイントとスプレッドシートUI */

/** スプレッドシートを開いたときにカスタムメニューを追加します。 */
function onOpen() {
  rememberActiveSpreadsheet_();
  SpreadsheetApp.getUi()
    .createMenu('カレンダーロック')
    .addItem('設定・操作パネルを開く', 'showSidebar')
    .addItem('ダッシュボードを開く', 'showDashboard')
    .addToUi();
}

/** 設定サイドバーを表示します。 */
function showSidebar() {
  rememberActiveSpreadsheet_();
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('カレンダーロック設定');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** ダッシュボードシートを作成または表示します。 */
function showDashboard() {
  try {
    var spreadsheet = getOperationSpreadsheet_();
    var sheet = ensureDashboardSheet_(spreadsheet);
    spreadsheet.setActiveSheet(sheet);
    return { success: true, message: 'ダッシュボードを表示しました。' };
  } catch (error) {
    console.error('ダッシュボード表示エラー: ' + error.stack);
    throw new Error(toUserMessage_(error, 'ダッシュボードを表示できませんでした。'));
  }
}

/** ログシートを作成または表示します。 */
function showLogSheet() {
  try {
    var spreadsheet = getOperationSpreadsheet_();
    var sheet = ensureLogSheet_(spreadsheet);
    spreadsheet.setActiveSheet(sheet);
    return { success: true, message: 'ログシートを表示しました。' };
  } catch (error) {
    console.error('ログシート表示エラー: ' + error.stack);
    throw new Error(toUserMessage_(error, 'ログシートを表示できませんでした。'));
  }
}

/** 分割したHTML/CSS/JavaScriptをテンプレートへ読み込みます。 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
