/** Calendar Emoji Time Lock - デモデータ管理 */

var CEL_DEMO_TITLES = [
  'チーム定例',
  '取引先との会食 🍺',
  '友人と飲み会 🍺',
  'プロジェクト会議',
  '懇親会 🍺',
  '資料作成',
  'オンライン打ち合わせ',
  '歓迎会 🍺',
  'セミナー参加',
  '食事会 🍺',
  'AI活用オンライン勉強会 💻',
  'オンライン読書会 💻',
  '東京オフライン勉強会 🏫',
  '技術コミュニティ勉強会 🏫'
];

var CEL_DEMO_TIME_SLOTS = [
  [9, 0, 10, 0],
  [13, 0, 14, 0],
  [17, 0, 19, 0],
  [18, 0, 20, 0],
  [19, 0, 21, 0],
  [20, 0, 22, 0]
];

/** 今日から60日後までに20〜30件のランダムなデモ予定を作成します。 */
function generateDummyEvents() {
  try {
    var settings = getSettings();
    validateSettings(settings);
    var calendar = getTargetCalendar(settings.calendarId);
    var today = startOfDay_(new Date());
    var eventCount = randomInteger_(20, 30);

    for (var i = 0; i < eventCount; i++) {
      var day = addDays_(today, randomInteger_(0, 60));
      // 最初の3件で各ルールの動作確認用予定を必ず1件ずつ作ります。
      var title = i === 0
        ? 'デモ飲み会 🍺'
        : i === 1
          ? 'デモオンライン勉強会 💻'
          : i === 2
            ? 'デモオフライン勉強会 🏫'
            : CEL_DEMO_TITLES[randomInteger_(0, CEL_DEMO_TITLES.length - 1)];
      var slot = CEL_DEMO_TIME_SLOTS[randomInteger_(0, CEL_DEMO_TIME_SLOTS.length - 1)];
      var start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot[0], slot[1], 0, 0);
      var end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot[2], slot[3], 0, 0);
      calendar.createEvent(title, start, end, { description: CEL_CONSTANTS.DUMMY_DESCRIPTION });
    }

    console.log('ダミーデータを作成しました: ' + eventCount + '件');
    var result = {
      success: true,
      message: 'ダミーデータを作成しました。',
      createdCount: eventCount,
      deletedCount: 0,
      targetDays: 61
    };
    safeLogOperation_('ダミーデータ作成', '成功', result, result.message);
    return result;
  } catch (error) {
    console.error('ダミーデータ作成エラー: ' + error.stack);
    safeLogOperation_('ダミーデータ作成', '失敗', null, error.message || String(error));
    throw new Error('ダミーデータの作成に失敗しました。カレンダーIDとアクセス権限を確認してください。');
  }
}

/** 識別子を持つダミー予定だけを削除します。 */
function deleteDummyEvents() {
  try {
    var settings = getSettings();
    validateSettings(settings);
    var calendar = getTargetCalendar(settings.calendarId);
    // 長期間残っていたデモ予定も識別子で安全に掃除します。
    var candidates = calendar.getEvents(
      new Date(2000, 0, 1, 0, 0, 0, 0),
      new Date(2101, 0, 1, 0, 0, 0, 0),
      { search: CEL_CONSTANTS.DUMMY_EVENT_ID }
    );
    var deletedCount = 0;

    candidates.forEach(function(event) {
      if (String(event.getDescription() || '').indexOf(CEL_CONSTANTS.DUMMY_EVENT_ID) !== -1) {
        event.deleteEvent();
        deletedCount++;
      }
    });

    console.log('ダミーデータを削除しました: ' + deletedCount + '件');
    var result = {
      success: true,
      message: 'ダミーデータを削除しました。',
      createdCount: 0,
      deletedCount: deletedCount,
      targetDays: 0
    };
    safeLogOperation_('ダミーデータ削除', '成功', result, result.message);
    return result;
  } catch (error) {
    console.error('ダミーデータ削除エラー: ' + error.stack);
    safeLogOperation_('ダミーデータ削除', '失敗', null, error.message || String(error));
    throw new Error(toUserMessage_(error, 'ダミーデータの削除に失敗しました。'));
  }
}

function randomInteger_(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
