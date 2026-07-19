/**
 * Calendar Emoji Time Lock - 設定管理
 * 設定は実行ユーザーごとに UserProperties へ保存します。
 */

var CEL_CONSTANTS = Object.freeze({
  PROPERTY_KEY: 'CALENDAR_EMOJI_TIME_LOCK_SETTINGS',
  SYSTEM_EVENT_ID: 'SYSTEM_EVENT_ID: CALENDAR_EMOJI_TIME_LOCK',
  DUMMY_EVENT_ID: 'DUMMY_EVENT_ID: CALENDAR_EMOJI_TIME_LOCK_DEMO',
  LOCK_DESCRIPTION: 'この予定はCalendar Emoji Time Lockにより自動生成されました。\n' +
    'SYSTEM_EVENT_ID: CALENDAR_EMOJI_TIME_LOCK\n' +
    '手動で編集せず、設定画面から変更してください。',
  DUMMY_DESCRIPTION: 'Calendar Emoji Time Lockのデモ用予定です。\n' +
    'DUMMY_EVENT_ID: CALENDAR_EMOJI_TIME_LOCK_DEMO',
  DAILY_FUNCTION_NAME: 'dailyRefreshCalendarLocks',
  TIME_ZONE: 'Asia/Tokyo',
  DEFAULT_SETTINGS: Object.freeze({
    calendarId: 'primary',
    targetEmoji: '🍺',
    lockEventTitle: '🔒 自動ロック｜夜間予定あり',
    judgmentStartTime: '18:00',
    lockStartTime: '18:00',
    lockEndTime: '24:00',
    lookAheadDays: 31,
    includeAllDayEvents: false,
    recreateExistingLocks: true
  })
});

/** 保存済み設定をデフォルト値とマージして返します。 */
function getSettings() {
  var defaults = CEL_CONSTANTS.DEFAULT_SETTINGS;
  var savedText = PropertiesService.getUserProperties().getProperty(CEL_CONSTANTS.PROPERTY_KEY);
  var saved = {};

  if (savedText) {
    try {
      saved = JSON.parse(savedText);
    } catch (error) {
      console.error('設定JSONの読み込みに失敗しました: ' + error.stack);
    }
  }

  return {
    calendarId: saved.calendarId !== undefined ? saved.calendarId : defaults.calendarId,
    targetEmoji: saved.targetEmoji !== undefined ? saved.targetEmoji : defaults.targetEmoji,
    lockEventTitle: saved.lockEventTitle !== undefined ? saved.lockEventTitle : defaults.lockEventTitle,
    judgmentStartTime: saved.judgmentStartTime !== undefined ? saved.judgmentStartTime : defaults.judgmentStartTime,
    lockStartTime: saved.lockStartTime !== undefined ? saved.lockStartTime : defaults.lockStartTime,
    lockEndTime: saved.lockEndTime !== undefined ? saved.lockEndTime : defaults.lockEndTime,
    lookAheadDays: saved.lookAheadDays !== undefined ? Number(saved.lookAheadDays) : defaults.lookAheadDays,
    includeAllDayEvents: saved.includeAllDayEvents !== undefined ? Boolean(saved.includeAllDayEvents) : defaults.includeAllDayEvents,
    recreateExistingLocks: saved.recreateExistingLocks !== undefined ? Boolean(saved.recreateExistingLocks) : defaults.recreateExistingLocks
  };
}

/** サイドバーから受け取った設定を検証して保存します。 */
function saveSettings(settings) {
  try {
    var normalized = normalizeSettings_(settings);
    validateSettings(normalized);
    // 保存時点でカレンダーへアクセスできることも確認します。
    getTargetCalendar(normalized.calendarId);
    PropertiesService.getUserProperties().setProperty(
      CEL_CONSTANTS.PROPERTY_KEY,
      JSON.stringify(normalized)
    );
    console.log('設定を保存しました: ' + JSON.stringify(normalized));
    return { success: true, message: '設定を保存しました。', settings: normalized };
  } catch (error) {
    console.error('設定の保存に失敗しました: ' + error.stack);
    throw new Error(toUserMessage_(error, '設定の保存に失敗しました。'));
  }
}

/** 設定値を検証します。不正な場合は日本語メッセージで例外を投げます。 */
function validateSettings(settings) {
  if (!settings || !String(settings.calendarId || '').trim()) {
    throw new Error('カレンダーIDを入力してください。');
  }
  if (!String(settings.targetEmoji || '').trim()) {
    throw new Error('判定絵文字を入力してください。');
  }
  if (!String(settings.lockEventTitle || '').trim()) {
    throw new Error('自動生成予定名を入力してください。');
  }

  var judgmentMinutes = parseTimeToMinutes_(settings.judgmentStartTime, false, '判定開始時刻');
  var lockStartMinutes = parseTimeToMinutes_(settings.lockStartTime, false, 'ロック開始時刻');
  var lockEndMinutes = parseTimeToMinutes_(settings.lockEndTime, true, 'ロック終了時刻');
  if (lockEndMinutes <= lockStartMinutes) {
    throw new Error('ロック終了時刻は、ロック開始時刻より後に設定してください。');
  }
  if (!Number.isInteger(Number(settings.lookAheadDays)) || Number(settings.lookAheadDays) < 0 || Number(settings.lookAheadDays) > 365) {
    throw new Error('判定期間は0日から365日までの整数で入力してください。');
  }
  return true;
}

/** フォーム値の型と余分な空白を整えます。 */
function normalizeSettings_(settings) {
  settings = settings || {};
  return {
    calendarId: String(settings.calendarId || '').trim(),
    targetEmoji: String(settings.targetEmoji || '').trim(),
    lockEventTitle: String(settings.lockEventTitle || '').trim(),
    judgmentStartTime: String(settings.judgmentStartTime || '').trim(),
    lockStartTime: String(settings.lockStartTime || '').trim(),
    lockEndTime: String(settings.lockEndTime || '').trim(),
    lookAheadDays: Number(settings.lookAheadDays),
    includeAllDayEvents: settings.includeAllDayEvents === true || settings.includeAllDayEvents === 'true',
    recreateExistingLocks: settings.recreateExistingLocks === true || settings.recreateExistingLocks === 'true'
  };
}

/** HH:mm を0時からの分数へ変換します。allow24=true の場合のみ24:00を許可します。 */
function parseTimeToMinutes_(value, allow24, label) {
  var text = String(value || '');
  var match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(label + 'はHH:mm形式（例: 18:00）で入力してください。');
  }
  var hour = Number(match[1]);
  var minute = Number(match[2]);
  var isValid24 = allow24 && hour === 24 && minute === 0;
  if ((!isValid24 && (hour < 0 || hour > 23)) || minute < 0 || minute > 59) {
    throw new Error(label + 'の時刻が不正です。');
  }
  return hour * 60 + minute;
}

/** 予期しない技術情報を画面へ出しすぎないよう、ユーザー向け文言へ変換します。 */
function toUserMessage_(error, fallback) {
  var message = error && error.message ? String(error.message) : '';
  if (/permission|access denied|not have permission|権限|承認|authorization|authorize/i.test(message)) {
    return 'カレンダーへのアクセス権限がありません。対象カレンダーの編集権限とGoogleの承認状態を確認してください。';
  }
  // このアプリ自身が投げた日本語の検証メッセージはそのまま表示します。
  if (/[ぁ-んァ-ヶ一-龠]/.test(message)) {
    return message;
  }
  return fallback;
}
