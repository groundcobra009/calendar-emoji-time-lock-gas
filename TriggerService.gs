/** Calendar Emoji Time Lock - トリガー管理 */

/** 設定時刻付近に毎日実行するトリガーを、重複しないよう作成します。 */
function createDailyTrigger() {
  try {
    var settings = getSettings();
    validateSettings(settings);
    rememberActiveSpreadsheet_();
    var triggerMinutes = parseTimeToMinutes_(settings.dailyTriggerTime, false, '毎日実行時刻');
    var triggerHour = Math.floor(triggerMinutes / 60);
    var triggerMinute = triggerMinutes % 60;
    var deletedCount = deleteDailyTriggers();
    ScriptApp.newTrigger(CEL_CONSTANTS.DAILY_FUNCTION_NAME)
      .timeBased()
      .atHour(triggerHour)
      .nearMinute(triggerMinute)
      .everyDays(1)
      .inTimezone(CEL_CONSTANTS.TIME_ZONE)
      .create();

    console.log('毎日実行トリガーを作成しました。設定時刻: ' + settings.dailyTriggerTime + '、既存削除数: ' + deletedCount);
    var result = {
      success: true,
      message: '毎日' + settings.dailyTriggerTime + '頃（前後約15分）に実行するトリガーを設定しました。',
      createdCount: 1,
      deletedCount: deletedCount,
      targetDays: 0
    };
    safeLogOperation_('トリガー設定', '成功', result, '設定時刻: ' + settings.dailyTriggerTime);
    return result;
  } catch (error) {
    console.error('トリガー作成エラー: ' + error.stack);
    safeLogOperation_('トリガー設定', '失敗', null, error.message || String(error));
    throw new Error('毎日実行トリガーの作成に失敗しました。権限を確認して、もう一度お試しください。');
  }
}

/** dailyRefreshCalendarLocks に紐づくトリガーだけを削除します。 */
function deleteDailyTriggers() {
  var deletedCount = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === CEL_CONSTANTS.DAILY_FUNCTION_NAME) {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });
  return deletedCount;
}
