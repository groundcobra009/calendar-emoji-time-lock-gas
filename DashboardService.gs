/**
 * Calendar Emoji Time Lock - ダッシュボードと操作ログ
 * シート出力の失敗がカレンダー処理を妨げないよう、安全ラッパーを用意します。
 */

/** 現在のスプレッドシートIDを、時間主導トリガー用に保存します。 */
function rememberActiveSpreadsheet_() {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet) {
      PropertiesService.getUserProperties().setProperty(
        CEL_CONSTANTS.SPREADSHEET_ID_PROPERTY_KEY,
        spreadsheet.getId()
      );
    }
    return spreadsheet;
  } catch (error) {
    console.error('スプレッドシートIDの保存に失敗しました: ' + error.stack);
    return null;
  }
}

/** UI実行時と時間主導トリガー実行時の両方で対象シートを取得します。 */
function getOperationSpreadsheet_() {
  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    rememberActiveSpreadsheet_();
    return activeSpreadsheet;
  }

  var spreadsheetId = PropertiesService.getUserProperties().getProperty(
    CEL_CONSTANTS.SPREADSHEET_ID_PROPERTY_KEY
  );
  if (!spreadsheetId) {
    throw new Error('ログ出力先のスプレッドシートが未登録です。設定サイドバーを一度開いてください。');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

/** ログシートを取得し、存在しなければヘッダー付きで作成します。 */
function ensureLogSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(CEL_CONSTANTS.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CEL_CONSTANTS.LOG_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    var headers = ['実行日時', '操作', '状態', '作成件数', '削除件数', '対象日数', '詳細', '実行ユーザー'];
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#1F3F8E')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 140);
    sheet.setColumnWidth(3, 80);
    sheet.setColumnWidths(4, 3, 90);
    sheet.setColumnWidth(7, 360);
    sheet.setColumnWidth(8, 220);
    sheet.setTabColor('#1F3F8E');
  }
  return sheet;
}

/** 操作ログを1行追記します。 */
function appendOperationLog_(operation, status, result, detail) {
  var spreadsheet = getOperationSpreadsheet_();
  var sheet = ensureLogSheet_(spreadsheet);
  var userEmail = '';
  try {
    userEmail = Session.getEffectiveUser().getEmail() || '';
  } catch (error) {
    console.log('実行ユーザーのメールアドレスを取得できませんでした。');
  }

  result = result || {};
  sheet.appendRow([
    Utilities.formatDate(new Date(), CEL_CONSTANTS.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss'),
    operation,
    status,
    Number(result.createdCount || 0),
    Number(result.deletedCount || 0),
    Number(result.targetDays || 0),
    String(detail || result.message || ''),
    userEmail
  ]);

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(lastRow, 1, 1, 8).setVerticalAlignment('top');
    if (status === '失敗') {
      sheet.getRange(lastRow, 3).setFontColor('#C81E2F').setFontWeight('bold');
    }
  }
}

/** ログ失敗を本体処理へ波及させない安全ラッパーです。 */
function safeLogOperation_(operation, status, result, detail) {
  try {
    appendOperationLog_(operation, status, result, detail);
  } catch (error) {
    console.error('操作ログの記録に失敗しました: ' + error.stack);
  }
}

/** ダッシュボードシートを取得し、存在しなければ作成します。 */
function ensureDashboardSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(CEL_CONSTANTS.DASHBOARD_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CEL_CONSTANTS.DASHBOARD_SHEET_NAME);
    sheet.getRange('A1:D1').merge().setValue('Calendar Emoji Time Lock｜運用ダッシュボード');
    sheet.getRange('A3').setValue('「今すぐ再判定」を実行すると、ここに最新結果が表示されます。');
    sheet.setTabColor('#1F3F8E');
  }
  return sheet;
}

/** 最新の再判定結果をダッシュボードへ反映します。 */
function updateDashboard_(settings, result) {
  var spreadsheet = getOperationSpreadsheet_();
  var sheet = ensureDashboardSheet_(spreadsheet);
  var targetDateKeys = result.targetDateKeys || [];
  var weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  var weekdayCounts = [0, 0, 0, 0, 0, 0, 0];

  targetDateKeys.forEach(function(dateKey) {
    var parts = dateKey.split('-').map(Number);
    weekdayCounts[new Date(parts[0], parts[1] - 1, parts[2]).getDay()]++;
  });

  sheet.clearContents();
  sheet.getCharts().forEach(function(chart) { sheet.removeChart(chart); });
  sheet.getRange('A1:D1').breakApart().merge()
    .setValue('Calendar Emoji Time Lock｜運用ダッシュボード')
    .setBackground('#1F3F8E')
    .setFontColor('#FFFFFF')
    .setFontSize(16)
    .setFontWeight('bold')
    .setHorizontalAlignment('left');

  sheet.getRange('A3:B6').setValues([
    ['最終実行', Utilities.formatDate(new Date(), CEL_CONSTANTS.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss')],
    ['作成件数', Number(result.createdCount || 0)],
    ['削除件数', Number(result.deletedCount || 0)],
    ['対象日数', Number(result.targetDays || 0)]
  ]);
  sheet.getRange('D3:E7').setValues([
    ['判定絵文字', settings.targetEmoji],
    ['判定開始', settings.judgmentStartTime],
    ['ロック時間', settings.lockStartTime + '〜' + settings.lockEndTime],
    ['判定期間', settings.lookAheadDays + '日先まで'],
    ['日次実行', settings.dailyTriggerTime + '頃']
  ]);

  sheet.getRange('A8:D8').setValues([['対象日', '状態', 'ロック時間', '判定絵文字']]);
  if (targetDateKeys.length > 0) {
    sheet.getRange(9, 1, targetDateKeys.length, 4).setValues(targetDateKeys.map(function(dateKey) {
      return [dateKey, 'ロック対象', settings.lockStartTime + '〜' + settings.lockEndTime, settings.targetEmoji];
    }));
  } else {
    sheet.getRange('A9').setValue('対象日はありません。');
  }

  var weekdayRows = [['曜日', '対象日数']];
  weekdayLabels.forEach(function(label, index) {
    weekdayRows.push([label + '曜日', weekdayCounts[index]]);
  });
  sheet.getRange(8, 6, weekdayRows.length, 2).setValues(weekdayRows);

  sheet.getRange('A3:A6').setFontWeight('bold').setBackground('#EEF2FA');
  sheet.getRange('D3:D7').setFontWeight('bold').setBackground('#EEF2FA');
  sheet.getRange('A8:D8').setBackground('#1F3F8E').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange('F8:G8').setBackground('#1F3F8E').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 130);
  sheet.setColumnWidths(6, 2, 100);
  sheet.setTabColor('#1F3F8E');

  var chart = sheet.newChart()
    .asColumnChart()
    .addRange(sheet.getRange('F8:G15'))
    .setNumHeaders(1)
    .setPosition(8, 9, 0, 0)
    .setOption('title', '曜日別のロック対象日数')
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1F3F8E'])
    .setOption('backgroundColor', '#FFFFFF')
    .build();
  sheet.insertChart(chart);
  return sheet;
}

/** ダッシュボード失敗を本体処理へ波及させない安全ラッパーです。 */
function safeUpdateDashboard_(settings, result) {
  try {
    updateDashboard_(settings, result);
  } catch (error) {
    console.error('ダッシュボードの更新に失敗しました: ' + error.stack);
    safeLogOperation_('ダッシュボード更新', '失敗', result, error.message || String(error));
  }
}
