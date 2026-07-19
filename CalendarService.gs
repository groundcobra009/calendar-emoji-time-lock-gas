/**
 * Calendar Emoji Time Lock - カレンダー処理
 */

/** 設定されたカレンダーを取得し、読み取り可能であることを確認します。 */
function getTargetCalendar(calendarId) {
  var id = String(calendarId || '').trim();
  if (!id) {
    throw new Error('カレンダーIDを入力してください。');
  }

  try {
    var calendar = id === 'primary'
      ? CalendarApp.getDefaultCalendar()
      : CalendarApp.getCalendarById(id);
    if (!calendar) {
      throw new Error('指定したカレンダーが見つかりません。IDとアクセス権限を確認してください。');
    }

    // CalendarAppのCalendarクラスには権限ロール取得APIがないため、ここでは
    // 読み取りを確認し、書き込み権限は作成・削除時の例外で安全に検出します。
    calendar.getName();
    var now = new Date();
    calendar.getEvents(now, new Date(now.getTime() + 60000));
    return calendar;
  } catch (error) {
    console.error('カレンダー取得エラー（ID: ' + id + '）: ' + error.stack);
    if (/見つかりません/.test(error.message || '')) {
      throw error;
    }
    throw new Error('カレンダーを取得できませんでした。IDとアクセス権限を確認してください。');
  }
}

/**
 * 通常予定を再判定し、対象日にロック予定を作成します。
 * 同時実行による重複を防ぐため、ユーザーロックを使用します。
 */
