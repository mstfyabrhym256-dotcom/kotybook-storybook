const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');

function safeName(title) {
  return String(title || 'story')
    .replace(/[\\/:*?"<>|\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'story';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageHtml({ imageData, title, text, pageNumber, totalPages, isCover }) {
  const footer = 'By Kotybook | 01276626592';
  const safeTitle = escapeHtml(title || 'رحلة نحو الحلم');
  const safeText = escapeHtml(text || '');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1200, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 1600px; overflow: hidden; }
  body { position: relative; font-family: Tahoma, Arial, sans-serif; background: #14243b; }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,15,28,.22) 0%, transparent 25%, transparent 55%, rgba(5,15,28,.15) 100%); }
  .interior-panel {
    position: absolute; left: 54px; right: 54px; bottom: 62px;
    min-height: 470px; padding: 48px 62px 82px;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(145deg, #fff8e9 0%, #f4e6c9 100%);
    border: 3px solid #c69a50; border-radius: 30px;
    box-shadow: 0 14px 38px rgba(0,0,0,.28), inset 0 0 0 8px rgba(255,255,255,.42);
  }
  .interior-panel:before { content: ''; position: absolute; inset: 13px; border: 1px solid rgba(20,39,63,.28); border-radius: 20px; pointer-events: none; }
  .story-text {
    width: 100%; color: #172b45; text-align: center; direction: rtl;
    font-size: 36px; line-height: 1.65; font-weight: 700;
    letter-spacing: 0; white-space: normal; overflow-wrap: break-word;
    text-shadow: 0 1px 0 rgba(255,255,255,.55);
  }
  .page-number {
    position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
    min-width: 74px; height: 42px; padding: 5px 20px;
    border-radius: 24px; background: #172b45; color: #fff8e9;
    border: 2px solid #c69a50; font-size: 23px; font-weight: 700; text-align: center;
    direction: ltr;
  }
  .footer {
    position: absolute; bottom: 20px; right: 76px; color: #fff8e9;
    font-family: Arial, sans-serif; font-size: 19px; font-weight: 600;
    direction: ltr; text-shadow: 0 2px 5px rgba(0,0,0,.8); letter-spacing: .5px;
  }
  .cover-title-wrap {
    position: absolute; top: 76px; left: 70px; right: 70px;
    padding: 34px 42px 40px; text-align: center;
    background: linear-gradient(145deg, rgba(255,248,233,.95), rgba(244,230,201,.91));
    border: 3px solid #c69a50; border-radius: 28px;
    box-shadow: 0 12px 34px rgba(0,0,0,.25), inset 0 0 0 7px rgba(255,255,255,.35);
  }
  .cover-title {
    color: #172b45; font-size: 60px; line-height: 1.5;
    font-weight: 800; text-align: center; direction: rtl;
  }
  .cover-kicker { margin-bottom: 10px; color: #9a7135; font-size: 21px; font-weight: 700; letter-spacing: 2px; }
  .cover-footer { position: absolute; bottom: 32px; left: 0; right: 0; text-align: center; color: #fff8e9; font: 600 20px Arial,sans-serif; direction: ltr; text-shadow: 0 2px 6px rgba(0,0,0,.9); }
</style>
</head>
<body>
  <img class="photo" src="${imageData}" />
  <div class="shade"></div>
  ${isCover
    ? `<div class="cover-title-wrap"><div class="cover-kicker">KOTYBOOK STORY</div><div class="cover-title">${safeTitle}</div></div><div class="cover-footer">${footer}</div>`
    : `<section class="interior-panel"><div class="story-text">${safeText}</div><div class="page-number">${pageNumber - 1}</div></section><div class="footer">${footer}</div>`}
</body>
</html>`;
}

async function buildPdfFile(imageFiles, targetPath, title) {
  if (!Array.isArray(imageFiles) || imageFiles.length === 0) {
    throw new Error('لا توجد صور لإنشاء ملف PDF.');
  }

  const pdf = await PDFDocument.create();
  try {
    if (title) pdf.setTitle(title);
    pdf.setAuthor('كوتي بوك');
    pdf.setProducer('Kotybook Storybook');
    pdf.setSubject('Personalized cinematic storybook');
  } catch (_) {}

  // flow-engine attaches the generated story pages to the returned files array.
  const storyPages = Array.isArray(imageFiles.storyPages) ? imageFiles.storyPages : [];
  const files = [...imageFiles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const browser = await chromium.launch({
    
    headless: true,
    args: ['--disable-gpu']
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1600 },
      deviceScaleFactor: 1
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const imageData = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
      const storyPage = storyPages[i] || {};
      const isCover = i === 0 || storyPage.cover === true;
      const html = pageHtml({
        imageData,
        title: title || 'رحلة نحو الحلم',
        text: storyPage.text || '',
        pageNumber: i + 1,
        totalPages: files.length,
        isCover
      });

      await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const rendered = await page.screenshot({
        type: 'png',
        fullPage: false,
        animations: 'disabled'
      });
      const embedded = await pdf.embedPng(rendered);
      const pdfPage = pdf.addPage([600, 800]);
      pdfPage.drawImage(embedded, { x: 0, y: 0, width: 600, height: 800 });
      console.log(`  تم تجهيز تصميم الصفحة ${i + 1}/${files.length}`);
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(targetPath, await pdf.save());
  return targetPath;
}

module.exports = { buildPdfFile, safeName };
