const fs = require('fs');
const path = require('path');
const { generateStoryFlow, storyTitle } = require('./flow-engine');
const { buildPdfFile, safeName } = require('./pdf-utils');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const API_SECRET = process.env.API_SECRET;
const CODE = process.env.ORDER_CODE;
const ROOT = path.join(__dirname, 'work');

function required(name, value) {
  if (!value) throw new Error(`GitHub Secret/Variable ناقص: ${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callAppsScript(action, payload = {}) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, secret: API_SECRET, ...payload }),
    signal: AbortSignal.timeout(180000)
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    throw new Error(`Apps Script رد برد غير مفهوم (${response.status}): ${raw.slice(0, 300)}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || `Apps Script HTTP ${response.status}`);
  }
  return data;
}

async function generateFlowWithRetries(options, attempts = 2) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`تشغيل Google Flow بالكامل - المحاولة ${attempt}/${attempts}`);
      return await generateStoryFlow(options);
    } catch (error) {
      lastError = error;
      const message = String(error.message || error);

      console.error(`فشل تشغيل Flow بالكامل (المحاولة ${attempt}/${attempts}): ${message}`);

      // أعد التشغيل الكامل عند فشل ظهور صورة من Flow بعد محاولتي الصفحة.
      // لا نكرر أخطاء الإعدادات أو البيانات أو تسجيل الدخول التي لن يحلها التكرار.
      const retryable = message.includes('الصورة ماظهرتش في 4 دقايق');

      if (!retryable || attempt === attempts) {
        throw error;
      }

      console.log('سيتم إعادة تشغيل مشروع Flow من البداية مع الاحتفاظ بنفس نصوص القصة خلال 10 ثوانٍ...');
      await sleep(10000);
    }
  }

  throw lastError || new Error('فشل تشغيل Google Flow لسبب غير معروف.');
}

async function uploadPdf(code, pdfPath, title) {
  const pdf = fs.readFileSync(pdfPath);
  const session = await callAppsScript('startUpload', {
    code,
    fileSize: pdf.length,
    fileName: `${safeName(title)}.pdf`
  });

  const response = await fetch(session.sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length)
    },
    body: pdf,
    signal: AbortSignal.timeout(600000)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`فشل رفع PDF إلى Drive: HTTP ${response.status} - ${raw.slice(0, 300)}`);
  }

  let uploaded;
  try {
    uploaded = JSON.parse(raw);
  } catch (_) {
    throw new Error(`Drive لم يرجع بيانات الملف: ${raw.slice(0, 300)}`);
  }
  if (!uploaded.id) throw new Error('Google Drive لم يرجع file ID بعد الرفع.');

  return callAppsScript('completeStory', {
    code,
    fileId: uploaded.id
  });
}

async function main() {
  required('APPS_SCRIPT_URL', APPS_SCRIPT_URL);
  required('API_SECRET', API_SECRET);
  required('ORDER_CODE', CODE);
  required('GROQ_API_KEY', process.env.GROQ_API_KEY);
  required('AUTH_STATE_JSON', process.env.AUTH_STATE_JSON);

  fs.mkdirSync(ROOT, { recursive: true });
  const jobDir = path.join(ROOT, `${Date.now()}-${CODE.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  fs.mkdirSync(jobDir, { recursive: true });

  // Playwright يقرأ جلسة Google Flow من auth.json.
  const authPath = path.join(__dirname, 'auth.json');
  fs.writeFileSync(authPath, process.env.AUTH_STATE_JSON, 'utf8');
  process.env.AUTH_STATE_PATH = authPath;

  let job;
  try {
    console.log('1) جلب بيانات الطلب والصورة من Google Apps Script...');
    job = await callAppsScript('getJob', { code: CODE });

    if (!job.meta || !job.photoBase64) {
      throw new Error('بيانات الطلب أو صورة العميل غير مكتملة في Apps Script.');
    }

    const extByMime = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    const mime = String(job.photoMime || 'image/jpeg').toLowerCase();
    const ext = extByMime[mime];
    if (!ext) throw new Error(`صيغة صورة غير مدعومة: ${mime}`);

    const photoPath = path.join(jobDir, `reference${ext}`);
    fs.writeFileSync(photoPath, Buffer.from(job.photoBase64, 'base64'));

    console.log('2) تشغيل محرك إنشاء القصة عبر Google Flow...');
    const meta = { ...job.meta };
    const imageFiles = await generateFlowWithRetries({
      meta,
      photoPath,
      outDir: jobDir,
      limit: 10
    }, 2);

    if (!Array.isArray(imageFiles) || imageFiles.length !== 10) {
      throw new Error(`المحرك أنشأ ${imageFiles?.length || 0} صورة بدل 10 صفحات.`);
    }

    const title = meta.title || storyTitle(meta.name);
    const pdfPath = path.join(jobDir, `${safeName(title)}.pdf`);

    console.log('3) إنشاء ملف PDF من الصور النهائية...');
    await buildPdfFile(imageFiles, pdfPath, title);

    console.log('4) رفع PDF إلى Google Drive وتحديث حالة الطلب...');
    const result = await uploadPdf(CODE, pdfPath, title);
    console.log('KOTYBOOK STORY COMPLETED:', result.url);
  } catch (error) {
    console.error('KOTYBOOK STORY FAILED:', error.stack || error.message);
    try {
      await callAppsScript('failStory', {
        code: CODE,
        error: String(error.message || error).slice(0, 500)
      });
    } catch (reportError) {
      console.error('تعذر تسجيل الخطأ في Google Sheets:', reportError.message);
    }
    throw error;
  } finally {
    try { fs.rmSync(authPath, { force: true }); } catch (_) {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
