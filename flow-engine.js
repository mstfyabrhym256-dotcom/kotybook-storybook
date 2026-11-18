 // محرك Flow: يفتح مشروع جديد، يرفع صورة الطفل، يولّد صورة لكل صفحة (4:3 بالعرض)، وينزّلها

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
// برومبت توليد الصور في Flow
// ======================================================

function buildPrompt(pg, name, title, dream, subtitle, age, gender, pageIndex) {
  const childName = String(name || '').trim();
  const childDream = String(dream || '').trim();
  const childAgeGender = [String(gender || '').trim(), String(age || '').trim()]
    .filter(Boolean).join(' ') || 'as shown in the reference image';
  const storyText = String(pg.text || '').trim();
  const scenePrompt = String(pg.scene || '').trim();
  const watermark = 'kotybook 01276626592';
  const formatRule = 'Flat, horizontal (4:3) full-bleed artwork, landscape orientation wider than tall, no borders, no frames, no book spines, no digital UI mockups.';
  const faceRule = `IDENTITY LOCK — this is the SAME real child in every single page of this book. Use the uploaded reference photo as the sole and exact identity source for ${childName} (${childAgeGender}). Preserve the child's recognizable face with maximum fidelity: same facial proportions, eyes, eyebrows, nose, lips, cheeks, skin tone and texture, hairline, hairstyle and hair color. Do not reinterpret, beautify, age up/down, replace, blend, or redesign the child. Never create a lookalike or a different child. The face, hair and visible skin remain natural photorealistic live-action photography; absolutely no cartoon, illustration, anime, doll-like, or 3D treatment on the child. Keep the same identity, apparent age and hairstyle across all pages and camera angles.`;
  const uniformRule = `CHARACTER CONTINUITY — dress the same child in one consistent, realistic career uniform appropriate to the dream of ${childDream}. Keep the uniform's exact colors, design, accessories, fit and details identical from page to page; only show practical changes required by the scene. Real natural fabric, believable folds and lighting. Do not randomly change clothes, colors, badges, hairstyle or accessories between pages.`;
  const environmentRule = `WORLD STYLE — create a vibrant, rich, premium 3D animated Pixar-style storybook environment matching ${childDream}, with colorful detailed surroundings, cinematic lighting and soft depth of field. The environment and objects are stylized 3D; the child's real face, hair, skin and body remain photorealistic. Maintain the same visual art direction, color grading and lighting quality throughout the entire book.`;
  const textRule = 'LANGUAGE AND LETTERING RULE — every readable word in the artwork must be in correct Arabic only, written right-to-left with properly connected Arabic letters and correct spelling. Never use English, Latin letters, transliteration, fake Arabic-looking symbols, random glyphs, gibberish, or invented text. Do not translate, paraphrase, shorten, duplicate or add any words to the supplied Arabic text. Keep the Arabic lettering large, clear, correctly shaped and fully legible.';
  const brandRule = `Render the exact tiny subtle white sans-serif watermark "${watermark}" with faint drop shadow in the very bottom-left corner.`;

  if (pg.cover) {
    return [
      scenePrompt,
      'FINAL COVER REQUIREMENTS:',
      formatRule,
      faceRule,
      uniformRule,
      environmentRule,
      textRule,
      `At the top center, render the exact Arabic main title "${String(title || '').trim()}" and subtitle "${String(subtitle || '').trim()}" exactly as supplied. Use elegant, clearly legible, correctly connected Arabic typography with proper right-to-left direction. Preserve every letter and word exactly; do not add English text or decorative pseudo-lettering. Integrate the title beautifully with subtle glossy 3D depth, career-related icons, stars and clouds without obscuring the child's face.`,
      brandRule
    ].filter(Boolean).join('\n\n');
  }

  return [
    scenePrompt,
    'FINAL INTERIOR PAGE REQUIREMENTS:',
    formatRule,
    faceRule,
    uniformRule,
    environmentRule,
    textRule,
    `Render this exact Egyptian Arabic story paragraph verbatim, with no changes, omissions, substitutions, translations or extra words: "${storyText}"`,
    'Place the complete Arabic paragraph in a clean, uncluttered open area at the top or bottom. Use a warm, friendly, highly legible rounded Arabic children’s font, correct connected letterforms and right-to-left reading order. Use high-contrast white with soft pastel yellow/blue accents over an extremely soft borderless feathered defocus blur directly behind the letters only. Keep all words inside the image with comfortable spacing; absolutely no boxes, rectangular panels, English lettering or decorative pseudo-text.',
    pageIndex === 3 ? 'COUNTING GAME: show exactly 3 identical items of one career-related type and exactly 5 identical items of a different career-related type. Make every item individually visible and countable, with dotted chalk-style guide lines on the ground.' : '',
    pageIndex === 7 ? 'MAZE GAME: show a hand-drawn colorful dotted-line labyrinth on a clipboard or map, with the exact Arabic labels "البداية" and "النهاية" clearly placed at its start and finish; the reader must be able to trace the path around an obstacle.' : '',
    brandRule
  ].filter(Boolean).join('\n\n');
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
  // استخدم العناصر الظاهرة فقط؛ قد يحتوي Flow على أزرار إعدادات مخفية
  // قبل الزر الفعلي، لذلك لا نستخدم first() قبل فلترة :visible.
  const candidates = [
    page.locator('button[aria-label="مشغِّل الإعدادات"]:visible').first(),
    page.locator('button.settings-trigger-button:visible').first(),
    page.locator('button[aria-label*="settings" i]:visible').first()
  ];

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const button of candidates) {
      try {
        if (!(await button.count())) continue;

        await button.waitFor({ state: 'visible', timeout: 5000 });
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(500);
        await button.click({ timeout: 12000 });

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

          return text.some(t => t === '4:3') && text.some(t => t === 'x1');
        }, null, { timeout: 10000, polling: 300 })
          .then(() => true)
          .catch(() => false);

        if (menuOpened) return true;

        const anyMenu = await page.locator('[role="menu"], [role="dialog"], .cdk-overlay-pane')
          .evaluateAll(els => els.some(el => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 &&
              st.visibility !== 'hidden' && st.display !== 'none';
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
    (lastError?.message || 'زر الإعدادات الظاهر غير متاح')
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

async function download(context, src, fileBase) {
  const sharp = require('sharp');

  const r = await context.request.get(src, {
    headers: { referer: HOME }
  });

  if (!r.ok()) {    throw new Error('تحميل الصورة فشل: ' + r.status());  }

  const buf = await r.body();
  const info = await sharp(buf).metadata();

  console.log(
    '  الصورة: ' +
    info.width + 'x' + info.height + ' ' +
    info.format + ' ' +
    ((buf.length / 1024) | 0) + 'KB'
  );

  // Keep original JPEG/PNG bytes untouched. Convert other formats to
  // lossless PNG because pdf-utils.js embeds JPG and PNG directly.
  if (info.format === 'jpeg' || info.format === 'jpg') {
    const target = fileBase + '.jpg';
    fs.writeFileSync(target, buf);
    return target;
  }

  if (info.format === 'png') {
    const target = fileBase + '.png';
    fs.writeFileSync(target, buf);
    return target;
  }

  const target = fileBase + '.png';
  await sharp(buf).png().toFile(target);
  return target;
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


// ======================================================
// برومبت كتابة القصة - مناسب لأي عمر دون افتراض أنه طفل
// ======================================================

function storyPrompt(meta) {
  const name = String(meta.name || '').trim();
  const dream = String(meta.dream || '').trim();
  const age = String(meta.age || meta.childAge || '').trim();
  const gender = String(meta.gender || meta.childGender || '').trim();
  const ageGender = [gender, age].filter(Boolean).join(' ') || 'غير محدد';

  return `=========================================
[بيانات الطفل - عدّل هنا فقط]

- اسم الطفل: ${name}
- حلم الطفل / المهنة: ${dream}
- عمر الطفل والنوع: ${ageGender}
  =========================================

ACT AS AN EXPERT CHILDREN'S STORYBOOK AUTHOR AND AI IMAGE PROMPT ENGINEER.
Based on the child's details above, generate a complete, 11-page personalized children's storybook package (1 Front Cover + 10 Interior Narrative Pages).

STRICT OUTPUT STRUCTURE:

For EACH of the 11 pages (Page 0 Cover through Page 10), you MUST output TWO distinct parts clearly separated:

1. [النص العربي - بالعامية المصرية]: The exact story text to be printed on that page (for Pages 1–10, strictly 20 to 30 words in warm, simple, engaging Egyptian Colloquial Arabic "العامية المصرية البسيطة للأطفال" — NO Modern Standard Arabic/الفصحى. For Page 0, provide the Main Title and Subtitle).
2. [Image Generation Prompt]: A standalone, detailed English image-generation prompt tailored specifically for that single page, embedding the exact Arabic text from Part 1, and strictly enforcing all Core Visual, Typography, and Branding rules below.


---

STORY ARC & PAGE-BY-PAGE BLUEPRINT (Adapt dynamically to the child's dream/career):

- PAGE 0 (FRONT COVER): Heroic, action-packed cover scene showcasing the child in their dream role.
- PAGE 1 (The Calling): The child in their bedroom/study surrounded by toys, posters, and books related to their dream, imagining their future. (20–30 words Egyptian Arabic)
- PAGE 2 (The Preparation): Arriving at the main workplace/academy, wearing their full realistic uniform, checking tools/maps, and greeting their team. (20–30 words Egyptian Arabic)
- PAGE 3 (Visual Activity Game 1 - COUNTING GAME): An interactive counting scene! Dotted chalk-style guidelines drawn on the floor/ground—the reader must COUNT 3 specific items and 5 other specific items related to the career to help the child prepare. (20–30 words Egyptian Arabic)
- PAGE 4 (In Action / Command): The child inside the main workspace/vehicle/station, operating high-tech tools, screens, or equipment confidently. (20–30 words Egyptian Arabic)
- PAGE 5 (High Energy Moment): Peak excitement! Launching, speeding, lifting, or rushing into action in the golden morning light. (20–30 words Egyptian Arabic)
- PAGE 6 (Exploring / High Vantage): The child pointing proudly toward an impressive view or achievement related to their mission. (20–30 words Egyptian Arabic)
- PAGE 7 (Visual Activity Game 2 - MAZE / DOTTED PATH): Hand-drawn on a clipboard/map held or placed in front of the child! A colorful dotted-line labyrinth connecting "البداية" to "النهاية" through career-themed markers—the reader traces with their finger to avoid an obstacle. (20–30 words Egyptian Arabic)
- PAGE 8 (Overcoming the Challenge): High drama! A sudden obstacle, storm, or emergency occurs; the child bravely solves the problem and saves the day. (20–30 words Egyptian Arabic)
- PAGE 9 (Mission Accomplished): Warm sunset lighting, calm and proud resolution as the mission succeeds smoothly. (20–30 words Egyptian Arabic)
- PAGE 10 (Hero’s Return): Triumphant celebration! The child smiling proudly, waving to cheering crowds/friends, holding a symbolic trophy, badge, or logbook. (20–30 words Egyptian Arabic)


---

MANDATORY RULES TO INCLUDE IN EVERY SINGLE IMAGE PROMPT:

1. Format: Flat, horizontal (4:3) full-bleed artwork with NO borders, frames, book spines, or digital UI mockups.
2. Face & Realism: Keep the exact child from the reference image (${ageGender}, ${name}) maintaining 100% natural, photorealistic, lifelike facial features, skin texture, and hairstyle (strictly NO cartoon, 3D, or illustration filters on the child's face/body). Expressive, natural body language interacting with the scene.
3. Uniform: Realistic, natural-fabric career uniform tailored to the child's dream (with natural studio/outdoor lighting and real fabric folds, NOT cartoonish).
4. Environment: Vibrant, rich 3D toy-like Pixar-style world matching the career theme, with rich colors, lively details, and soft cinematic depth-of-field blur in the background.
5. Typography Rules:
   - On Page 0 (Cover): Render the Arabic Title and Subtitle at the top center as custom-drawn, interlocking, volumetric 3D artistic Arabic typography (تايبوجرافي فني) with glossy/glowing outlines, creatively woven with mini 3D career-related icons, stars, and clouds.
   - On Pages 1–10: Place the exact 20–30 word Egyptian Colloquial Arabic paragraph in natural open space at the top or bottom using a warm, friendly, rounded Arabic children's font (high-contrast white and soft pastel yellow/blue) over an extremely soft, borderless feathered defocus blur directly behind the text (NO boxes or rectangular edges). On Page 7, clearly render the Arabic labels "البداية" and "النهاية" at the maze start and end points.
6. Brand Watermark: In the very bottom-left corner of every single page, render a tiny, subtle, clean white sans-serif watermark with a faint drop shadow reading: "kotybook 01276626592".

Generate the complete 11-page script and all 11 individual prompts now.`;
}


// ======================================================
// استخراج JSON والتحقق من القصة
// ======================================================

const STORY_SYSTEM_INSTRUCTION = [
  'Return one valid JSON object only. Do not add Markdown or explanations.',
  'The JSON must contain title, subtitle, and pages.',
  'pages must contain exactly 11 objects in order: cover first, then the ten specified story pages.',
  'Each page object must contain scene, text, and cover.',
  'scene must be a standalone, detailed English image-generation prompt for that exact page and must embed that page text verbatim in Arabic.',
  'For page 0, set cover=true and text=""; put the exact Arabic main title in title and the exact Arabic subtitle in subtitle.',
  'For pages 1-10, set cover=false and write exactly 20 to 30 whitespace-separated Arabic words in simple Egyptian colloquial Arabic.',
  'Do not use Modern Standard Arabic in story text. Keep the story connected and personalized to the supplied child details.',
  'Every image prompt must preserve the real child in the reference photo with a natural photorealistic face and body, realistic career clothing, a colorful 3D toy-like Pixar-style environment, horizontal landscape 4:3 full-bleed composition, no borders, and the exact kotybook 01276626592 watermark at bottom-left.',
  'The cover prompt must render the exact title and subtitle in artistic Arabic 3D typography.',
  'Page 3 must show exactly 3 of one career-related item and exactly 5 of another career-related item for the counting game.',
  'Page 7 must show a clear traceable dotted maze with the exact Arabic labels البداية and النهاية.',
  'Do not add pages, omit any required page event, or change the child details.'
].join(' ');

const STORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scene: { type: 'string' },
          text: { type: 'string' },
          cover: { type: 'boolean' }
        },
        required: ['scene', 'text', 'cover']
      }
    }
  },
  required: ['title', 'subtitle', 'pages']
};

