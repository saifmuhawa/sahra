-- حسابات سهرة فيلم والعملات (المرحلة ٢)
-- كل الأوقات بالمللي ثانية (Date.now())

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,          -- دايماً أحرف صغيرة
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,             -- PBKDF2-SHA256، base64
  pass_salt TEXT NOT NULL,             -- base64
  pass_iter INTEGER NOT NULL,
  verified_at INTEGER,                 -- NULL = لسا ما أكّد الإيميل
  created_at INTEGER NOT NULL
);

-- الجلسة: بنخزّن hash التوكن بس، والتوكن نفسه بالكوكي
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- روابط الإيميل (تأكيد الحساب واسترجاع كلمة السر): لمرة وحدة ولمدة محدودة
CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,                 -- hash التوكن
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, kind);

-- سجل العملات: ما بينعدّل ولا بينحذف، والرصيد = مجموع الحركات
-- (reason, ref) ما بيتكرروا لنفس الشخص، عشان ما تنضاف الهدية أو الدفعة مرتين
CREATE TABLE coin_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,                -- welcome / room / payment / prize / admin
  ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reason, ref)
);
CREATE INDEX coin_ledger_user ON coin_ledger(user_id, id);

-- حد للمحاولات (تسجيل دخول، تسجيل، إيميلات) عشان التخمين والسبام
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
