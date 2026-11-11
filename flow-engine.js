
// محرك Flow: يفتح مشروع جديد، يرفع صورة الطفل، يولّد صورة لكل صفحة (3:4)، وينزّلها

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = 'https://flow.google.com/';

const S = {
  textbox: 'div[role="textbox"][contenteditable="true"]',
  addBtn: 'button[aria-label="إضافة المكوّنات إلى مربّع الطلب"]',
  settings: 'button[aria-label="مشغِّل الإعدادات"], button.settings-trigger-button',
  submit: 'button[aria-label="بدء الإنشاء"]'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let DBG_DIR = null;

const REATTACH_EACH = process.env.REATTACH_EACH !== '0';

// ======================================================
// القصة الافتراضية
// ======================================================

function defaultPages(name, dream) {
  const scenes = [
    [
      'stands proudly on the cover, looking toward a hopeful horizon, with visual symbols of the dream of {d}',
      null
    ],
    [
      'discovers a meaningful first clue that connects to the dream of {d}',
      `كان ${name} يحمل حلمًا جميلًا: أن يصبح ${dream}.`
    ],
    [
      'prepares carefully for the first step, gathering useful things for the journey',
      `قرر ${name} أن يبدأ من اليوم، فجهّز نفسه وتعلّم أول خطوة.`
    ],
    [
      'takes the first real step toward the dream, in a setting related to {d}',
      `بدأ ${name} رحلته، وكان متحمسًا لاكتشاف الطريق.`
    ],
    [
      'encounters a realistic obstacle connected to learning or practicing {d}',
      `لكن الطريق لم يكن سهلًا، فقد واجه ${name} أول تحدٍّ حقيقي.`
    ],
    [
      'meets a supportive mentor or friend who gives practical encouragement',
      `قابل ${name} شخصًا ساعده بنصيحة مهمة، ففهم كيف يتقدّم.`
    ],
    [
      'practices the skills needed for {d}, showing effort and gradual progress',
      `تدرّب ${name} كل يوم، وتعلّم من أخطائه بدل أن يستسلم.`
    ],
    [
      'faces a bigger setback but pauses, thinks, and chooses a new approach',
      `وفي يوم صعب، لم تنجح محاولته، لكنه قرر أن يجرّب بطريقة مختلفة.`
    ],
    [
      'uses what was learned to overcome the main challenge and achieve a milestone in {d}',
      `استفاد ${name} من كل ما تعلّمه، وتجاوز التحدي بخطوة شجاعة.`
    ],
    [
      'celebrates a satisfying dream-related achievement with family or friends, hopeful ending',
      `اقترب ${name} من حلمه وحقق إنجازًا أسعده، وعرف أن الاستمرار يصنع الفرق.`
    ]
  ];

  return scenes.map(([scene, text], i) => ({
    scene: scene.replace(/\{d\}/g, dream),
    text,
    cover: i === 0
  }));
}

function storyTitle(name) {
  return `رحلة ${name} نحو حلمه`;
}

// ======================================================
// برومبت توليد الصور في Flow - هوية ثابتة وتصوير سينمائي
// ======================================================
// برومبت توليد الصور في Flow - هوية ثابتة وتصوير سينمائي
// ======================================================
function buildPrompt(pg, name, title) {
  const base = [
    'Create an extremely photorealistic live-action cinematic photograph for a premium personalized storybook, portrait 3:4 composition.',
    'It must look like a real frame captured by a high-end full-frame cinema camera: authentic skin pores, fine facial detail, natural hair strands, realistic fabric texture, physically believable lighting, accurate anatomy, natural hands, rich environmental detail, subtle film grain, controlled highlights and refined cinematic color grading.',
    'IDENTITY LOCK IS THE HIGHEST PRIORITY. Use the attached reference photo as the identity source for the main person. Preserve the exact recognizable face and facial geometry, eye spacing, nose, lips, jawline, cheeks, skin tone and distinctive identity details. The same real person must be unmistakably recognizable in every page.',
    'Do not beautify, redesign, stylize, age up, age down, infantilize or reinterpret the person. Do not assume or state an age. Never invent facial, hair, eye or body characteristics that cannot be seen in the reference photo.',
    'Use the reference photo for identity only. Do not copy its clothes, pose, expression, camera angle, lighting or background. Clothing, gesture, expression, posture and activity may change naturally to fit each story event while the face and identity remain consistent.',
    'Create a richly layered believable environment with meaningful foreground, midground and background details related to the exact scene. Use realistic materials, atmospheric depth, motivated practical lights and a clear visual focal point. Every prop must support the story, not look randomly decorative.',
    'Use a distinct cinematic composition for each event: vary shot size, camera height, lens perspective and subject placement while keeping the same person. The pages should feel like connected frames from one high-budget live-action film.',
    'No cartoon, illustration, anime, painting, watercolor, comic-book look, toy-like appearance, plastic skin, artificial 3D render, exaggerated proportions, collage, split screen or poster layout.',
    'Absolutely NO text, letters, numbers, typography, captions, logos, watermarks or borders anywhere in the photograph.',
    'Keep the main face and important action in the upper 70 percent. Keep the lower 27 percent visually calm and relatively uncluttered for a separate printed story panel. Do not draw any panel or frame.'
  ].join(' ');
  if (pg.cover) return base + ' This is the cinematic front-cover photograph. Create a memorable, emotionally engaging hero composition that symbolizes the person’s dream. Leave tasteful uncluttered negative space near the upper area for a title that will be typeset later. No text of any kind.';
  return base + ' Depict this exact story event naturally and specifically: ' + String(pg.scene || '') + ' Show a clear meaningful action, authentic emotion and several carefully chosen environmental details. Keep visual continuity with the same person from the reference image, but do not repeat the same pose or camera composition.';
}


// ======================================================
// أدوات الصفحة
// ======================================================

async function gridImages(page) {
  return page.evaluate(() => {
    const out = [];

    for (const im of document.querySelectorAll('img')) {
      const src = im.currentSrc || im.src || '';
      const m = src.match(/flow-content\.google\/image\/([0-9a-f-]{36})/);
      const r = im.getBoundingClientRect();

      if (m && r.width > 100 && r.height > 100 && r.bottom < 590) {
        out.push({ id: m[1], src });
      }
    }

    return out;
  });
}

async function promptChips(page) {
  return page.evaluate(() => [...document.querySelectorAll('img')].filter((im) => {
    const r = im.getBoundingClientRect();
    return r.top >= 585 && r.width > 15 && r.left > 340 && r.right < 960;
  }).length);
}

async function findTiles(page) {
  return page.evaluate(() => {
    const out = [];

    for (const el of document.querySelectorAll('img, canvas, video, [style*="background-image"]')) {
      const r = el.getBoundingClientRect();

      if (r.width > 40 && r.height > 40 && r.left > 260 && r.right < 670 && r.top > 60 && r.bottom < 580) {
        out.push({
          tag: el.tagName,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          w: Math.round(r.width),
          h: Math.round(r.height)
        });
      }
    }

    return out;
  });
}

async function openFlowSettings(page) {
  const candidates = [
    page.locator('button[aria-label="مشغِّل الإعدادات"]').first(),
    page.locator('button.settings-trigger-button').first(),
    page.locator('button[aria-label*="settings" i]').first()
  ];

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const button of candidates) {
      try {
        if (!(await button.count())) continue;

        await button.waitFor({ state: 'visible', timeout: 8000 });
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(500);
        await button.click({ timeout: 12000, force: true });

        const menuOpened = await page.waitForFunction(() => {
          const visible = (el) => {
            if (!el) return false;

            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);

            return r.width > 0 &&
              r.height > 0 &&
              st.visibility !== 'hidden' &&
              st.display !== 'none';
          };

          const text = [...document.querySelectorAll('body *')]
            .filter(visible)
            .map(el => (el.innerText || '').trim())
            .filter(t => t && t.length < 100);

          return text.some(t => t === '3:4') && text.some(t => t === 'x1');
        }, null, { timeout: 10000, polling: 300 })
          .then(() => true)
          .catch(() => false);

        if (menuOpened) return true;

        const anyMenu = await page.locator('[role="menu"], [role="dialog"], .cdk-overlay-pane')
          .evaluateAll(els => els.some(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }))
          .catch(() => false);

        if (anyMenu) return true;

        throw new Error('الزر استجاب لكن قائمة الإعدادات لم تظهر');
      } catch (error) {
        lastError = error;
      }
    }

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1000 * attempt);
  }

  await page.screenshot({
    path: path.join(DBG_DIR || '.', 'dbg-settings-open-failed.png'),
    timeout: 10000
  }).catch(() => {});

  throw new Error(
    'تعذر فتح إعدادات Flow بعد 3 محاولات: ' +
    (lastError?.message || 'الزر غير متاح')
  );
}

