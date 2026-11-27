# سهرة فيلم: دليل لـ Claude Code

الموقع: https://sahrafilm.com. صاحبه سيف (@saiflex.u)، صانع محتوى أفلام وأنمي ومسلسلات بالعين.

**ردّ على سيف دايماً بالعربي باللهجة الأردنية.** نصوص الموقع كمان باللهجة.

## البنية
- **Cloudflare Workers + static assets.** الإعدادات بـ `wrangler.jsonc`، والمدخل `worker/index.js`.
  - Durable Object اسمه `Room` (`worker/room.js`): غرف الألعاب، WebSocket، مؤقت الدور 30 ثانية، وتلميحات خاصة لكل فريق.
  - في كمان binding اسمه `POLLS` لاستطلاع `/eco201`. هاد إله جلسة ثانية، لا تلمسه.
- **النشر:** Workers Builds مربوط بـ GitHub. أي push على `main` بينشر لحاله. التغييرات بـ `data/**` ما بتعمل build.
- **مفاتيح سرية** موجودة بـ Cloudflare، وسيف هو اللي حطها: `GEMINI_API_KEY`، `TVDB_API_KEY`، `TMDB_API_KEY` (ما عاد مستخدم).
  - لا تطبع ولا تنسخ أي مفتاح.
- **الحسابات والعملات (D1):** قاعدة `sahra-db` بـ binding اسمه `DB`، والجداول بـ `migrations/`. الكود بـ `worker/auth.js` والمسارات `/api/auth/*`، والصفحة `login.html`.
  - جدول جديد = ملف migration جديد، وطبّقه على `--remote` **قبل** الـ push.
  - مفاتيح بـ `wrangler.jsonc` (vars): `JUDGE_LOGIN` ("1" = الحكم لازم يكون داخل) و`ROOM_COINS` (0 = الغرف ببلاش).
  - مفاتيح سرية (سيف حطها): `RESEND_API_KEY` (الإيميلات من `no-reply@sahrafilm.com`، الدومين Verified على Resend) و`TURNSTILE_SECRET`. المفتاح العام `TURNSTILE_SITE_KEY` بـ vars.
  - Cloudflare رفض PBKDF2 بـ 150,000 على الموقع الحقيقي، فالحسابات بـ 100,000 (الكود بيجرّب الأعلى وبينزل لحاله).
  - الحساب لـ 18+ (الصفحة والسيرفر بيتأكدوا). الصفحات: `terms.html` و`privacy.html` و`refund.html` (شراء العملات نهائي إلا الدفع المكرر أو خطأ تقني). إيميل الدعم `support@sahrafilm.com` بيتحوّل لإيميل سيف (Cloudflare Email Routing).
  - الاختبار: `tests/auth.test.mjs` مع `wrangler dev --var DEV_MAIL_LINKS:1 --var ROOM_COINS:100 --var TURNSTILE_SITE_KEY:1x00000000000000000000AA` (بعد `wrangler d1 migrations apply sahra-db --local`).
- **الألعاب:**
  - `game.html` (أفلام)، `anime.html`، `series.html`، `music.html` (أغاني الأفلام).
  - الكود المشترك: `play.js` و`play.css` و`common.js`، وكرت الاستوري `card.js`.

## مصادر البيانات (مجانية ومسموحة)
- **الأفلام:** Wikidata (CC0) + ويكيبيديا (CC BY-SA). السكربت `scripts/free-films.mjs` بيبني `data/films.json` و`data/d/<qid>.json`.
  - GitHub Action `sync.yml` بيشغّله كل 6 ساعات.
  - بالموقع: `worker/wikidata.js`.
- **شباك التذاكر:** ويكيبيديا، بسكربت `scripts/boxoffice.mjs` بيكتب `data/boxoffice.json`.
- **السينما بالإمارات:** `data/cinema.json`.
  - في مهمة مجدولة يومية الساعة 5:17 الصبح بتوقيت دبي بتحدّثه من أخبار الإمارات وصفحات السينمات.
  - الصفحة `cinema.html` + `cinema.js`.
- **الأنمي:** AniList (`anilist.js`).
  - AniList بيرفض الطلبات من سيرفرات Cloudflare (بيرجّع 403)، فالمتصفح هو اللي بيطلب منه، والحكم بيبعث التفاصيل للغرفة.
- **المسلسلات:** TVmaze (`worker/tvmaze.js`).
- **البوسترات:** TheTVDB عن طريق `/api/poster/<imdb>`.
- **الذكاء الاصطناعي:** Gemini للتلميحات ولمعرفة الفيلم من القصة. الاحتياط ويكيبيديا.
- **ممنوع:** سحب أو استخدام صور ومعلومات IMDb وBox Office Mojo وTMDB. روابط IMDb مسموحة.

## قواعد
- **صفحات المسابقة** (`contest.html`, `draw.html`): لا تتعدّل قبل السحب يوم 13 ديسمبر 2026.
- **قبل أي حذف نهائي** اسأل سيف.
- **قبل الـ push:** اعمل `git pull --rebase`، لأنه في بوت بيعمل commits على `data/`.
- **الاختبارات:**
  - `tests/rooms.test.mjs` مع `wrangler dev`.
  - `tests/ui.test.py` (Playwright).
  - وجرّب على الموقع الحقيقي بعد النشر.

## خطة إعادة الهيكلة (مواصفات 1.6، نوفمبر 2026)
القرارات كاملة بمستند المشروع `claude/sahra-plan-decisions.md`. باختصار:
- **المرحلة ١:** الواجهة الجديدة + قسم السينما. السينما خلصت يوم 27/11.
- **المرحلة ٢:** حسابات D1:
  - إيميل وكلمة سر بـ PBKDF2، وجلسات.
  - رصيد عملات وسجل حركات.
  - تأكيد الإيميل، استرجاع كلمة السر، Turnstile.
  - الحكم بس بيحتاج حساب، واللاعبين بيدخلوا باسمهم. رمز الغرفة بالرابط (`?next=`).
- **المرحلة ٣:**
  - طور المحتال.
  - تحدي الكروت/المزايدة (بدون كلمة "رهان"، والجائزة 10 عملات، وأقصى شي 20 باليوم).
  - التوب 10 جواها 4 عوالم (أفلام، أنمي، مسلسلات، عشوائي)، بكل عالم 100 سؤال متحقق منهم وبدون تكرار.
  - بوتات بقواعد ثابتة.
- **الدفع:** Ziina (Apple Pay وGoogle Pay). الـ API بيحتاج حساب Business موثّق، وحالياً "قريباً".
- **متجر المجسمات:** انشال من الخطة حالياً.
- **صفحات قانونية:** شروط الاستخدام، الخصوصية، والاسترجاع.
