/** Calendar Emoji Time Lock - トリガー管理 */

/** 毎日午前3時台に実行するトリガーを、重複しないよう作成します。 */
function createDailyTrigger() {
  try {
    var deletedCount = deleteDailyTriggers();
    ScriptApp.newTrigger(CEL_CONSTANTS.DAILY_FUNCTION_NAME)
      .timeBased()
      .atHour(3)
      .everyDays(1)
      .inTimezone(CEL_CONSTANTS.TIME_ZONE)
      .create();

    console.log('毎日実行トリガーを作成しました。既存削除数: ' + deletedCount);
    return {
      success: true,
      message: '毎日午前3時から4時の間に実行するトリガーを設定しました。',
      createdCount: 1,
      deletedCount: deletedCount,
      targetDays: 0
    };
  } catch (error) {
    console.error('トリガー作成エラー: ' + error.stack);
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