async function openAddMenu(page) {
  for (let a = 1; a <= 3; a++) {
    try {
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(700);

      await page.locator(S.addBtn).first().click({
        timeout: 15000,
        force: a >= 2
      });
    } catch (e) {
      console.log(`  فتح قايمة الإضافة: محاولة ${a} فشلت`);
    }

    const opened = await page.locator('[role="tab"]')
      .filter({ hasText: 'عمليات التحميل' })
      .first()
      .waitFor({ state: 'visible', timeout: 7000 })
      .then(() => true)
      .catch(() => false);

    if (opened) {
      await sleep(800);
      return;
    }
  }

  throw new Error('قايمة الإضافة ماتفتحتش بعد 3 محاولات');
}

async function selectUploadedRef(page, waitMs = 60000) {
  await page.locator('[role="tab"]')
    .filter({ hasText: 'عمليات التحميل' })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});

  const item = page.locator('button.asset-item[role="option"]').first();

  try {
    await item.waitFor({ state: 'visible', timeout: waitMs });
  } catch (_) {
    console.log('  عنصر الصورة المرفوعة ماظهرش في القايمة');

    await page.screenshot({
      path: path.join(DBG_DIR || '.', 'dbg-no-tile.png'),
      timeout: 10000
    }).catch(() => {});

    return false;
  }

  await sleep(2500);

  const cls = (await item.getAttribute('class').catch(() => '')) || '';

  if (!/asset-item-active/.test(cls)) {
    await item.click({ timeout: 8000 });
    await sleep(2000);
  }

  await page.waitForFunction(() => {
    const im = document.querySelector('img.detail-preview-image');
    return im && im.complete && im.naturalWidth > 0;
  }, null, { timeout: 90000, polling: 1000 })
    .catch(() => console.log('  معاينة الصورة ماظهرتش، هكمّل برضه'));

  await page.waitForFunction(() => {
    const b = document.querySelector('.bottom-actions button') ||
      document.querySelector('.bottom-actions');

    return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  }, null, { timeout: 30000, polling: 1000 }).catch(() => {});

  await sleep(1000);

  const bar = page.locator('.bottom-actions').first();

  const tries = [
    page.locator('.bottom-actions button').first(),
    page.getByRole('button', { name: 'الإضافة إلى الطلب' }).first(),
    bar
  ];

  let closed = false;

  for (const t of tries) {
    try {
      if ((await t.count()) === 0) continue;

      await t.click({ timeout: 6000 });
      await sleep(2500);

      if (!(await bar.isVisible().catch(() => false))) {
        closed = true;
        break;
      }
    } catch (_) {}
  }

  await page.screenshot({
    path: path.join(DBG_DIR || '.', 'dbg-after-add.png'),
    timeout: 10000
  }).catch(() => {});

  if (!closed) {
    console.log('  القايمة لسه مفتوحة بعد الضغط على "الإضافة إلى الطلب"');

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(800);

    return false;
  }

  await sleep(1500);

  console.log(
    '  اتضافت للبرومبت، صور في خانة البرومبت=' +
    (await promptChips(page))
  );

  return true;
}

