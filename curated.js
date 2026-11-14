/* بيانات بنكتبها بإيدنا: أغاني مختارة، ألغاز، وجمل "ليش تحضره" لأفلام معينة.
   كل فيلم بيتعرّف بمفتاح: اسمه بالإنجليزي (حروف صغيرة) | سنته  — نفس اللي بيجي من TMDB */

// أغاني مختارة — yt = رقم الفيديو على يوتيوب
const MUSIC = {
  "interstellar|2014":[
    {t:"Cornfield Chase",by:"Hans Zimmer",yt:"7GlsxNI4LVI"},
    {t:"No Time for Caution",by:"Hans Zimmer",yt:"2o9KfyPqQzY",note:"مشهد الالتحام"},
    {t:"S.T.A.Y.",by:"Hans Zimmer",yt:"MU3EOO4fWQo"},
    {t:"Day One",by:"Hans Zimmer",yt:"vPA6T0la6uI"}
  ],
  "inception|2010":[
    {t:"Time",by:"Hans Zimmer",yt:"c56t7upa8Bk"},
    {t:"Dream Is Collapsing",by:"Hans Zimmer",yt:"OzLhXesNkCI"}
  ],
  "the dark knight|2008":[{t:"Why So Serious?",by:"Hans Zimmer & James Newton Howard",yt:"KjShkVqz2a4"}],
  "joker|2019":[{t:"Bathroom Dance",by:"Hildur Guðnadóttir",yt:"LNYCuj4ur-U"}],
  "titanic|1997":[{t:"My Heart Will Go On",by:"Céline Dion",yt:"9bFHsd3o1w0"}],
  "guardians of the galaxy|2014":[
    {t:"Hooked on a Feeling",by:"Blue Swede",yt:"l6DepmNwbn8"},
    {t:"Come and Get Your Love",by:"Redbone",yt:"BA4rSO-h9Io",note:"أول مشهد بالفيلم"}
  ],
  "pirates of the caribbean: the curse of the black pearl|2003":[{t:"He's a Pirate",by:"Klaus Badelt",yt:"BuYf0taXoNw"}],
  "your name.|2016":[
    {t:"Zenzenzense (前前前世)",by:"RADWIMPS",yt:"PDSkFeMVNFs"},
    {t:"Sparkle",by:"RADWIMPS",yt:"-J9FuvPmMoI"}
  ],
  "spirited away|2001":[{t:"One Summer's Day",by:"Joe Hisaishi",yt:"aRYGvrDmXRs"}],
  "the blue elephant|2014":[{t:"موسيقى الفيلم الرئيسية",by:"هشام نزيه",yt:"pw2QJC94v3w"}]
};

// أسماء عربية وجمل قصيرة بنفضّلها على وصف TMDB
const NOTES = {
  "interstellar|2014":{ar:"إنترستلر",why:"رحلة بين النجوم، بس قلبها قصة أب وبنته. وموسيقاها لحالها بتستاهل السهرة.",alias:["انترستلر","بين النجوم"]},
  "inception|2010":{ar:"إنسبشن",why:"حلم جوّا حلم جوّا حلم. ركّز من أول دقيقة وإلا رح تضيع.",alias:["انسبشن","استهلال"]},
  "the dark knight|2008":{ar:"فارس الظلام",why:"أقوى جوكر بتاريخ السينما، وفيلم أبطال خارقين بيحس كأنه فيلم جريمة.",alias:["دارك نايت","الفارس الأسود"]},
  "joker|2019":{ar:"جوكر",why:"ثقيل ومظلم، بس رح يضل براسك أيام. مش لسهرة مع العيلة.",alias:["الجوكر"]},
  "titanic|1997":{ar:"تايتانك",why:"كلنا بنعرف النهاية، وبرضو بنبكي كل مرة.",alias:["تيتانيك","تايتانيك"]},
  "guardians of the galaxy|2014":{ar:"حراس المجرة",why:"عصابة فاشلة بتنقذ المجرة، مع أحلى شريط أغاني بأفلام مارفل.",alias:["جارديانز"]},
  "pirates of the caribbean: the curse of the black pearl|2003":{ar:"قراصنة الكاريبي",why:"جاك سبارو لحاله بيكفي. مغامرة كاملة لكل العيلة.",alias:["قراصنه الكاريبي","جاك سبارو"]},
  "your name.|2016":{ar:"اسمك",why:"ولد وبنت بيتبادلوا الأجسام، وبعدين القصة بتاخذ منعطف ما بتتوقعه.",alias:["يور نيم","كيمي نو نا وا"]},
  "spirited away|2001":{ar:"المخطوفة",why:"أشهر فيلم من جيبلي. عالم سحري كل كادر فيه لوحة.",alias:["سبيريتد اواي","تشيهيرو"]},
  "the blue elephant|2014":{ar:"الفيل الأزرق",why:"رعب نفسي مصري، وموسيقى هشام نزيه بتقيمك عن الكرسي.",alias:["الفيل الازرق"]},
  "theeb|2014":{ar:"ذيب",why:"فيلم أردني بالصحرا وقت الحرب العالمية الأولى، وترشّح للأوسكار.",alias:["ذئب"]},
  "capernaum|2018":{ar:"كفرناحوم",why:"ولد بيرفع قضية على أهله. فيلم لبناني رح يكسرك."},
  "wadjda|2012":{ar:"وجدة",why:"بنت سعودية صغيرة كل حلمها بسكليت. بسيط وبيوصل للقلب."},
  "parasite|2019":{ar:"طفيلي",why:"بيبلش كوميدي وبيقلب على نص الفيلم. احضره وانت ما بتعرف عنه شي.",alias:["باراسايت"]},
  "knives out|2019":{ar:"السكاكين في الخارج",why:"لغز جريمة مين القاتل، بس بدم خفيف. حلو تحضروه وتتراهنوا.",alias:["نايفز اوت"]},
  "coco|2017":{ar:"كوكو",why:"فيلم كرتون عن العيلة والذكريات، وجهّز المحارم للآخر."},
  "mad max: fury road|2015":{ar:"ماد ماكس: طريق الغضب",why:"ساعتين مطاردة بدون ما ياخذ نفس.",alias:["ماد ماكس"]},
  "spider-man: into the spider-verse|2018":{ar:"سبايدرمان: في عالم العناكب",why:"أحلى شكل رسوم ممكن تشوفه، وقصة سبايدرمان من زاوية جديدة.",alias:["سبايدر فيرس"]},
  "a silent voice: the movie|2016":{ar:"صوت صامت",why:"عن التنمّر والندم ومحاولة تصلّح اللي خرّبته.",alias:["سايلنت فويس"]},
  "asal eswed|2010":{ar:"عسل أسود",why:"أحمد حلمي راجع على مصر بعد ٢٠ سنة، ومصر ما بترحم.",alias:["عسل اسود","عسل إسود"]},
  "welad rizk|2015":{ar:"ولاد رزق",why:"عصابة إخوة وعملية سرقة أخيرة. أكشن مصري بإيقاع سريع.",alias:["أولاد رزق"]}
};

