const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Users/yurii/.cache/puppeteer/chrome-headless-shell/win64-147.0.7727.57/chrome-headless-shell-win64/chrome-headless-shell.exe';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });

  const url = 'file:///' + path.resolve(__dirname, 'slides.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));

  const outDir = __dirname;

  for (let i = 1; i <= 9; i++) {
    const id = `s${i}`;
    const clip = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    }, id);
    await page.screenshot({
      path: path.join(outDir, `slide_${String(i).padStart(2,'0')}.jpg`),
      type: 'jpeg',
      quality: 92,
      clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h }
    });
    console.log('✓ slide_' + String(i).padStart(2,'0') + '.jpg');
  }

  await browser.close();
  console.log('\nDONE:', outDir);
})();