async function reattachRef(page) {
  await openAddMenu(page);
  await sleep(2000);
  await selectUploadedRef(page, 30000);
}

// ======================================================
// تحميل الصور مع الحفاظ على الجودة الأصلية
// ======================================================

async function download(context, src, file) {
  const sharp = require('sharp');

  const r = await context.request.get(src, {
    headers: { referer: HOME }
  });

  if (!r.ok()) {
    throw new Error('تحميل الصورة فشل: ' + r.status());
  }

  const buf = await r.body();
  const info = await sharp(buf).metadata();

  console.log(
    '  الصورة: ' +
    info.width + 'x' + info.height + ' ' +
    info.format + ' ' +
    ((buf.length / 1024) | 0) + 'KB'
  );

  if (info.format === 'jpeg' || info.format === 'jpg') {
    fs.writeFileSync(file, buf);
  } else {
    await sharp(buf)
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toFile(file);
  }
}

// ======================================================
// إعدادات مزودي الذكاء الاصطناعي
// ======================================================

function readConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
    );
  } catch (_) {
    return {};
  }
}

function getGeminiSettings() {
  const cfg = readConfig();

  const apiKey =
    process.env.GEMINI_API_KEY ||
    cfg.GEMINI_API_KEY ||
    '';

  const model =
    process.env.GEMINI_MODEL ||
    cfg.GEMINI_MODEL ||
    'gemini-3.6-flash';

  return { apiKey, model };
}

