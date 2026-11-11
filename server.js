
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

// ====== الإعدادات ======
const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.BOT_SECRET || 'غيّر-الكلمة-دي';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const API_SECRET = process.env.API_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const KEEP_DAYS = 7;
const PAGES_LIMIT = 10; // غلاف + 9 صفحات أحداث
const ENGINE = process.env.ENGINE || 'storybook';
const MAX_ATTEMPTS = 2;
const DAILY_CAP = Number(process.env.DAILY_CAP) || 5;
const GAP_MS = 30000;
const GEN_TIMEOUT_MS = 5 * 60 * 1000;
const STORYBOOK_URL = 'https://gemini.google.com/gem/storybook?hl=en';

// ====== Selectors ======
const SEL = {
  input: 'div[role="textbox"][contenteditable="true"]',
  uploadBtn: 'button[aria-label="Upload & tools"]',
  send: 'button[aria-label="Send message"]',
  generating: 'button[aria-label*="Stop"]',
  storyImages: 'img[src^="blob:"], img[src*="googleusercontent"]',
  storyText: 'message-content, .model-response-text'
};

const upload = multer({ dest: 'tmp/' });
const app = express();
// Enable CORS for Kotybook website
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-secret');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

fs.mkdirSync('out', { recursive: true });
fs.mkdirSync('tmp', { recursive: true });

// ====== الطابور ======
const QUEUE_FILE = 'queue.json';
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(f, d) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {
    return d;
  }
}

function loadQueue() {
  return readJson(QUEUE_FILE, []).filter((j) =>
    (j.result && j.result.pdfPath && fs.existsSync(j.result.pdfPath)) ||
    (j.photoPath && fs.existsSync(j.photoPath))
  );
}

function saveQueue() {
  try {
    fs.writeFileSync(
      QUEUE_FILE,
      JSON.stringify(
        queue.map((j) => ({
          meta: j.meta,
          photoPath: j.photoPath,
          tries: j.tries || 0,
          result: j.result || null
        })),
        null,
        1
      )
    );
  } catch (_) {}
}

let queue = loadQueue();
let busy = false;
let counter = { day: new Date().toDateString(), n: 0 };

function underCap() {
  if (ENGINE === 'flow') return true;
  const today = new Date().toDateString();
  if (counter.day !== today) counter = { day: today, n: 0 };
  return counter.n < DAILY_CAP;
}

// ====== الإنترنت ======
async function isOnline() {
  for (const u of [
    'https://www.google.com/generate_204',
    'https://flow.google.com/'
  ]) {
    try {
      await fetch(u, { signal: AbortSignal.timeout(6000) });
      return true;
    } catch (_) {}
  }
  return false;
}

async function waitForInternet() {
  let waited = false;

  while (!(await isOnline())) {
    if (!waited) console.log('>> النت فاصل، هستنى لحد ما يرجع...');
    waited = true;
    await sleepMs(15000);
  }

  if (waited) console.log('>> النت رجع');
}

// ====== الاتصال المباشر بـ Google Apps Script ======
async function callAppsScript(action, payload = {}) {
  if (!APPS_SCRIPT_URL || !API_SECRET) {
    throw new Error('إعدادات APPS_SCRIPT_URL أو API_SECRET ناقصة في config.json / start.js');
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      secret: API_SECRET,
      ...payload
    }),
    signal: AbortSignal.timeout(120000)
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error('رد Google Apps Script غير مفهوم: ' + raw.slice(0, 250));
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      data.error || data.message ||
      `Google Apps Script HTTP ${response.status}`
    );
  }

  return data;
}

// ====== رفع القصة إلى Google Drive ======
async function saveStoryToGoogle(job, result) {
  if (!result.pdfPath || !fs.existsSync(result.pdfPath)) {
    throw new Error('ملف PDF النهائي غير موجود على الجهاز');
  }

  const pdfBase64 = fs.readFileSync(result.pdfPath).toString('base64');

  return callAppsScript('completeStory', {
    code: job.meta.code,
    pdfBase64,
    fileName: result.title || `Kotybook-${job.meta.name}`
  });
}

async function retrySaveStory(job, result) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await saveStoryToGoogle(job, result);
    } catch (error) {
      lastError = error;

      console.error(
        `فشل رفع القصة إلى Google Drive (محاولة ${attempt}/3):`,
        error.message
      );

      if (attempt < 3) await sleepMs(15000);
    }
  }

  throw lastError;
}

