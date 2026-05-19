// render_html.js — рендер готового HTML файлу в JPEG слайди
// Usage: node render_html.js <html_file> [output_dir]
// Example: node render_html.js hormozi/pytannia/slides_v2.html hormozi/pytannia

const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

// Cross-platform Chrome path: mac (darwin) uses local mac_arm install; win uses old hardcoded path.
const CHROME =
  process.platform === "darwin"
    ? "/Users/detective/.cache/puppeteer/chrome-headless-shell/mac_arm-147.0.7727.57/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    : "/Users/detective/.cache/puppeteer/chrome-headless-shell/win64-147.0.7727.57/chrome-headless-shell-win64/chrome-headless-shell.exe";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: node render_html.js <html_file> [output_dir]");
  process.exit(1);
}

const htmlFile = path.resolve(__dirname, args[0]);
const outDir = args[1]
  ? path.resolve(__dirname, args[1])
  : path.dirname(htmlFile);

if (!fs.existsSync(htmlFile)) {
  console.error("No HTML file at", htmlFile);
  process.exit(1);
}
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
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
  await page.goto("file:///" + htmlFile.replace(/\\/g, "/"), {
    waitUntil: "networkidle0",
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 2000));

  const slides = await page.$$(".slide");
  console.log(`Found ${slides.length} slides`);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const outPath = path.join(
      outDir,
      `slide_${String(i + 1).padStart(2, "0")}.jpg`,
    );
    await slide.screenshot({ path: outPath, type: "jpeg", quality: 92 });
    console.log(`  ✓ slide_${String(i + 1).padStart(2, "0")}.jpg`);
  }

  await browser.close();
  console.log(`Done → ${outDir}`);
})();