function getOpenRouterSettings() {
  const cfg = readConfig();

  const apiKey =
    process.env.OPENROUTER_API_KEY ||
    cfg.OPENROUTER_API_KEY ||
    '';

  const model =
    process.env.OPENROUTER_MODEL ||
    cfg.OPENROUTER_MODEL ||
    'openrouter/free';

  return { apiKey, model };
}

// ======================================================
// برومبت كتابة القصة - مناسب لأي عمر دون افتراض أنه طفل
// ======================================================
// برومبت كتابة القصة - مناسب لأي عمر دون افتراض أنه طفل
// ======================================================
function storyPrompt(meta) {
  return `أنت مؤلف محترف لقصص مصورة شخصية ذات جودة أدبية وسينمائية عالية. اكتب قصة أصلية مترابطة يكون بطلها الشخص صاحب الصورة المرجعية.

اسم صاحب القصة: ${meta.name}

الحلم أو الهدف كما كتبه صاحب الطلب:
<dream>
${meta.dream}
</dream>

قواعد إلزامية:
1) لا تفترض أن بطل القصة طفل. قد يكون طفلًا أو مراهقًا أو بالغًا أو أكبر سنًا. لا تذكر عمرًا أو وصفًا عمريًا من عندك إطلاقًا، ولا تستخدم كلمة طفل أو صغير إلا إذا كان ذلك مثبتًا صراحة في بيانات الطلب.
2) اجعل صاحب الصورة هو الشخصية الرئيسية في جميع الأحداث. لا تخترع ملامح أو لون شعر أو عينين أو تفاصيل جسدية؛ هذه التفاصيل تؤخذ من الصورة المرجعية فقط.
3) اكتب بالعربية الفصحى المبسطة، بأسلوب دافئ وذكي ومؤثر، يناسب طبيعة الحلم دون التصريح بعمر الشخصية.
4) أنشئ 10 صفحات بالضبط: الصفحة الأولى غلاف، والصفحات 2 إلى 10 تسعة أحداث مترابطة.
5) ابنِ مسارًا متماسكًا: تقديم الحلم، قرار البداية، خطوات عملية، عقبة واقعية، اكتشاف أو مساعدة، تدريب وتطور، انتكاسة أو تحدٍ أكبر، حل ذكي، ثم إنجاز أو تقدم ملموس ونهاية مُرضية.
6) اجعل كل حدث مرتبطًا مباشرة بالحلم أو الهدف المحدد. تجنب القصص العامة والحشو وتكرار المعنى.
7) نص كل صفحة داخلية جملتان واضحتان تقريبًا، من 20 إلى 32 كلمة عربية، والأفضل 24 إلى 28 كلمة. لا تستخدم التشكيل أو الحركات.
8) اكتب scene باللغة الإنجليزية فقط. اجعله وصفًا بصريًا محددًا غنيًا بالتفاصيل: المكان، الفعل الأساسي، الانفعال، العناصر المهمة، الإضاءة والجو العام. يجب أن يكون لكل صفحة حدث بصري مختلف فعلًا.
9) لا تكتب أي نص أو لافتات أو حروف داخل وصف scene؛ سيُضاف النص العربي والتصميم لاحقًا أثناء إخراج الكتاب.
10) لا تفترض مهنة أو مكانًا أو علاقة أو شخصية مساعدة غير لازمة للحلم. اجعل أي شخصية مساعدة منطقية ومفيدة للحبكة.
11) اجعل التحديات آمنة وغير عنيفة وغير مخيفة، ومناسبة لطبيعة الحلم.
12) اجعل النهاية مؤثرة ومشبعة، وتُظهر تقدمًا حقيقيًا أو إنجازًا مرتبطًا بالهدف، دون ادعاء أن الحلم تحقق بالكامل إذا لم يكن ذلك منطقيًا.
13) الغلاف مشهد بصري قوي يرمز للحلم. اجعل text فارغًا تمامًا وcover=true.
14) الصفحات الداخلية cover=false وبها نص عربي مستوفٍ لعدد الكلمات.
15) أخرج JSON صالحًا فقط دون Markdown أو مقدمات أو تعليقات.

المخطط:
{
  "title": "عنوان عربي جذاب",
  "pages": [
    { "scene": "Detailed English cinematic visual description", "text": "", "cover": true },
    { "scene": "Detailed English cinematic visual description", "text": "نص عربي من جملتين ومن 20 إلى 32 كلمة", "cover": false }
  ]
}

يجب أن تحتوي pages على 10 عناصر بالضبط. راجع ترابط الأحداث وعدد كلمات كل صفحة قبل إخراج JSON.`;
}