// ====== حفظ PDF محليًا ======
function publishPdf(pdfPath) {
  fs.mkdirSync('out/files', { recursive: true });

  const token = crypto.randomBytes(16).toString('hex');
  const target = path.join('out/files', token + '.pdf');

  fs.renameSync(pdfPath, target);

  const sizeMB = +(
    fs.statSync(target).size / 1048576
  ).toFixed(1);

  return {
    pdfUrl: `${PUBLIC_URL}/files/${token}.pdf`,
    sizeMB,
    pdfPath: target
  };
}

// ====== مسح الملفات القديمة كل ساعة ======
setInterval(() => {
  try {
    for (const f of fs.readdirSync('out/files')) {
      const fp = path.join('out/files', f);

      if (
        Date.now() - fs.statSync(fp).mtimeMs >
        KEEP_DAYS * 86400000
      ) {
        fs.unlinkSync(fp);
      }
    }
  } catch (_) {}
}, 3600000).unref();

const MAX_JOB_TRIES = 2;

// ====== تشغيل طابور الطلبات ======
async function processQueue() {
  if (busy) return;

  busy = true;

  try {
    while (queue.length) {
      const job = queue[0];

      while (!job.result && !underCap()) {
        console.log(
          'وصلنا للحد اليومي (' + DAILY_CAP + ')، هستنى... طلبات منتظرة:',
          queue.length
        );

        await sleepMs(10 * 60 * 1000);
      }

      await waitForInternet();

      try {
        // لو القصة اتولدت قبل كده لكن رفعها فشل،
        // نعيد الرفع فقط بدون إعادة التوليد
        if (!job.result) {
          job.result = await generateStory(job);
          saveQueue();
        }

        const uploaded = await retrySaveStory(job, job.result);

        console.log(
          'تم رفع القصة إلى Google Drive وتحديث الشيت:',
          uploaded.url || ''
        );

      } catch (e) {
        const msg = String(e.message).split('\n')[0];

        console.error('تعذر إنهاء الطلب:', msg);

        if (
          !(await isOnline()) ||
          /net::ERR_|ENOTFOUND|ECONNRESET|ETIMEDOUT/.test(msg)
        ) {
          console.log('>> غالبًا مشكلة اتصال. الطلب محفوظ وسأحاول مرة أخرى.');

          await waitForInternet();
          await sleepMs(10000);
          continue;
        }

        job.tries = (job.tries || 0) + 1;
        saveQueue();

        // لو التوليد نفسه فشل، اسمح بمحاولة توليد أخرى
        if (!job.result && job.tries < MAX_JOB_TRIES) {
          console.log('>> هعيد توليد الطلب (' + job.tries + ')');
          await sleepMs(20000);
          continue;
        }

        // لو فشل الرفع بعد التوليد، نحتفظ بالطلب والـ PDF
        if (job.result) {
          console.error(
            'القصة اتولدت لكن رفعها فشل. هحتفظ بالطلب والـ PDF لإعادة المحاولة.'
          );

          await sleepMs(60000);
          continue;
        }

        console.error('فشل الطلب نهائيًا. راجع الخطأ أعلاه.');
      }

      queue.shift();
      saveQueue();

      if (job.photoPath && fs.existsSync(job.photoPath)) {
        fs.unlink(job.photoPath, () => {});
      }

      await sleepMs(GAP_MS);
    }
  } finally {
    busy = false;
  }
}

// ====== تصوير صفحات الكتاب ======
const BOOK_CLIP = {
  x: 520,
  y: 85,
  width: 690,
  height: 580
};

