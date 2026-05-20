// render_batch.js — render multiple HTML files in a single Chromium session
// Usage: node render_batch.js carousel_y01_*_2026-05-20 carousel_y02_*_2026-05-20 ...
// Each arg is a folder name (relative to script dir) containing slides_v2.html
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME =
  process.platform === "darwin"
    ? "/Users/detective/.cache/puppeteer/chrome-headless-shell/mac_arm-147.0.7727.57/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    : "/Users/detective/.cache/puppeteer/chrome-headless-shell/win64-147.0.7727.57/chrome-headless-shell-win64/chrome-headless-shell.exe";

const folders = process.argv.slice(2);
if (folders.length < 1) {
  console.error("Usage: node render_batch.js <folder1> <folder2> ...");
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--allow-file-access-from-files",
      "--font-render-hinting=none",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1400, deviceScaleFactor: 1 });

  let total = 0;
  for (const folder of folders) {
    const dir = path.resolve(__dirname, folder);
    const htmlFile = path.join(dir, "slides_v2.html");
    if (!fs.existsSync(htmlFile)) {
      console.error(`  ✗ missing ${htmlFile}`);
      continue;
    }
    await page.goto("file:///" + htmlFile.replace(/\\/g, "/"), {
      waitUntil: "networkidle0",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const slides = await page.$$(".slide");
    console.log(`[${folder}] ${slides.length} slides`);
    for (let i = 0; i < slides.length; i++) {
      const out = path.join(dir, `slide_${String(i + 1).padStart(2, "0")}.jpg`);
      await slides[i].screenshot({ path: out, type: "jpeg", quality: 92 });
      total++;
    }
  }

  await browser.close();
  console.log(`Done. ${total} JPGs across ${folders.length} folders.`);
})();
