const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const CANVA_URL = "https://www.canva.com/ai/";
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || "canva-worker/output");
const DIAG_DIR = path.resolve("canva-worker/diagnostics");
const TIMEOUT_MS = 10 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(value) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 70) || "storybook";
}

async function visibleCount(locator) {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const count = await visibleCount(locator);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const item = locator.nth(i);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

async function saveDiagnostics(page, label) {
  ensureDir(DIAG_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await page.screenshot({
    path: path.join(DIAG_DIR, `${stamp}-${label}.png`),
    fullPage: true
  }).catch(() => {});
  const body = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(
    path.join(DIAG_DIR, `${stamp}-${label}.txt`),
    `URL: ${page.url()}\nTITLE: ${await page.title().catch(() => "")}\n\n${body.slice(0, 16000)}`,
    "utf8"
  );
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(DIAG_DIR);

  const rawState = process.env.CANVA_AUTH_STATE_JSON;
  const prompt = process.env.STORY_PROMPT;

  if (!rawState) throw new Error("GitHub secret CANVA_AUTH_STATE_JSON is missing.");
  if (!prompt || !prompt.trim()) throw new Error("STORY_PROMPT is empty.");

  let storageState;
  try {
    storageState = JSON.parse(rawState);
  } catch {
    throw new Error("CANVA_AUTH_STATE_JSON is not valid JSON.");
  }

  if (!Array.isArray(storageState.cookies) || !Array.isArray(storageState.origins)) {
    throw new Error("Canva session JSON has an unexpected format.");
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const context = await browser.newContext({
      storageState,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US"
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    console.log("Opening Canva AI...");
    await page.goto(CANVA_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(12000);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/just a moment|checking your browser|verify you are human/i.test(bodyText)) {
      await saveDiagnostics(page, "security-check");
      throw new Error("Canva security challenge detected; worker stopped safely.");
    }
    if (/login|sign in|log in/i.test(page.url()) || /log in to continue|sign in to continue/i.test(bodyText)) {
      await saveDiagnostics(page, "login-required");
      throw new Error("Canva session is not signed in or has expired.");
    }

    // Locate a visible prompt editor without assuming one specific Canva DOM selector.
    const editor = await firstVisible([
      page.getByRole("textbox"),
      page.locator('textarea:visible'),
      page.locator('[contenteditable="true"]:visible')
    ]);

    if (!editor) {
      await saveDiagnostics(page, "editor-not-found");
      throw new Error("Could not identify Canva AI prompt editor. Diagnostics were saved.");
    }

    console.log("Prompt editor found; entering the supplied story prompt.");
    await editor.click();
    await editor.fill(prompt).catch(async () => {
      await editor.press("Control+A").catch(() => {});
      await editor.type(prompt, { delay: 2 });
    });

    const sendButton = await firstVisible([
      page.getByRole("button", { name: /send|create|generate|submit|إرسال|إنشاء|توليد/i }),
      page.locator('button[type="submit"]:visible')
    ]);

    if (!sendButton) {
      await saveDiagnostics(page, "send-button-not-found");
      throw new Error("Prompt was entered, but the send/create button was not identified. No submission was made.");
    }

    console.log("Submitting prompt to Canva AI...");
    await sendButton.click();
    console.log("Waiting for Canva AI result and its download control (up to 10 minutes).");

    const downloadControl = await page.getByRole("button", {
      name: /download|تنزيل|تحميل/i
    }).first();

    try {
      await downloadControl.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    } catch {
      await saveDiagnostics(page, "result-download-control-not-found");
      throw new Error("No accessible download button appeared within 10 minutes. Diagnostics were saved.");
    }

    console.log("Download control detected. Opening it...");
    await downloadControl.click();
    await page.waitForTimeout(1500);

    const pdfOption = await firstVisible([
      page.getByRole("menuitem", { name: /pdf/i }),
      page.getByRole("option", { name: /pdf/i }),
      page.getByText(/PDF Standard|PDF Print|PDF \(.*\)|تنزيل بصيغة PDF|PDF/i, { exact: false })
    ]);

    if (!pdfOption) {
      await saveDiagnostics(page, "pdf-option-not-found");
      throw new Error("Download menu opened, but a PDF option was not identified. No file was downloaded.");
    }

    console.log("PDF option detected. Starting download...");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      pdfOption.click()
    ]);

    const suggested = download.suggestedFilename() || "kotybook-story.pdf";
    const filename = safeName(suggested.toLowerCase().endsWith(".pdf") ? suggested : `${suggested}.pdf`);
    const destination = path.join(OUTPUT_DIR, filename);
    await download.saveAs(destination);

    const stat = fs.statSync(destination);
    if (stat.size < 1000) {
      throw new Error("Downloaded file is unexpectedly small; refusing to mark it as complete.");
    }

    console.log(`PDF downloaded successfully: ${filename}`);
    console.log(`File size: ${stat.size} bytes`);
    console.log("The PDF is only attached to this GitHub Actions run; it is NOT uploaded to Google Drive.");

    await saveDiagnostics(page, "completed");
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(error => {
  console.error("CANVA WORKER FAILED:", error.message);
  process.exitCode = 1;
});