function extractJsonObject(value) {
  let text = String(value || '').trim();
  const fence = String.fromCharCode(96).repeat(3);
  text = text.replace(/^\x60{3}(?:json)?\s*/i, '')
    .replace(/\s*\x60{3}$/, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

function stripArabicMarks(value) {
  return String(value || '')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(value) {
  const text = stripArabicMarks(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function validateStory(story, provider) {
  if (!story || !story.title || !story.subtitle ||
      !Array.isArray(story.pages) || story.pages.length !== 11) {
    throw new Error(
      `${provider} لم يلتزم بالهيكل المطلوب: عنوان + عنوان فرعي + غلاف + 10 صفحات. عدد الصفحات: ${story && story.pages ? story.pages.length : 0}.`
    );
  }

  story.title = String(story.title).trim();
  story.subtitle = String(story.subtitle).trim();
  if (!story.title || !story.subtitle) {
    throw new Error(`${provider} لم يكتب عنوان الغلاف والعنوان الفرعي.`);
  }

  const validatedPages = [];
  for (let i = 0; i < story.pages.length; i++) {
    const pg = story.pages[i];
    if (!pg || typeof pg.scene !== 'string' || !pg.scene.trim()) {
      throw new Error(`الـ Image Generation Prompt ناقص في الصفحة ${i}.`);
    }
    if (typeof pg.cover !== 'boolean') {
      throw new Error(`قيمة الغلاف غير صحيحة في الصفحة ${i}.`);
    }

    if (i === 0) {
      if (pg.cover !== true || String(pg.text || '').trim() !== '') {
        throw new Error('الصفحة 0 يجب أن تكون الغلاف، ونصها يُحفظ في title وsubtitle فقط.');
      }
      validatedPages.push({ scene: pg.scene.trim(), text: '', cover: true });
      continue;
    }

    if (pg.cover !== false || typeof pg.text !== 'string' || !pg.text.trim()) {
      throw new Error(`بيانات الصفحة الداخلية ${i} غير مكتملة.`);
    }

    // Gemini may occasionally truncate the dedicated text field while still
    // embedding the complete Arabic paragraph verbatim inside the image prompt.
    // Recover only a quoted Arabic paragraph that independently passes every
    // existing length/language rule; otherwise fail closed as before.
    let sourceText = pg.text;
    let cleanText = stripArabicMarks(sourceText);
    let words = countWords(cleanText);

    if (words < 20 || words > 30) {
      const quotedCandidates = [
        ...pg.scene.matchAll(/["“]([^"”]{20,1200})["”]/g)
      ].map(match => match[1].trim());

      const recovered = quotedCandidates.find(candidate => {
        const normalized = stripArabicMarks(candidate);
        const candidateWords = countWords(normalized);
        return candidateWords >= 20 &&
          candidateWords <= 30 &&
          /\p{Script=Arabic}/u.test(normalized) &&
          !/[A-Za-z]/.test(normalized);
      });

      if (recovered) {
        sourceText = recovered;
        cleanText = stripArabicMarks(recovered);
        words = countWords(cleanText);
        console.log(`  الصفحة ${i}: استعادة النص العربي الكامل من وصف الصورة (${words} كلمة).`);
      }
    }

    if (words < 20 || words > 30) {
      throw new Error(`الصفحة ${i} تحتوي على ${words} كلمة. المطلوب من 20 إلى 30 كلمة بالضبط.`);
    }
    if (!/\p{Script=Arabic}/u.test(cleanText) || /[A-Za-z]/.test(cleanText)) {
      throw new Error(`النص في الصفحة ${i} لازم يكون عامية مصرية بالعربي فقط.`);
    }
    if (!pg.scene.includes(sourceText)) {
      throw new Error(`الـ Image Generation Prompt في الصفحة ${i} لا يحتوي النص العربي المطابق حرفيًا.`);
    }
    validatedPages.push({ scene: pg.scene.trim(), text: cleanText, cover: false });
  }
  story.pages = validatedPages;
  return story;
}


// ======================================================
// طلب القصة من Gemini
// ======================================================

async function requestGemini(meta) {
  const { apiKey, model } = getGeminiSettings();
  if (!apiKey) throw new Error('GEMINI_API_KEY غير موجود في متغيرات GitHub Actions.');

  const schema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      subtitle: { type: 'STRING' },
      pages: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            scene: { type: 'STRING' },
            text: { type: 'STRING' },
            cover: { type: 'BOOLEAN' }
          },
          required: ['scene', 'text', 'cover']
        }
      }
    },
    required: ['title', 'subtitle', 'pages']
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: STORY_SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: storyPrompt(meta) }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    }),
    signal: AbortSignal.timeout(180000)
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch (_) { throw new Error('Gemini رجّع استجابة غير مفهومة: ' + raw.slice(0, 300)); }

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}: ${data.error && data.error.message ? data.error.message : raw.slice(0, 300)}`);
  }

  const output = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [])
    .map(part => part.text || '').join('').trim();

  if (!output) {
    const reason = (data.promptFeedback && data.promptFeedback.blockReason) ||
      (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || 'لم يصل نص القصة';
    throw new Error(`Gemini لم يُنتج القصة: ${reason}`);
  }
  return validateStory(extractJsonObject(output), 'Gemini');
}


// ======================================================
// Grok (احتياطي تلقائي بعد فشل Gemini)
// ======================================================

async function requestGrok(meta) {
  const cfg = readConfig();
  const apiKey = process.env.GROK_API_KEY || cfg.GROK_API_KEY || '';
  const model = process.env.GROK_MODEL || cfg.GROK_MODEL || 'grok-4.7';
  if (!apiKey) throw new Error('GROK_API_KEY غير موجود؛ لا يمكن تشغيل المحرك الاحتياطي.');

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: STORY_SYSTEM_INSTRUCTION,
      input: storyPrompt(meta),
      temperature: 0.85,
      max_output_tokens: 16384,
      text: {
        format: {
          type: 'json_schema',
          name: 'kotybook_storybook',
          strict: true,
          schema: STORY_JSON_SCHEMA
        }
      }
    }),
    signal: AbortSignal.timeout(180000)
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch (_) { throw new Error('Grok رجّع استجابة غير مفهومة: ' + raw.slice(0, 300)); }

  if (!response.ok) {
    throw new Error(`Grok HTTP ${response.status}: ${data.error && data.error.message ? data.error.message : raw.slice(0, 300)}`);
  }

  const output = data.output_text || (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' || typeof part.text === 'string')
    .map(part => part.text || '')
    .join('').trim();

  if (!output) throw new Error('Grok لم يُرجع نص القصة في استجابة Responses API.');
  return validateStory(extractJsonObject(output), 'Grok');
}

// ======================================================
// Groq (احتياطي مجاني عند تعذّر Gemini)
// ======================================================

async function requestGroq(meta) {  const cfg = readConfig();
  const apiKey = process.env.GROQ_API_KEY || cfg.GROQ_API_KEY || '';
  const model = process.env.GROQ_MODEL || cfg.GROQ_MODEL || 'openai/gpt-oss-120b';
  if (!apiKey) throw new Error('GROQ_API_KEY غير موجود في متغيرات GitHub Actions.');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: STORY_SYSTEM_INSTRUCTION },
        { role: 'user', content: storyPrompt(meta) }
      ],
      temperature: 0.85,
      max_completion_tokens: 16384,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'kotybook_storybook',
          strict: true,
          schema: STORY_JSON_SCHEMA
        }
      }
    }),
    signal: AbortSignal.timeout(180000)
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch (_) { throw new Error('Groq رجّع استجابة غير مفهومة: ' + raw.slice(0, 300)); }

  if (!response.ok) {
    throw new Error(`Groq HTTP ${response.status}: ${data.error && data.error.message ? data.error.message : raw.slice(0, 300)}`);
  }

  const output = data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content
    ? data.choices[0].message.content.trim()
    : '';

  if (!output) {
    const reason = data.choices && data.choices[0] && data.choices[0].finish_reason;
    throw new Error(`Groq لم يُرجع نص القصة في Chat Completions API. السبب: ${reason || 'استجابة فارغة'}`);
  }

  return validateStory(extractJsonObject(output), 'Groq');
}

async function generateWithRetries(providerName, requestFn, meta, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {\n      console.log(`بدء تأليف القصة باستخدام ${providerName} - محاولة ${attempt}/${attempts}`);
      return await requestFn(meta);
    } catch (error) {
      lastError = error;
      console.error(`${providerName} فشل في تأليف القصة (محاولة ${attempt}/${attempts}): ${error.message}`);
      if (attempt < attempts) await sleep(3000);
    }
  }
  throw lastError || new Error(`${providerName} فشل لسبب غير معروف.`);
}

async function generatePersonalizedStory(meta) {
  let story;
  let geminiError;
  try {
    story = await generateWithRetries('Gemini الأساسي', requestGemini, meta, 2);
    console.log(`تم تأليف القصة بواسطة Gemini: "${story.title}" (غلاف + 10 صفحات).`);
  } catch (error) {
    geminiError = error;
    console.error(`فشل Gemini؛ التحويل التلقائي إلى Groq. السبب: ${error.message}`);
    try {
      story = await generateWithRetries('Groq الاحتياطي', requestGroq, meta, 2);
      console.log(`تم تأليف القصة بواسطة Groq الاحتياطي: "${story.title}" (غلاف + 10 صفحات).`);
    } catch (fallbackError) {
      throw new Error(`فشل Gemini الأساسي: ${geminiError.message} | وفشل Groq الاحتياطي: ${fallbackError.message}`);
    }
  }
  for (let i = 1; i < story.pages.length; i++) {
    console.log(`  الصفحة ${i}: ${countWords(story.pages[i].text)} كلمة`);
  }
  return story;
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
  if (!meta || !meta.name || !meta.dream) {
    throw new Error('بيانات القصة ناقصة: الاسم والحلم مطلوبان.');
  }

  if (!photoPath || !fs.existsSync(photoPath)) {
    throw new Error('الصورة المرجعية غير موجودة: ' + String(photoPath || ''));
  }

  if (!outDir) {
    throw new Error('مسار مجلد حفظ الصور غير محدد.');
  }

  fs.mkdirSync(outDir, { recursive: true });
  DBG_DIR = outDir;

  // تأليف القصة قبل فتح Flow حتى لا ننشئ مشروعًا أو نرفع الصورة إذا تعذّر التأليف.
  let pages;

  // احتفظ بنفس القصة عند إعادة تشغيل Flow بالكامل بعد تعثر مؤقت.
  // meta.storyPages تُملأ بعد أول تأليف، وتُستخدم في المحاولة التالية بدل إعادة تأليف القصة.
  const savedPages = meta.pages || meta.storyPages;

  if (savedPages) {
    try {
      pages = typeof savedPages === 'string'
        ? JSON.parse(savedPages)
        : savedPages;

    } catch (_) {
      throw new Error('بيانات الصفحات المرسلة ليست JSON صالحًا.');
    }

  } else {
    const story = await generatePersonalizedStory(meta);

    pages = story.pages;
    meta.title = story.title;
    meta.subtitle = story.subtitle;
  }

  if (!Array.isArray(pages) || pages.length !== 11) {
    throw new Error(
      `القصة لازم تحتوي على 11 صفحة بالضبط (غلاف + 10 أحداث). الموجود: ${pages?.length || 0}`
    );
  }

  if (limit) {
    pages = pages.slice(0, limit);
  }

  meta.storyPages = pages;
  const storyFiles = [];
  storyFiles.storyPages = pages;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    storageState: process.env.AUTH_STATE_PATH || 'auth.json',
    locale: 'en-GB',
    viewport: {
      width: 1280,
      height: 720
    }
  });

  let page = await context.newPage();

  const dbg = (n) => page.screenshot({
    path: path.join(outDir, `dbg-${n}.png`),
    timeout: 10000
  }).catch(() => {});

  try {
    // 1) فتح مشروع جديد

    await page.goto(HOME, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await sleep(7000);

    await page.locator(
      'button[aria-label="إغلاق البانر"], button[aria-label="Close banner"]'
    ).first().click({
      timeout: 2500
    }).catch(() => {});

    const homeDiagnostics = async () => {
      const details = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        body: (document.body?.innerText || '').slice(0, 5000),
        buttons: [...document.querySelectorAll('button')].slice(0, 80).map(b => ({
          text: (b.innerText || '').trim().slice(0, 100),
          aria: b.getAttribute('aria-label'),
          testid: b.getAttribute('data-testid'),
          cls: String(b.className || '').slice(0, 120),
          disabled: b.disabled
        }))
      })).catch(error => ({ error: error.message }));
      fs.writeFileSync(path.join(outDir, 'flow-home-diagnostics.json'), JSON.stringify(details, null, 2));
      await dbg('flow-home-not-ready');
    };

    // صفحة flow.google.com قد تكون صفحة تعريفية (/about)، لذلك ندخل مساحة العمل من زر CTA الرسمي.
    if (new URL(page.url()).pathname.replace(/\/$/, '') === '/about') {
      const cta = page.getByRole('button', { name: /^Create with Google Flow$/i }).first();
      await cta.waitFor({ state: 'visible', timeout: 20000 });
      await cta.scrollIntoViewIfNeeded();
      const pagesBefore = new Set(context.pages());
      await cta.click({ timeout: 30000 });
      console.log('  تم الضغط على Create with Google Flow؛ انتظار مساحة العمل...');

      let appPage = null;
      for (let i = 0; i < 35 && !appPage; i++) {
        await sleep(1000);
        const opened = context.pages().filter(p => !pagesBefore.has(p));
        if (opened.length) {
          appPage = opened[opened.length - 1];
          break;
        }
        if (new URL(page.url()).pathname.replace(/\/$/, '') !== '/about') appPage = page;
      }
      if (appPage) page = appPage;
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await sleep(5000);
    }

    const candidates = [
      page.locator('button.new-project-button:visible').first(),
      page.getByRole('button', { name: /new project|create project|مشروع جديد|إنشاء مشروع/i }).first(),
      page.locator('button[aria-label*="new project" i]:visible').first(),
      page.locator('button[data-testid*="new-project" i]:visible').first()
    ];

    let newProjectButton = null;
    for (const candidate of candidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: 10000 });
        newProjectButton = candidate;
        break;
      } catch (_) {}
    }

    if (!newProjectButton && !(await page.locator(S.textbox).first().isVisible().catch(() => false))) {
      await homeDiagnostics();
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (/accounts\.google\.com|sign in|تسجيل الدخول/i.test(page.url() + ' ' + bodyText)) {
        throw new Error('FLOW_LOGIN_REQUIRED: جلسة Google Flow منتهية أو تطلب تسجيل الدخول. راجع flow-home-diagnostics.json.');
      }
      throw new Error('FLOW_HOME_NOT_READY: لم نصل إلى مساحة إنشاء المشاريع بعد الضغط على زر الدخول الرسمي. تم حفظ تشخيص الصفحة والصورة.');
    }

    if (newProjectButton) {
      await newProjectButton.scrollIntoViewIfNeeded();
      await sleep(1000);
      await newProjectButton.click({ timeout: 30000 });
      await page.waitForURL(url => url.pathname.includes('/project/'), {
        timeout: 60000,
        waitUntil: 'domcontentloaded'
      });
    }

    await page.locator(S.textbox).first().waitFor({
      state: 'visible',
      timeout: 60000
    });

    await sleep(2000);

    console.log('1) مشروع جديد:', page.url());

    // 2) الأبعاد 4:3 بالعرض وصورة واحدة

    await openFlowSettings(page);
    await sleep(700);

    const ratioOption = page
      .getByText('4:3', { exact: true })
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

    console.log('2) الإعدادات: تم اختيار 4:3 و x1');

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
        meta.title,
        meta.dream,
        meta.subtitle,
        meta.age,
        meta.gender,
        i
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

          const fileBase = path.join(
            outDir,
            `flow-${String(i + 1).padStart(2, '0')}`
          );

          const savedFile = await download(
            context,
            settled.src,
            fileBase
          );

          known.add(fresh.id);
          files.push(savedFile);

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