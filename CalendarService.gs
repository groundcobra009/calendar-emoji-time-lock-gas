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

    var allStudyPlans = findStudySessionBufferPlans(calendar, settings);
    var studyPlans = allStudyPlans;
    if (!settings.recreateExistingLocks) {
      var existingStudyKeys = getExistingStudyBufferKeys_(calendar, settings);
      studyPlans = studyPlans.filter(function(plan) {
        return !existingStudyKeys[plan.key];
      });
    }

    var ruleCounts = {
      drinking: createdCount,
      onlineStudy: 0,
      offlineStudy: 0
    };
    var bufferDetails = [];
    studyPlans.forEach(function(plan) {
      createStudySessionBufferEvent(calendar, plan);
      createdCount++;
      if (plan.ruleId === CEL_CONSTANTS.STUDY_RULES.ONLINE.id) {
        ruleCounts.onlineStudy++;
      } else if (plan.ruleId === CEL_CONSTANTS.STUDY_RULES.OFFLINE.id) {
        ruleCounts.offlineStudy++;
      }
      bufferDetails.push({
        sourceTitle: plan.sourceTitle,
        ruleId: plan.ruleId,
        ruleLabel: plan.ruleLabel,
        phase: plan.phase,
        phaseLabel: plan.phaseLabel,
        start: Utilities.formatDate(plan.start, CEL_CONSTANTS.TIME_ZONE, 'yyyy-MM-dd HH:mm'),
        end: Utilities.formatDate(plan.end, CEL_CONSTANTS.TIME_ZONE, 'yyyy-MM-dd HH:mm')
      });
    });

    var allTargetDateKeys = {};
    targetDates.forEach(function(date) { allTargetDateKeys[formatDateKey_(date)] = true; });
    allStudyPlans.forEach(function(plan) { allTargetDateKeys[plan.sourceDateKey] = true; });
    var targetDateKeys = Object.keys(allTargetDateKeys).sort();

    var result = {
      success: true,
      message: '再判定が完了しました。',
      createdCount: createdCount,
      deletedCount: deletedCount,
      targetDays: targetDateKeys.length,
      targetDateKeys: targetDateKeys,
      ruleCounts: ruleCounts,
      bufferDetails: bufferDetails
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

/**
 * オンライン・オフライン勉強会を判定し、事前・事後バッファの作成計画を返します。
 */
function findStudySessionBufferPlans(calendar, settings) {
  settings = settings || getSettings();
  calendar = calendar || getTargetCalendar(settings.calendarId);
  validateSettings(settings);

  var today = startOfDay_(new Date());
  var rangeEnd = addDays_(today, Number(settings.lookAheadDays) + 1);
  var events = calendar.getEvents(today, rangeEnd);
  var plans = [];

  events.forEach(function(event) {
    var rule = classifyStudySessionEvent_(event, settings);
    if (!rule) {
      return;
    }

    var sourceId = getSourceEventId_(event);
    var sourceStart = event.getStartTime();
    var sourceEnd = event.getEndTime();
    var sourceStartIso = sourceStart.toISOString();
    var sourceDateKey = formatDateKey_(sourceStart);
    var beforeHours = Number(rule.beforeHours);
    var afterHours = Number(rule.afterHours);

    if (beforeHours > 0) {
      plans.push(buildStudyBufferPlan_(
        rule,
        'BEFORE',
        '事前',
        new Date(sourceStart.getTime() - beforeHours * 60 * 60 * 1000),
        new Date(sourceStart.getTime()),
        event.getTitle(),
        sourceId,
        sourceStartIso,
        sourceDateKey
      ));
    }
    if (afterHours > 0) {
      plans.push(buildStudyBufferPlan_(
        rule,
        'AFTER',
        '事後',
        new Date(sourceEnd.getTime()),
        new Date(sourceEnd.getTime() + afterHours * 60 * 60 * 1000),
        event.getTitle(),
        sourceId,
        sourceStartIso,
        sourceDateKey
      ));
    }
  });

  return plans;
}

/** 予定名と設定から勉強会ルールを1種類だけ返します。 */
function classifyStudySessionEvent_(event, settings) {
  if (!event || isGeneratedLockEvent_(event, settings)) {
    return null;
  }
  if (event.isAllDayEvent() && !settings.includeAllDayEvents) {
    return null;
  }

  var title = String(event.getTitle() || '');
  // 両方の文字列を含む場合は、移動時間を想定したオフライン設定を優先します。
  if (settings.offlineStudyEnabled && title.indexOf(settings.offlineStudyMarker) !== -1) {
    return {
      id: CEL_CONSTANTS.STUDY_RULES.OFFLINE.id,
      label: CEL_CONSTANTS.STUDY_RULES.OFFLINE.label,
      beforeTitle: CEL_CONSTANTS.STUDY_RULES.OFFLINE.beforeTitle,
      afterTitle: CEL_CONSTANTS.STUDY_RULES.OFFLINE.afterTitle,
      beforeHours: settings.offlineStudyBeforeHours,
      afterHours: settings.offlineStudyAfterHours
    };
  }
  if (settings.onlineStudyEnabled && title.indexOf(settings.onlineStudyMarker) !== -1) {
    return {
      id: CEL_CONSTANTS.STUDY_RULES.ONLINE.id,
      label: CEL_CONSTANTS.STUDY_RULES.ONLINE.label,
      beforeTitle: CEL_CONSTANTS.STUDY_RULES.ONLINE.beforeTitle,
      afterTitle: CEL_CONSTANTS.STUDY_RULES.ONLINE.afterTitle,
      beforeHours: settings.onlineStudyBeforeHours,
      afterHours: settings.onlineStudyAfterHours
    };
  }
  return null;
}

/** 前後バッファの作成計画を共通形式へ整えます。 */
function buildStudyBufferPlan_(rule, phase, phaseLabel, start, end, sourceTitle, sourceId, sourceStartIso, sourceDateKey) {
  return {
    key: buildStudyBufferKey_(rule.id, phase, sourceId, sourceStartIso),
    title: phase === 'BEFORE' ? rule.beforeTitle : rule.afterTitle,
    ruleId: rule.id,
    ruleLabel: rule.label,
    phase: phase,
    phaseLabel: phaseLabel,
    start: start,
    end: end,
    sourceTitle: sourceTitle,
    sourceId: sourceId,
    sourceStartIso: sourceStartIso,
    sourceDateKey: sourceDateKey
  };
}

/** 勉強会の前後バッファ予定を作成します。 */
function createStudySessionBufferEvent(calendar, plan) {
  var description = [
    'この予定はCalendar Emoji Time Lockにより自動生成されました。',
    CEL_CONSTANTS.SYSTEM_EVENT_ID,
    'BUFFER_RULE: ' + plan.ruleId,
    'BUFFER_PHASE: ' + plan.phase,
    'SOURCE_EVENT_ID: ' + plan.sourceId,
    'SOURCE_EVENT_START: ' + plan.sourceStartIso,
    'SOURCE_EVENT_TITLE: ' + plan.sourceTitle,
    '手動で編集せず、設定画面から変更してください。'
  ].join('\n');
  var event = calendar.createEvent(plan.title, plan.start, plan.end, { description: description });
  event.setTransparency(CalendarApp.EventTransparency.OPAQUE);
  return event;
}

/** 再生成オフ時に勉強会バッファの重複作成を防ぎます。 */
function getExistingStudyBufferKeys_(calendar, settings) {
  var today = startOfDay_(new Date());
  var events = calendar.getEvents(
    addDays_(today, -1),
    addDays_(today, Number(settings.lookAheadDays) + 2)
  );
  var keys = {};
  events.forEach(function(event) {
    if (!isStudyBufferEvent_(event)) {
      return;
    }
    var description = String(event.getDescription() || '');
    var ruleId = extractMetadataValue_(description, 'BUFFER_RULE');
    var phase = extractMetadataValue_(description, 'BUFFER_PHASE');
    var sourceId = extractMetadataValue_(description, 'SOURCE_EVENT_ID');
    var sourceStartIso = extractMetadataValue_(description, 'SOURCE_EVENT_START');
    if (ruleId && phase && sourceId && sourceStartIso) {
      keys[buildStudyBufferKey_(ruleId, phase, sourceId, sourceStartIso)] = true;
    }
  });
  return keys;
}

function buildStudyBufferKey_(ruleId, phase, sourceId, sourceStartIso) {
  return [ruleId, phase, sourceId, sourceStartIso].join('|');
}

function getSourceEventId_(event) {
  if (typeof event.getId === 'function' && event.getId()) {
    return event.getId();
  }
  return [event.getTitle(), event.getStartTime().toISOString(), event.getEndTime().toISOString()].join('|');
}

function extractMetadataValue_(description, key) {
  var match = String(description || '').match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
  return match ? match[1].trim() : '';
}

/** 再生成オフ時に、既存ロックと同じ日への重複作成を防ぎます。 */
function getExistingLockDateKeys_(calendar, settings) {
  var today = startOfDay_(new Date());
  var rangeEnd = addDays_(today, Number(settings.lookAheadDays) + 1);
  var events = calendar.getEvents(today, rangeEnd, { search: settings.lockEventTitle });
  var dateKeys = {};
  events.forEach(function(event) {
    if (isLegacyGeneratedLockEvent_(event, settings)) {
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
  var titles = getGeneratedEventTitles_(settings);
  var candidateMap = {};
  titles.forEach(function(title) {
    calendar.getEvents(searchStart, searchEnd, { search: title }).forEach(function(event) {
      var candidateKey = getSourceEventId_(event) + '|' + event.getStartTime().toISOString();
      candidateMap[candidateKey] = event;
    });
  });
  var candidates = Object.keys(candidateMap).map(function(key) { return candidateMap[key]; });
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
  var title = event.getTitle();
  return getGeneratedEventTitles_(settings).indexOf(title) !== -1 &&
    String(event.getDescription() || '').indexOf(CEL_CONSTANTS.SYSTEM_EVENT_ID) !== -1;
}

function isLegacyGeneratedLockEvent_(event, settings) {
  return event.getTitle() === settings.lockEventTitle &&
    String(event.getDescription() || '').indexOf(CEL_CONSTANTS.SYSTEM_EVENT_ID) !== -1;
}

function isStudyBufferEvent_(event) {
  var description = String(event.getDescription() || '');
  var studyTitles = [
    CEL_CONSTANTS.STUDY_RULES.ONLINE.beforeTitle,
    CEL_CONSTANTS.STUDY_RULES.ONLINE.afterTitle,
    CEL_CONSTANTS.STUDY_RULES.OFFLINE.beforeTitle,
    CEL_CONSTANTS.STUDY_RULES.OFFLINE.afterTitle
  ];
  return studyTitles.indexOf(event.getTitle()) !== -1 &&
    description.indexOf(CEL_CONSTANTS.SYSTEM_EVENT_ID) !== -1 &&
    description.indexOf('BUFFER_RULE:') !== -1;
}

function getGeneratedEventTitles_(settings) {
  return [
    settings.lockEventTitle,
    CEL_CONSTANTS.STUDY_RULES.ONLINE.beforeTitle,
    CEL_CONSTANTS.STUDY_RULES.ONLINE.afterTitle,
    CEL_CONSTANTS.STUDY_RULES.OFFLINE.beforeTitle,
    CEL_CONSTANTS.STUDY_RULES.OFFLINE.afterTitle
  ];
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
