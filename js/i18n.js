// ============================================================
//  UI language: 中文 (zh, the original text) / 日本語 (ja)
//  Arcade labels (PLAY, PERFECT, COMBO, FEVER…) stay English in both.
//  Static text: data-i18n="key" (textContent), data-i18n-title / data-i18n-placeholder (attributes).
//  Chosen by ?lang=ja|zh (remembered), else the saved choice, else the browser language.
// ============================================================

const DICT = {
  zh: {
    'drop.hint': '放開以加入歌曲 · Drop to add song',
    'set.speed': 'Scroll speed', 'set.offset': 'Audio offset', 'set.calibrate': 'Calibrate 校正',
    'set.music': 'Music', 'set.hit': 'Hit sound', 'set.noFail': 'No fail', 'set.char': '孤夜',
    'set.fx': '演出', 'set.fx.full': '標準', 'set.fx.lite': '輕量',
    'set.note': '音符', 'set.note.bachi': '撥子', 'set.note.slab': '厚板', 'set.note.sakura': '櫻花', 'set.note.glass': '玻璃',
    'set.gimmick': '譜面', 'set.gimmick.tip': '華麗：掃弦 / 推弦 / 變速', 'set.gimmick.on': '華麗', 'set.gimmick.off': '經典',
    'set.name': 'Name', 'set.dice': 'Random name', 'set.autoSubmit': 'Auto-submit', 'set.keys': 'Keys', 'set.change': 'Change',
    'set.lang': 'Language',
    'cal.text': '跟著節拍，每一拍按一下', 'cal.start': 'Start', 'cal.again': 'Again', 'cal.apply': 'Apply',
    'cal.few': '點擊次數太少，請再試一次',
    'cal.result': '測得延遲 <b>{ms}ms</b>（穩定度 ±{spread}ms，{n} 次）',
    'res.name': 'Name', 'res.submit': 'Submit', 'res.done': 'Done',
    'res.failedNoSubmit': 'Failed runs cannot be submitted', 'res.submitting': 'Submitting as {name}…',
    'res.position': '{name} · #{pos} on this song', 'res.submitFailed': 'Submit failed', 'res.network': 'Network error',
    'lb.song': 'This song', 'lb.global': 'Global', 'lb.loading': 'Loading…', 'lb.empty': 'No scores yet',
    'lb.failed': 'Failed to load leaderboard', 'lb.player': 'Player', 'lb.score': 'Score', 'lb.acc': 'Acc', 'lb.rank': 'Rank',
    'up.title': 'MP3 · WAV · OGG · M4A · FLAC · MIDI（可拖放）', 'up.delete': 'Delete',
    'load.loading': 'Loading…', 'load.download': 'Downloading…', 'load.decode': 'Decoding…',
    'load.beats': '分析節拍中 Detecting beats…', 'load.read': 'Reading file…',
    'err.format': '不支援的檔案格式：{file}', 'err.big': '檔案太大（>80MB）：{file}', 'err.short': '歌曲太短（至少 10 秒）',
    'err.storage': '瀏覽器儲存空間不足，這首歌只會保留到關閉頁面', 'err.read': '無法讀取 {file}：{err}',
    'err.load': '載入失敗：{err}', 'err.noNotes': 'No playable notes found',
    'up.added': '已加入歌曲！選擇難度後開始', 'up.confirmDelete': '刪除「{title}」？',
    'key.first': '請依序按下第 1 軌的按鍵…', 'key.next': '請按下第 {n} 軌的按鍵…', 'key.cancel': '已取消', 'key.done': '按鍵已更新',
    'offset.set': 'Offset 已設為 {ms}ms',
    'line.start': ['跟上我的節奏吧♪', '準備好了嗎？', '今晚就交給我吧'],
    'line.combo': ['不錯嘛～', '就是這樣！', '再快一點也沒問題吧？', '手感很好喔♪'],
    'line.fever': ['全開了喔！', '一起嗨起來！'],
    'line.break': ['欸？走神了喔', '沒關係，再來！', '呼…跟緊一點'],
    'line.lowHp': ['撐住啊！'],
    'line.stage': ['舞台開始！', '看好了喔♪', '這才是真正的我！'],
    'res.line.F': '下次一定可以的…再來一次？', 'res.line.SS': '完美！你就是我的最佳拍檔♡', 'res.line.S': '好厲害！給你一個愛心♡',
    'res.line.AB': '很棒喔！再一次就更完美了', 'res.line.CD': '節奏還差一點點，再陪我練練吧',
  },
  ja: {
    'drop.hint': 'ドロップして曲を追加',
    'set.speed': 'ハイスピード', 'set.offset': 'オフセット', 'set.calibrate': 'タイミング調整',
    'set.music': '音楽', 'set.hit': 'タップ音', 'set.noFail': 'ノーフェイル', 'set.char': '孤夜',
    'set.fx': '演出', 'set.fx.full': '標準', 'set.fx.lite': '軽量',
    'set.note': 'ノーツ', 'set.note.bachi': 'バチ', 'set.note.slab': '厚板', 'set.note.sakura': '桜', 'set.note.glass': 'ガラス',
    'set.gimmick': '譜面', 'set.gimmick.tip': 'ギミック：スイープ / スライド / ソフラン', 'set.gimmick.on': 'ギミック', 'set.gimmick.off': 'クラシック',
    'set.name': '名前', 'set.dice': 'ランダムな名前', 'set.autoSubmit': '自動送信', 'set.keys': 'キー', 'set.change': '変更',
    'set.lang': '言語',
    'cal.text': 'ビートに合わせて、1拍ごとにタップ', 'cal.start': 'スタート', 'cal.again': 'もう一回', 'cal.apply': '適用',
    'cal.few': 'タップ回数が足りません。もう一度試してください',
    'cal.result': '測定した遅延 <b>{ms}ms</b>（ばらつき ±{spread}ms、{n} 回）',
    'res.name': '名前', 'res.submit': '送信', 'res.done': '完了',
    'res.failedNoSubmit': 'FAILED のスコアは送信できません', 'res.submitting': '{name} として送信中…',
    'res.position': '{name} · この曲で {pos} 位', 'res.submitFailed': '送信に失敗しました', 'res.network': 'ネットワークエラー',
    'lb.song': 'この曲', 'lb.global': '総合', 'lb.loading': '読み込み中…', 'lb.empty': 'まだスコアがありません',
    'lb.failed': 'ランキングを読み込めませんでした', 'lb.player': 'プレイヤー', 'lb.score': 'スコア', 'lb.acc': '精度', 'lb.rank': 'ランク',
    'up.title': 'MP3 · WAV · OGG · M4A · FLAC · MIDI（ドラッグ＆ドロップ可）', 'up.delete': '削除',
    'load.loading': '読み込み中…', 'load.download': 'ダウンロード中…', 'load.decode': 'デコード中…',
    'load.beats': 'ビートを解析中…', 'load.read': 'ファイルを読み込み中…',
    'err.format': '対応していないファイル形式です：{file}', 'err.big': 'ファイルが大きすぎます（80MB 超）：{file}', 'err.short': '曲が短すぎます（10 秒以上必要）',
    'err.storage': 'ブラウザの保存容量が足りません。この曲はページを閉じるまでのみ保持されます', 'err.read': '{file} を読み込めません：{err}',
    'err.load': '読み込みに失敗しました：{err}', 'err.noNotes': 'プレイできるノーツが見つかりません',
    'up.added': '曲を追加しました！難易度を選んでスタート', 'up.confirmDelete': '「{title}」を削除しますか？',
    'key.first': 'レーン 1 から順にキーを押してください…', 'key.next': 'レーン {n} のキーを押してください…', 'key.cancel': 'キャンセルしました', 'key.done': 'キー設定を更新しました',
    'offset.set': 'オフセットを {ms}ms に設定しました',
    'line.start': ['私のリズムについてきて♪', '準備はいい？', '今夜は私に任せて'],
    'line.combo': ['やるじゃない～', 'その調子！', 'もっと速くても平気でしょ？', 'いい感じだよ♪'],
    'line.fever': ['全開でいくよ！', '一緒に盛り上がろう！'],
    'line.break': ['あれ？よそ見してた？', '大丈夫、もう一回！', 'ふぅ…ちゃんとついてきて'],
    'line.lowHp': ['踏ん張って！'],
    'line.stage': ['ステージ開始！', 'よく見ててね♪', 'これが本当の私！'],
    'res.line.F': '次はきっとできるよ…もう一回やる？', 'res.line.SS': 'パーフェクト！あなたは最高の相棒だよ♡', 'res.line.S': 'すごい！ハートをあげる♡',
    'res.line.AB': 'いいね！もう一回でもっと完璧になるよ', 'res.line.CD': 'リズムがあと少し…一緒に練習しよ？',
  },
};
export const LANGS = ['zh', 'ja'];

const FONTS = {
  zh: '"Segoe UI", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif',
  ja: '"Segoe UI", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans TC", system-ui, sans-serif',
};

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) { localStorage.setItem('rhythmLang', q); return q; }
  const saved = localStorage.getItem('rhythmLang');
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.languages || [navigator.language || ''])[0] || '';
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'zh';
}

export let lang = typeof document === 'undefined' ? 'zh' : initialLang();
// canvas font stack for the current language (a live binding: game.js / character.js read it at draw time)
export let FONT = FONTS[lang];

// t('key', {var: value}) — string with {var} filled in; arrays (character lines) come back as they are
export function t(key, vars) {
  const v = DICT[lang][key] ?? DICT.zh[key] ?? key;
  if (!vars || typeof v !== 'string') return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang === 'ja' ? 'ja' : 'zh-TW';
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

export function setLang(l) {
  if (!LANGS.includes(l) || l === lang) return false;
  lang = l;
  FONT = FONTS[l];
  localStorage.setItem('rhythmLang', l);
  applyI18n();
  return true;
}