async function waitPageReady(page, maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  let last = null;

  while (Date.now() < deadline) {
    const loaded = await page.evaluate(async (clip) => {
      const inClip = (el) => {
        const r = el.getBoundingClientRect();

        return (
          r.width > 100 &&
          r.height > 100 &&
          r.right > clip.x &&
          r.left < clip.x + clip.width &&
          r.bottom > clip.y &&
          r.top < clip.y + clip.height
        );
      };

      const spinner = document.querySelector(
        'mat-spinner, mat-progress-spinner, [role="progressbar"]'
      );

      if (spinner && spinner.getBoundingClientRect().width > 0) {
        return false;
      }

      for (
        const img of [...document.querySelectorAll('img')].filter(inClip)
      ) {
        if (!(img.complete && img.naturalWidth > 0)) return false;

        try {
          await img.decode();
        } catch (_) {}
      }

      return true;
    }, BOOK_CLIP).catch(() => false);

    const buf = await page.screenshot({
      type: 'jpeg',
      quality: 40,
      clip: BOOK_CLIP,
      scale: 'css'
    }).catch(() => null);

    if (loaded && buf && last && Buffer.compare(buf, last) === 0) {
      return true;
    }

    last = buf;
    await page.waitForTimeout(900);
  }

  console.log('تحذير: الصفحة ماثبتتش في الوقت المحدد، هنصوّرها زي ما هي');
  return false;
}

