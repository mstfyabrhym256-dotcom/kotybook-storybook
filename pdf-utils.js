const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

function safeName(title) {
  return String(title || 'story')
    .replace(/[\\/:*?"<>|\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'story';
}

// Flow now returns complete, final page artwork.
// This stage only places those finished images into a PDF.
// No text overlay, no HTML rendering, no typography merging,
// and no additional image compression.

async function buildPdfFile(imageFiles, targetPath, title, name = '') {
  if (!Array.isArray(imageFiles) || imageFiles.length === 0) {
    throw new Error('لا توجد صور لإنشاء ملف PDF.');
  }

  const files = [...imageFiles].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const pdf = await PDFDocument.create();

  try {
    if (title) pdf.setTitle(title);
    pdf.setAuthor('كوتي بوك');
    pdf.setProducer('Kotybook Storybook');
    pdf.setSubject('Personalized illustrated storybook');
  } catch (_) {}

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const bytes = fs.readFileSync(file);
    let embedded;

    if (ext === '.png') {
      embedded = await pdf.embedPng(bytes);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      embedded = await pdf.embedJpg(bytes);
    } else {
      throw new Error(
        `صيغة الصورة ${ext || 'غير معروفة'} غير مدعومة مباشرة داخل PDF. يجب أن يحفظ Flow الصور بصيغة JPG أو PNG: ${path.basename(file)}`
      );
    }

    // Preserve the original image aspect ratio.
    const pageWidth = 600;
    const pageHeight = pageWidth * embedded.height / embedded.width;

    const page = pdf.addPage([pageWidth, pageHeight]);

    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight
    });
  }

  fs.writeFileSync(
    targetPath,
    await pdf.save({ useObjectStreams: true })
  );

  return targetPath;
}

module.exports = { buildPdfFile, safeName };