// ======================================================
// استخراج JSON والتحقق من القصة
// ======================================================

function extractJsonObject(value) {
  let text = String(value || '').trim();

  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');

  if (first >= 0 && last > first) {
    text = text.slice(first, last + 1);
  }

  return JSON.parse(text);
}

function stripArabicMarks(value) {
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(value) {
  const text = stripArabicMarks(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function validateStory(story, provider) {
  if (
    !story ||
    !story.title ||
    !Array.isArray(story.pages) ||
    story.pages.length !== 10
  ) {
    throw new Error(
      `${provider} لم يلتزم بعدد الصفحات المطلوب. المطلوب غلاف + 9 أحداث، والواصل ${story?.pages?.length || 0}.`
    );
  }

  story.title = stripArabicMarks(story.title);

  if (!story.title) {
    throw new Error(`${provider} لم يكتب عنوانًا للقصة.`);
  }

  const validatedPages = [];

  for (let i = 0; i < story.pages.length; i++) {
    const pg = story.pages[i];
    const pageNumber = i + 1;

    if (!pg || typeof pg.scene !== 'string' || !pg.scene.trim()) {
      throw new Error(`وصف المشهد ناقص في الصفحة ${pageNumber}.`);
    }

    if (typeof pg.cover !== 'boolean') {
      throw new Error(`قيمة الغلاف غير صحيحة في الصفحة ${pageNumber}.`);
    }

    if (i === 0) {
      if (pg.cover !== true) {
        throw new Error('الصفحة الأولى يجب أن تكون الغلاف cover=true.');
      }

      if (typeof pg.text !== 'string' || pg.text.trim() !== '') {
        throw new Error('نص الغلاف يجب أن يكون فارغًا تمامًا.');
      }

      validatedPages.push({
        scene: pg.scene.trim(),
        text: null,
        cover: true
      });

      continue;
    }

    if (pg.cover !== false) {
      throw new Error(
        `الصفحة ${pageNumber} يجب أن تكون صفحة أحداث cover=false.`
      );
    }

    if (typeof pg.text !== 'string' || !stripArabicMarks(pg.text)) {
      throw new Error(`نص القصة ناقص في الصفحة ${pageNumber}.`);
    }

    const cleanText = stripArabicMarks(pg.text);
    const words = countWords(cleanText);

    if (words < 20 || words > 32) {
      throw new Error(
        `الصفحة ${pageNumber} تحتوي على ${words} كلمة فقط. المطلوب من 20 إلى 32 كلمة.`
      );
    }

    if (!/[\u0600-\u06FF]/.test(cleanText)) {
      throw new Error(
        `الصفحة ${pageNumber} لا تحتوي على نص عربي صحيح.`
      );
    }

    if (/[A-Za-z]/.test(cleanText)) {
      throw new Error(
        `الصفحة ${pageNumber} تحتوي على كلمات أو حروف إنجليزية.`
      );
    }

    validatedPages.push({
      scene: pg.scene.trim(),
      text: cleanText,
      cover: false
    });
  }

  story.pages = validatedPages;

  return story;
}

// ======================================================
// طلب القصة من Gemini
// ======================================================

async function requestGemini(meta) {
  const { apiKey, model } = getGeminiSettings();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY غير موجود في config.json');
  }

  const schema = {
    type: 'OBJECT',
    properties: {
      title: {
        type: 'STRING'
      },
      pages: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            scene: {
              type: 'STRING'
            },
            text: {
              type: 'STRING'
            },
            cover: {
              type: 'BOOLEAN'
            }
          },
          required: ['scene', 'text', 'cover']
        }
      }
    },
    required: ['title', 'pages']
  };

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(endpoint, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },

    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: storyPrompt(meta)
            }
          ]
        }
      ],

      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    }),

    signal: AbortSignal.timeout(120000)
  });

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      'Gemini رجّع استجابة غير مفهومة: ' + raw.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${data.error?.message || raw.slice(0, 300)}`
    );
  }

  const output = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || '')
    .join('')
    .trim();

  if (!output) {
    const reason =
      data.promptFeedback?.blockReason ||
      data.candidates?.[0]?.finishReason ||
      'لم يصل نص القصة';

    throw new Error(`Gemini لم يُنتج القصة: ${reason}`);
  }

  return validateStory(
    extractJsonObject(output),
    'Gemini'
  );
}

// ======================================================
// OpenRouter محفوظ كخيار يدوي فقط، وليس بديلًا تلقائيًا
// ======================================================

async function requestOpenRouter(meta) {
  const { apiKey, model } = getOpenRouterSettings();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY غير موجود في config.json');
  }

  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',

      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kotybook.site',
        'X-Title': 'Kotybook Storybook'
      },

      body: JSON.stringify({
        model,

        messages: [
          {
            role: 'system',
            content: 'أنت مؤلف قصص أطفال محترف. أعد JSON صالحًا فقط دون Markdown.'
          },
          {
            role: 'user',
            content: storyPrompt(meta)
          }
        ],

        temperature: 0.85,
        max_tokens: 8192,
        response_format: {
          type: 'json_object'
        }
      }),

      signal: AbortSignal.timeout(120000)
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      'OpenRouter رجّع استجابة غير مفهومة: ' + raw.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      `OpenRouter HTTP ${response.status}: ${data.error?.message || raw.slice(0, 300)}`
    );
  }

  const output = data.choices?.[0]?.message?.content;

  if (!output) {
    throw new Error('OpenRouter لم يُرجع نص القصة.');
  }

  return validateStory(
    extractJsonObject(output),
    'OpenRouter'
  );
}

// ======================================================
// تأليف القصة: Gemini فقط مع محاولتين
// ======================================================

async function generatePersonalizedStory(meta) {
  const { apiKey, model } = getGeminiSettings();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY غير موجود في config.json');
  }

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(
        `بدء تأليف القصة باستخدام Gemini ${model} - محاولة ${attempt}/2`
      );

      const story = await requestGemini(meta);

      console.log(
        `تم تأليف القصة بواسطة Gemini: "${story.title}" (غلاف + 9 صفحات).`
      );

      for (let i = 1; i < story.pages.length; i++) {
        console.log(
          `  الصفحة ${i + 1}: ${countWords(story.pages[i].text)} كلمة`
        );
      }

      return story;

    } catch (error) {
      lastError = error;

      console.log(
        `Gemini فشل في تأليف القصة (محاولة ${attempt}/2): ${error.message}`
      );

      if (attempt === 2) {
        break;
      }

      await sleep(3000);
    }
  }

  throw new Error(
    `فشل تأليف القصة باستخدام Gemini بعد محاولتين. السبب: ${lastError?.message || 'خطأ غير معروف'}`
  );
}

// ======================================================
// التوليد داخل Flow
// ======================================================

async function generateStoryFlow({
  meta,
  photoPath,
  outDir,
  limit
}) {
  DBG_DIR = outDir;

  // تأليف القصة قبل فتح Flow حتى لا ننشئ مشروعًا أو نرفع الصورة إذا تعذّر التأليف.
  let pages;

  if (meta.pages) {
    try {
      pages = typeof meta.pages === 'string'
        ? JSON.parse(meta.pages)
        : meta.pages;

    } catch (_) {
      throw new Error('بيانات الصفحات المرسلة ليست JSON صالحًا.');
    }

  } else {
    const story = await generatePersonalizedStory(meta);

    pages = story.pages;
    meta.title = story.title;
  }

  if (!Array.isArray(pages) || pages.length !== 10) {
    throw new Error(
      `القصة لازم تحتوي على 10 صفحات بالضبط (غلاف + 9 أحداث). الموجود: ${pages?.length || 0}`
    );
  }

  if (limit) {
    pages = pages.slice(0, limit);
  }

  meta.storyPages = pages;
  const storyFiles = [];
  storyFiles.storyPages = pages;

  const browser = await chromium.launch({
    
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    storageState: 'auth.json',
    locale: 'en-GB',
    viewport: {
      width: 1280,
      height: 720
    }
  });

  const page = await context.newPage();

  const dbg = (n) => page.screenshot({
    path: path.join(outDir, `dbg-${n}.png`),
    timeout: 10000
  }).catch(() => {});

  try {
    // 1) فتح مشروع جديد

    await page.goto(HOME, {
      waitUntil: 'domcontentloaded'
    });

    await sleep(7000);

    await page.locator(
      'button[aria-label="إغلاق البانر"], button[aria-label="Close banner"]'
    ).first().click({
      timeout: 2500
    }).catch(() => {});

    const newProjectButton = page
      .locator('button.new-project-button')
      .first();

    await newProjectButton.waitFor({
      state: 'visible',
      timeout: 30000
    });

    await newProjectButton.scrollIntoViewIfNeeded();
    await sleep(1000);

    await newProjectButton.click({
      timeout: 30000,
      force: true
    });

    await page.waitForURL(/\/project\//, {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    await page.locator(S.textbox).first().waitFor({
      state: 'visible',
      timeout: 60000
    });

    await sleep(2000);

    console.log('1) مشروع جديد:', page.url());

    // 2) الأبعاد 3:4 وصورة واحدة

    await openFlowSettings(page);
    await sleep(700);

    const ratioOption = page
      .getByText('3:4', { exact: true })
      .first();

    await ratioOption.waitFor({
      state: 'visible',
      timeout: 10000
    });

    await ratioOption.click({
      timeout: 10000,
      force: true
    });

    await sleep(500);

    const countOption = page
      .getByText('x1', { exact: true })
      .first();

    await countOption.waitFor({
      state: 'visible',
      timeout: 10000
    });

    await countOption.click({
      timeout: 10000,
      force: true
    });

    await sleep(700);

    await dbg('settings');

    await page.keyboard.press('Escape');
    await sleep(800);

    console.log('2) الإعدادات: تم اختيار 3:4 و x1');

    // 3) رفع صورة الطفل واختيارها كمرجع

    await openAddMenu(page);
    await sleep(2000);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', {
        timeout: 15000
      }),

      page.locator('button')
        .filter({ hasText: 'تحميل وسائط' })
        .first()
        .click({
          timeout: 8000
        })
    ]);

    await chooser.setFiles(photoPath);
    await sleep(3000);

    console.log('  استنى رفع الصورة يخلص (لحد دقيقتين)...');

    await page.waitForFunction(() => {
      const im = document.querySelector('flow-image-tile img.image');
      return im && im.complete && im.naturalWidth > 0;
    }, null, {
      timeout: 120000,
      polling: 1000
    }).catch(() => {
      console.log('  الصورة المرفوعة ماخلصتش تحميل في دقيقتين');
    });

    await sleep(2000);
    await dbg('after-upload');

    const picked = await selectUploadedRef(page);

    await dbg('after-select');

    console.log(
      '3) الصورة المرجعية: اختيار=' + picked +
      ' ، صور في خانة البرومبت=' + (await promptChips(page))
    );

    // 4) توليد الصور صفحة بصفحة

    const known = new Set(
      (await gridImages(page)).map((x) => x.id)
    );

    const files = storyFiles;

    for (let i = 0; i < pages.length; i++) {
      const prompt = buildPrompt(
        pages[i],
        meta.name,
        meta.title
      );

      let done = false;

      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        try {
          console.log(
            `4) صفحة ${i + 1}/${pages.length} (محاولة ${attempt})`
          );

          if (REATTACH_EACH && i > 0) {
            await reattachRef(page);
          }

          const box = page.locator(S.textbox).first();

          await box.click();

          await page.keyboard.press('Control+A');
          await page.keyboard.press('Delete');
          await page.keyboard.insertText(prompt);

          await sleep(600);

          await dbg(`p${i + 1}-before`);

          await page.click(S.submit, {
            timeout: 10000
          });

          let fresh = null;

          const deadline = Date.now() + 240000;

          while (Date.now() < deadline && !fresh) {
            await sleep(3000);

            fresh = (await gridImages(page))
              .find((x) => !known.has(x.id)) || null;
          }

          if (!fresh) {
            throw new Error('الصورة ماظهرتش في 4 دقايق');
          }

          await sleep(3000);

          const settled = (await gridImages(page))
            .find((x) => x.id === fresh.id) || fresh;

          const file = path.join(
            outDir,
            `flow-${String(i + 1).padStart(2, '0')}.jpg`
          );

          await download(
            context,
            settled.src,
            file
          );

          known.add(fresh.id);
          files.push(file);

          done = true;

        } catch (e) {
          console.log(
            `  فشلت: ${e.message.split('\n')[0]}`
          );

          await dbg(`page${i + 1}-try${attempt}`);

          if (attempt === 2) {
            throw e;
          }
        }
      }
    }

    return files;

  } catch (e) {
    await dbg('error');
    throw e;

  } finally {
    await browser.close();
  }
}

// ======================================================
// التصدير
// ======================================================

module.exports = {
  generateStoryFlow,
  defaultPages,
  buildPrompt,
  storyTitle
};
