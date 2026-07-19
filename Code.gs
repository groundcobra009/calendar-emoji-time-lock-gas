/** Calendar Emoji Time Lock - エントリーポイントとスプレッドシートUI */

/** スプレッドシートを開いたときにカスタムメニューを追加します。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('カレンダーロック')
    .addItem('設定を開く', 'showSidebar')
    .addSeparator()
    .addItem('今すぐ再判定', 'refreshCalendarLocksFromMenu_')
    .addItem('ダミーデータを作成', 'generateDummyEventsFromMenu_')
    .addItem('ダミーデータを削除', 'deleteDummyEventsFromMenu_')
    .addItem('自動生成予定を削除', 'deleteGeneratedLockEventsFromMenu_')
    .addSeparator()
    .addItem('毎日実行トリガーを設定', 'createDailyTriggerFromMenu_')
    .addToUi();
}

/** 設定サイドバーを表示します。 */
function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('カレンダーロック設定');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** 分割したHTML/CSS/JavaScriptをテンプレートへ読み込みます。 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function refreshCalendarLocksFromMenu_() {
  runMenuAction_(refreshCalendarLocks);
}

function generateDummyEventsFromMenu_() {
  runMenuAction_(generateDummyEvents);
}

function deleteDummyEventsFromMenu_() {
  runMenuAction_(deleteDummyEvents);
}

function deleteGeneratedLockEventsFromMenu_() {
  runMenuAction_(deleteGeneratedLockEvents);
}

function createDailyTriggerFromMenu_() {
  runMenuAction_(createDailyTrigger);
}

/** メニュー操作の結果をスプレッドシート右下の通知に表示します。 */
function runMenuAction_(action) {
  try {
    var result = action();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      result.message + ' 作成: ' + (result.createdCount || 0) + '件 / 削除: ' + (result.deletedCount || 0) + '件',
      'カレンダーロック',
      8
    );
  } catch (error) {
    console.error('メニュー操作エラー: ' + error.stack);
    SpreadsheetApp.getUi().alert('エラー', error.message || '処理に失敗しました。', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