// الألغاز — film = مفتاح الفيلم، names = أسماء إضافية مقبولة كجواب
const PUZZLES = [
  {film:"interstellar|2014",lvl:"mid",lang:"en",tiles:[{key:"Enter ⏎"},"+",{e:"⭐",sub:"بالإنجليزي: نجمي"}],hint:"الصورة الأولى زر بالكيبورد. لفظه بالعربي.",names:["interstellar","انترستلر","انترستيلر"]},
  {film:"the dark knight|2008",lvl:"mid",lang:"en",tiles:[{e:"🌑",sub:"معتم"},"+",{e:"🛡\ufe0f",sub:"فارس"}],hint:"بطله لابس أسود وبيطلع بالليل.",names:["dark knight","فارس الظلام","دارك نايت"]},
  {film:"asal eswed|2010",lvl:"easy",lang:"ar",tiles:[{e:"🍯"},"+",{e:"⚫"}],hint:"فيلم أحمد حلمي.",names:["عسل اسود","عسل إسود","عسل أسود"]},
  {film:"coco|2017",lvl:"hard",lang:"en",tiles:[{e:"🥥",sub:"احذف آخر ٣ حروف"}],hint:"اسم الثمرة بالإنجليزي COCONUT.",names:["coco","كوكو"]},
  {film:"the blue elephant|2014",lvl:"easy",lang:"ar",tiles:[{e:"🐘"},"+",{e:"🔵"}],hint:"رعب مصري، كريم عبد العزيز.",names:["الفيل الازرق","blue elephant"]},
  {film:"spider-man: into the spider-verse|2018",lvl:"mid",lang:"en",tiles:[{e:"🕷\ufe0f"},"+",{e:"👨"},"+",{e:"🌌",sub:"كون، بالإنجليزي verse"}],hint:"أبطال عناكب من أكثر من عالم.",names:["spider verse","spiderverse","spiderman into the spiderverse","سبايدر فيرس"]},
  {film:"welad rizk|2015",lvl:"mid",lang:"ar",tiles:[{e:"👦👦"},"+",{e:"💰",sub:"اللي ربنا بيبعته"}],hint:"عصابة إخوة مصريين.",names:["ولاد رزق","اولاد رزق"]},
  {film:"knives out|2019",lvl:"mid",lang:"en",tiles:[{e:"🔪🔪"},"+",{e:"🚪➡\ufe0f",sub:"لبرّا"}],hint:"لغز جريمة، Out = برّا.",names:["knives out","نايفز اوت"]},
  {film:"theeb|2014",lvl:"easy",lang:"ar",tiles:[{e:"🐺",sub:"بلهجة البدو"}],hint:"فيلم أردني بالصحرا.",names:["ذيب","ذئب","theeb"]},
  {film:"a silent voice: the movie|2016",lvl:"hard",lang:"en",tiles:[{e:"🤫",sub:"ساكت"},"+",{e:"🗣\ufe0f",sub:"صوت"}],hint:"أنمي عن بنت ما بتسمع.",names:["a silent voice","silent voice","صوت صامت"]},
  {film:"mad max: fury road|2015",lvl:"easy",lang:"en",tiles:[{e:"😡",sub:"زعلان، بالإنجليزي"},"+",{e:"📈",sub:"أعلى حد"}],hint:"مطاردة بالصحرا.",names:["mad max","ماد ماكس"]},
  {film:"pirates of the caribbean: the curse of the black pearl|2003",lvl:"mid",lang:"ar",tiles:[{e:"🏴\u200d☠\ufe0f",sub:"بالجمع"},"+",{e:"🏝\ufe0f",sub:"بحر بأمريكا الوسطى"}],hint:"جاك سبارو.",names:["قراصنة الكاريبي","pirates of the caribbean"]}
];