async function capturePages(page, outDir) {
  const next = page.locator('button[aria-label="Next page"]').first();

  try {
    await next.waitFor({
      state: 'visible',
      timeout: 45000
    });
  } catch (_) {
    const tail = await page.evaluate(() =>
      (document.body.innerText || '')
        .replace(/\s+/g, ' ')
        .slice(-400)
    ).catch(() => '');

    throw new Error(
      'NO_BOOK: الكتاب ماظهرش. آخر كلام في الصفحة: ' + tail
    );
  }

  const files = [];
  const failed = [];
  let prev = null;

  for (let i = 1; i <= 30; i++) {
    await waitPageReady(page);

    const bad = await page
      .getByText(/couldn.?t generate this image/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (bad) failed.push(i);

    const file = path.join(
      outDir,
      `shot-${String(i).padStart(2, '0')}.png`
    );

    const buf = await page.screenshot({
      type: 'png',
      clip: BOOK_CLIP
    });

    fs.writeFileSync(file, buf);

    if (prev && Buffer.compare(prev, buf) === 0) {
      fs.unlinkSync(file);
      break;
    }

    files.push(file);
    prev = buf;

    const disabled =
      (await next.isDisabled().catch(() => true)) ||
      (await next.getAttribute('aria-disabled')) === 'true';

    if (disabled) break;

    await next.click();
    await page.waitForTimeout(600);
  }

  if (failed.length) {
    throw new Error(
      'IMAGE_FAILED: جوجل فشلت ترسم صور في الصفحات: ' +
      failed.join(', ')
    );
  }

  return files;
}

// ====== تجهيز الصفحات ======
async function makePages(shotFiles, outDir) {
  const sharp = require('sharp');
  const out = [];
  let n = 0;

  for (const f of shotFiles) {
    const meta = await sharp(f).metadata();

    const { data, info } = await sharp(f)
      .trim({ threshold: 18 })
      .toBuffer({ resolveWithObject: true });

    const isSpread = info.width > meta.width * 0.8;

    n++;

    const file = path.join(
      outDir,
      `page-${String(n).padStart(2, '0')}.jpg`
    );

    if (isSpread) {
      await sharp(f).jpeg({ quality: 90 }).toFile(file);

    } else {
      const px = await sharp(f)
        .extract({
          left: 2,
          top: 2,
          width: 1,
          height: 1
        })
        .removeAlpha()
        .raw()
        .toBuffer();

      const bg = {
        r: px[0],
        g: px[1],
        b: px[2]
      };

      const halfW = Math.floor(meta.width / 2);

      const cover = await sharp(data)
        .resize({
          width: halfW,
          height: meta.height,
          fit: 'inside'
        })
        .toBuffer({ resolveWithObject: true });

      const left = Math.floor(
        (halfW - cover.info.width) / 2
      );

      const top = Math.floor(
        (meta.height - cover.info.height) / 2
      );

      await sharp({
        create: {
          width: meta.width,
          height: meta.height,
          channels: 3,
          background: bg
        }
      })
        .composite([{
          input: cover.data,
          left,
          top
        }])
        .jpeg({ quality: 90 })
        .toFile(file);
    }

    out.push(file);
  }

  return out;
}

// ====== إنشاء PDF ======
async function buildPdf(imageFiles, outDir) {
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create();

  for (const f of imageFiles) {
    const data = new Uint8Array(fs.readFileSync(f));
    const img = await pdf.embedJpg(data);

    const w = img.width / 2;
    const h = img.height / 2;

    pdf.addPage([w, h]).drawImage(img, {
      x: 0,
      y: 0,
      width: w,
      height: h
    });
  }

  const target = path.join(outDir, 'story.pdf');

  fs.writeFileSync(target, await pdf.save());

  return target;
}

// ====== محرك إنشاء القصة ======
async function generateStoryFlowOnce({ meta, photoPath }) {
  const { generateStoryFlow, storyTitle } = require('./flow-engine');
  const { buildPdfFile, safeName } = require('./pdf-utils');

  const outDir = path.join(
    'out',
    `${Date.now()}-${meta.phone}`
  );

  fs.mkdirSync(outDir, { recursive: true });

  // نمرر نسخة قابلة للتحديث؛ محرك Gemini يضع عنوان القصة الذي ألّفه.
  const flowMeta = { ...meta };

  const files = await generateStoryFlow({
    meta: flowMeta,
    photoPath,
    outDir,
    limit: PAGES_LIMIT
  });

  const title = flowMeta.title || meta.title || storyTitle(meta.name);

  const pdfPath = path.join(
    outDir,
    safeName(title) + '.pdf'
  );

  await buildPdfFile(files, pdfPath, title);

  return {
    folder: outDir,
    pages: files.length,
    title,
    ...publishPdf(pdfPath)
  };
}

async function generateStoryOnce({ meta, photoPath }) {
  if (ENGINE === 'flow') {
    return generateStoryFlowOnce({ meta, photoPath });
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADLESS !== '0',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  try {
    const context = await browser.newContext({
      storageState: 'auth.json',
      locale: 'ar-EG',
      viewport: {
        width: 1280,
        height: 720
      },
      deviceScaleFactor: 2
    });

    const page = await context.newPage();

    await page.goto(STORYBOOK_URL, {
      waitUntil: 'domcontentloaded'
    });

    if (page.url().includes('accounts.google.com')) {
      throw new Error(
        'SESSION_EXPIRED: شغّل login.js تاني وجدد auth.json'
      );
    }

    await page
      .getByText(/customized picture book/i)
      .first()
      .waitFor({
        state: 'visible',
        timeout: 90000
      });

    await page.waitForSelector(SEL.input, {
      timeout: 30000
    });

    await page.click(SEL.uploadBtn);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', {
        timeout: 15000
      }),
      page
        .getByText(/upload (files|photos|image)|from computer/i)
        .first()
        .click()
    ]);

    await chooser.setFiles(photoPath);
    await page.waitForTimeout(5000);

    const prompt =
      `اعمل قصة مصورة للأطفال بطلها ${meta.name}. حلمه إنه يبقى ${meta.dream}. ` +
      `استخدم الصورة المرفقة كشكل للبطل. القصة بالعربية المبسطة، من 6 إلى 8 صفحات. اكتب على الغلاف اسم المؤلف: كوتي بوك.`;

    await page.click(SEL.input);
    await page.keyboard.insertText(prompt);
    await page.click(SEL.send);

    await page
      .waitForSelector(SEL.generating, {
        timeout: 30000
      })
      .catch(() => {});

    await page.waitForSelector(SEL.generating, {
      state: 'detached',
      timeout: GEN_TIMEOUT_MS
    });

    await page.waitForTimeout(5000);

    const outDir = path.join(
      'out',
      `${Date.now()}-${meta.phone}`
    );

    fs.mkdirSync(outDir, { recursive: true });

    await page
      .screenshot({
        path: path.join(outDir, 'result.png')
      })
      .catch(() => {});

    fs.writeFileSync(
      path.join(outDir, 'result.html'),
      await page.content(),
      'utf8'
    );

    const shots = await capturePages(page, outDir);

    if (!shots.length) {
      throw new Error(
        'NO_PAGES: ماتصوّرتش أي صفحة، راجع result.png'
      );
    }

    const pages = await makePages(shots, outDir);
    const pdf = await buildPdf(pages, outDir);

    return {
      folder: outDir,
      pages: pages.length,
      ...publishPdf(pdf)
    };

  } catch (e) {
    try {
      await browser.contexts()[0].pages()[0].screenshot({
        path: 'error.png',
        timeout: 10000
      });
    } catch (_) {}

    throw e;

  } finally {
    await browser.close();
  }
}