function refreshCalendarLocks(operationName) {
  operationName = operationName || '手動再判定';
  var userLock = LockService.getUserLock();
  if (!userLock.tryLock(30000)) {
    throw new Error('別の再判定処理が実行中です。少し待ってから再度お試しください。');
  }

  try {
    var settings = getSettings();
    validateSettings(settings);
    var calendar = getTargetCalendar(settings.calendarId);
    var deletedCount = 0;

    if (settings.recreateExistingLocks) {
      deletedCount = deleteGeneratedLockEventsInternal_(calendar, settings);
    }

    var targetDates = findTargetDates(calendar, settings);
    var datesToCreate = targetDates;
    if (!settings.recreateExistingLocks) {
      var existingDateKeys = getExistingLockDateKeys_(calendar, settings);
      datesToCreate = targetDates.filter(function(date) {
        return !existingDateKeys[formatDateKey_(date)];
      });
    }
    var createdCount = 0;
    datesToCreate.forEach(function(date) {
      createLockEvent(calendar, date, settings);
      createdCount++;
    });

    var result = {
      success: true,
      message: '再判定が完了しました。',
      createdCount: createdCount,
      deletedCount: deletedCount,
      targetDays: targetDates.length,
      targetDateKeys: targetDates.map(formatDateKey_)
    };
    safeUpdateDashboard_(settings, result);
    safeLogOperation_(operationName, '成功', result, result.message);
    console.log('再判定結果: ' + JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('カレンダー再判定エラー: ' + error.stack);
    safeLogOperation_(operationName, '失敗', null, error.message || String(error));
    throw new Error(toUserMessage_(error, 'カレンダーの再判定に失敗しました。'));
  } finally {
    userLock.releaseLock();
  }
}

/** 再生成オフ時に、既存ロックと同じ日への重複作成を防ぎます。 */
function getExistingLockDateKeys_(calendar, settings) {
  var today = startOfDay_(new Date());
  var rangeEnd = addDays_(today, Number(settings.lookAheadDays) + 1);
  var events = calendar.getEvents(today, rangeEnd, { search: settings.lockEventTitle });
  var dateKeys = {};
  events.forEach(function(event) {
    if (isGeneratedLockEvent_(event, settings)) {
      dateKeys[formatDateKey_(event.getStartTime())] = true;
    }
  });
  return dateKeys;
}

/** 毎日の時間主導型トリガーから呼ばれる関数です。 */
function dailyRefreshCalendarLocks() {
  console.log('毎日のカレンダーロック再判定を開始します。');
  return refreshCalendarLocks('日次再判定');
}

/**
 * 今日から設定日数先までの予定を調べ、条件に合う日付の配列を返します。
 * 期間は「今日」と「N日後」をともに含みます。
 */
function findTargetDates(calendar, settings) {
  settings = settings || getSettings();
  calendar = calendar || getTargetCalendar(settings.calendarId);
  validateSettings(settings);

  var today = startOfDay_(new Date());
  var lastDay = addDays_(today, Number(settings.lookAheadDays));
  var rangeEnd = addDays_(lastDay, 1);
  var events = calendar.getEvents(today, rangeEnd);
  var dateMap = {};

  events.forEach(function(event) {
    if (isGeneratedLockEvent_(event, settings)) {
      return;
    }

    for (var date = new Date(today.getTime()); date <= lastDay; date = addDays_(date, 1)) {
      if (isTargetEvent(event, settings, date)) {
        dateMap[formatDateKey_(date)] = new Date(date.getTime());
      }
    }
  });

  return Object.keys(dateMap).sort().map(function(key) { return dateMap[key]; });
}

/** 1件の予定が指定日の判定条件を満たすか判定します。 */
function isTargetEvent(event, settings, targetDate) {
  if (!event || !settings) {
    return false;
  }
  if (isGeneratedLockEvent_(event, settings)) {
    return false;
  }
  if (String(event.getTitle() || '').indexOf(settings.targetEmoji) === -1) {
    return false;
  }

  var isAllDay = event.isAllDayEvent();
  if (isAllDay && !settings.includeAllDayEvents) {
    return false;
  }

  var day = targetDate ? startOfDay_(targetDate) : startOfDay_(event.getStartTime());
  if (isAllDay) {
    // 終日予定の終了日は排他的です。
    return event.getStartTime() < addDays_(day, 1) && event.getEndTime() > day;
  }

  var judgmentMinutes = parseTimeToMinutes_(settings.judgmentStartTime, false, '判定開始時刻');
  var judgmentStart = dateAtMinutes_(day, judgmentMinutes);
  var dayEnd = addDays_(day, 1);
  // 「18時以降に開始」も「18時をまたぐ」も、区間の重なりとして同じ式で扱えます。
  return event.getStartTime() < dayEnd && event.getEndTime() > judgmentStart;
}

/** 指定日に自動ロック予定を1件作成します。24:00は翌日0:00へ変換します。 */
function createLockEvent(calendar, targetDate, settings) {
  var startMinutes = parseTimeToMinutes_(settings.lockStartTime, false, 'ロック開始時刻');
  var endMinutes = parseTimeToMinutes_(settings.lockEndTime, true, 'ロック終了時刻');
  var start = dateAtMinutes_(targetDate, startMinutes);
  var end = endMinutes === 1440
    ? addDays_(startOfDay_(targetDate), 1)
    : dateAtMinutes_(targetDate, endMinutes);

  var event = calendar.createEvent(settings.lockEventTitle, start, end, {
    description: CEL_CONSTANTS.LOCK_DESCRIPTION
  });
  event.setTransparency(CalendarApp.EventTransparency.OPAQUE);
  return event;
}

/** UIから呼ぶ、自動生成ロック予定の安全な削除関数です。 */
function deleteGeneratedLockEvents() {
  try {
    var settings = getSettings();
    validateSettings(settings);
    var calendar = getTargetCalendar(settings.calendarId);
    var deletedCount = deleteGeneratedLockEventsInternal_(calendar, settings);
    var result = {
      success: true,
      message: '自動生成予定を削除しました。',
      createdCount: 0,
      deletedCount: deletedCount,
      targetDays: 0
    };
    safeLogOperation_('自動生成予定削除', '成功', result, result.message);
    return result;
  } catch (error) {
    console.error('自動生成予定の削除エラー: ' + error.stack);
    safeLogOperation_('自動生成予定削除', '失敗', null, error.message || String(error));
    throw new Error(toUserMessage_(error, '自動生成予定の削除に失敗しました。'));
  }
}

/** 名前の完全一致と説明欄の識別子の両方を満たす予定だけを削除します。 */
function deleteGeneratedLockEventsInternal_(calendar, settings) {
  // 過去分と将来分をまとめて掃除するため、十分広い期間を検索します。
  var searchStart = new Date(2000, 0, 1, 0, 0, 0, 0);
  var searchEnd = new Date(2101, 0, 1, 0, 0, 0, 0);
  var candidates = calendar.getEvents(searchStart, searchEnd, { search: settings.lockEventTitle });
  var deletedCount = 0;

  candidates.forEach(function(event) {
    if (isGeneratedLockEvent_(event, settings)) {
      event.deleteEvent();
      deletedCount++;
    }
  });
  console.log('自動生成予定の削除件数: ' + deletedCount);
  return deletedCount;
}

/** 自動生成予定かを、タイトルと説明欄の二重条件で確認します。 */
function isGeneratedLockEvent_(event, settings) {
  return event.getTitle() === settings.lockEventTitle &&
    String(event.getDescription() || '').indexOf(CEL_CONSTANTS.SYSTEM_EVENT_ID) !== -1;
}

function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays_(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function dateAtMinutes_(date, minutes) {
  var day = startOfDay_(date);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, CEL_CONSTANTS.TIME_ZONE, 'yyyy-MM-dd');
}