// ====== إعادة المحاولة عند فشل التوليد ======
async function generateStory(job) {
  let lastErr;

  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    if (!underCap()) {
      lastErr = lastErr || new Error(
        'DAILY_CAP: وصلنا للحد اليومي'
      );
      break;
    }

    counter.n++;

    try {
      return await generateStoryOnce(job);

    } catch (e) {
      lastErr = e;

      console.log(
        `المحاولة ${a} من ${MAX_ATTEMPTS} فشلت: ${e.message}`
      );

      if (!/^(IMAGE_FAILED|NO_BOOK)/.test(e.message)) {
        break;
      }
    }
  }

  throw lastErr;
}

// ====== رابط تحميل PDF المحلي ======
app.get('/files/:name', (req, res) => {
  if (!/^[a-f0-9]{32}\.pdf$/.test(req.params.name)) {
    return res.status(404).send('Not found');
  }

  const fp = path.join(
    __dirname,
    'out/files',
    req.params.name
  );

  if (!fs.existsSync(fp)) {
    return res.status(404).send('Expired or not found');
  }

  res.download(fp, 'story.pdf');
});

// ====== تجهيز صورة الطفل ======
function normalizePhoto(req) {
  if (!req.file) return null;

  const MIME_EXT = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic'
  };

  let ext = (
    path.extname(req.file.originalname || '') || ''
  ).toLowerCase();

  if (!/^\.(jpe?g|png|webp|heic)$/.test(ext)) {
    ext = MIME_EXT[req.file.mimetype] || '.jpg';
  }

  const photoPath = req.file.path + ext;

  fs.renameSync(req.file.path, photoPath);

  return photoPath;
}

// ====== استقبال طلبات الموقع ======
async function handleWebsiteRequest(req, res) {
  const body = req.body || {};
  const type = String(body.type || 'story').trim().toLowerCase();

  try {
    // الاستعلام عن حالة القصة
    if (type === 'status') {
      if (!body.code || !body.phone) {
        return res.status(400).send(
          'مطلوب الكود ورقم الهاتف'
        );
      }

      const result = await callAppsScript('status', {
        code: String(body.code).trim(),
        phone: String(body.phone).trim()
      });

      return res
        .status(200)
        .type('text/plain; charset=utf-8')
        .send(result.message || 'قيد التحضير');
    }

    if (
      type !== 'story' &&
      type !== 'create' &&
      type !== 'generate'
    ) {
      return res.status(400).send('نوع الطلب غير صحيح');
    }

    const { name, phone, dream, code } = body;

    if (!name || !phone || !dream || !code || !req.file) {
      if (req.file) fs.unlink(req.file.path, () => {});

      return res.status(400).send(
        'بيانات الطلب أو صورة الطفل ناقصة'
      );
    }

    // حجز الكود في Google Sheets
    await callAppsScript('claimCode', {
      code: String(code).trim(),
      name: String(name).trim(),
      phone: String(phone).trim(),
      dream: String(dream).trim()
    });

    const photoPath = normalizePhoto(req);

    const meta = {
      name: String(name).trim(),
      phone: String(phone).trim(),
      dream: String(dream).trim(),
      code: String(code).trim(),
      pages: body.pages,
      title: body.title
    };

    queue.push({
      meta,
      photoPath,
      tries: 0,
      result: null
    });

    saveQueue();
    processQueue();

    return res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send('Success');

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }

    const message = String(
      error.message || 'حدث خطأ'
    );

    console.error('Website request error:', message);

    return res
      .status(400)
      .type('text/plain; charset=utf-8')
      .send(message);
  }
}

// الموقع يقدر يبعت على المسار الرئيسي أو webhook
app.post('/', upload.single('photo'), handleWebsiteRequest);
app.post('/webhook', upload.single('photo'), handleWebsiteRequest);

// ====== مسار احتياطي للطلبات القديمة المحمية بـ x-secret ======
app.post('/generate', upload.single('photo'), async (req, res) => {
  if (req.headers['x-secret'] !== SECRET) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(401).send('Unauthorized');
  }

  req.body.type = 'story';

  return handleWebsiteRequest(req, res);
});

module.exports = { generateStory };

// ====== تشغيل السيرفر ======
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('Bot listening on', PORT);

    if (queue.length) {
      console.log(
        '>> فيه طلبات محفوظة من قبل ولسه ماخلصتش:',
        queue.length,
        '، هكمّلها'
      );

      processQueue();
    }

    console.log('Direct Google Apps Script mode: active');
  });
}
