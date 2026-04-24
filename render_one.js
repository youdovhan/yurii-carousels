// render_one.js — карусельний рендер (1 папка text.md → 10 JPEG 1080x1350)
// Usage: node render_one.js <variant> <slug>
//   variant: harmony | hormozi
//   slug:    slid | golos | dzerkalo | zirky | portret (harmony)
//            zvit | pomichnyk | analiz | produkt | anketa (hormozi)
//
// reads:  carousels/<variant>/<slug>/text.md
// writes: carousels/<variant>/<slug>/slide_01.jpg ... slide_10.jpg

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Users/yurii/.cache/puppeteer/chrome-headless-shell/win64-147.0.7727.57/chrome-headless-shell-win64/chrome-headless-shell.exe';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node render_one.js <variant> <slug>');
  process.exit(1);
}
const [variant, slug] = args;

const ROOT = __dirname;
const textFile = path.join(ROOT, variant, slug, 'text.md');
const outDir = path.join(ROOT, variant, slug);
const tplFile = path.join(ROOT, 'templates', variant + '.html');

if (!fs.existsSync(textFile)) { console.error('NO text.md at', textFile); process.exit(1); }
if (!fs.existsSync(tplFile))  { console.error('NO template at', tplFile);  process.exit(1); }

const src = fs.readFileSync(textFile, 'utf8');
const tpl = fs.readFileSync(tplFile, 'utf8');

// --- parse text.md (universal) ---
const slides = [];
const normSrc = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// знаходимо всі headers "#{2,4} Слайд/СЛАЙД N" — їх позиції у тексті
const headerRe = /^#{2,4}\s*(?:СЛАЙД|Слайд)\s*(\d+)([^\n]*)$/gim;
const headers = [];
let hm;
while ((hm = headerRe.exec(normSrc)) !== null) {
  headers.push({ num: parseInt(hm[1]), labelLine: hm[2] || '', start: hm.index, headerEnd: hm.index + hm[0].length });
}
// для кожного header — body = від headerEnd до наступного header.start АБО до наступного top-level heading (caption/hashtags) АБО до кінця
for (let i = 0; i < headers.length; i++) {
  const h = headers[i];
  const nextHeaderStart = i + 1 < headers.length ? headers[i + 1].start : normSrc.length;
  // шукаємо кінець body — наступний heading (# / ## CAPTION etc) у проміжку
  const sub = normSrc.slice(h.headerEnd, nextHeaderStart);
  // рубаємо по перший такий в межах sub: "\n# CODEWORD", "\n## CAPTION", "\n### CAPTION", "\n# HASHTAGS"
  const cutMatch = sub.match(/\n(?:#{1,4}\s*(?:CAPTION|Caption|caption|HASHTAGS|Hashtags|ТЕКСТ ПІД|ВЕРИФІК|[А-ЯҐЄІЇA-Z]{3,}\s*$)|---+\s*$)/m);
  const body = (cutMatch ? sub.slice(0, cutMatch.index) : sub).trim();
  const parenLabel = h.labelLine.match(/\(([^)]+)\)/);
  const dashLabel  = h.labelLine.match(/[—\-·:]\s*(.+?)(?:\s*\(|$)/);
  const label = (parenLabel ? parenLabel[1] : dashLabel ? dashLabel[1] : h.labelLine).trim().replace(/^[—\-·:]\s*/,'');
  if (body) slides.push({ num: h.num, label, body });
}
// дедуп по num
const seen = new Set(); const uniq = [];
for (const s of slides) if (!seen.has(s.num)) { seen.add(s.num); uniq.push(s); }
uniq.sort((a, b) => a.num - b.num);
slides.length = 0; slides.push(...uniq);
console.log(`[${variant}/${slug}] parsed ${slides.length} slides`);

if (slides.length < 10) {
  console.warn('Only', slides.length, 'slides parsed — expected 10. Will render what I have.');
}

// --- extract meta (title from first H1, code word from slide 10) ---
const codeWordMatch = src.match(/\*\*([А-ЯҐЄІЇ]+)\*\*/);
const codeWord = codeWordMatch ? codeWordMatch[1] : slug.toUpperCase();
const brandName = '@yurii_dovhan';
const caseNum = String(Math.floor(Math.random() * 900) + 100); // 100-999
const slideCount = slides.length;

// --- render each slide to HTML ---
const escapeHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const toHtmlLines = body => {
  // преобразуем текст слайда в HTML: абзацы + **bold** + newline inside paragraph
  const lines = body.trim().split(/\n/).filter(l => l.trim().length);
  const paragraphs = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) { paragraphs.push(current.join('<br>')); current = []; }
    } else {
      current.push(line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
    }
  }
  if (current.length) paragraphs.push(current.join('<br>'));
  return paragraphs.map(p => `<p>${p}</p>`).join('\n');
};

// convert body to simple list if multi-line "pattern"
const toBulletList = (body, cls='') => {
  const lines = body.trim().split(/\n/).map(l => l.replace(/^[•✓▸→]\s*/, '').trim()).filter(l => l.length && !l.startsWith('«'));
  return `<ul class="bullets ${cls}">${lines.map(l => `<li>${l.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</li>`).join('')}</ul>`;
};

// slide render — strategy depends on slide number / label / variant
function renderSlide(s, idx, totalSlides, variant, codeWord) {
  const label = (s.label || '').toUpperCase();
  const isCover = /ОБКЛАДИНКА/.test(label) || s.num === 1;
  const isCTA   = /CTA|КОДОВ/.test(label) || s.num === totalSlides;
  const isQuote = /БІЛЬ ДОСЛ/.test(label) || /ЦИТАТА|QUOTE|ДОСЛ/.test(label);
  const isZeigarnik = /ПОВОРОТ|МІСТ|ZEIGARNIK/.test(label);
  const isMechanism = /МЕХАН/.test(label);
  const isArtefact  = /ВАУ|АРТЕФ|БОНУС|ВХОДИТЬ|ЩО ВХОД|ОТРИМАЄТЕ/.test(label);
  const isScene     = /СЦЕНА/.test(label);

  const topBar = variant === 'hormozi'
    ? `<div class="top-bar"><span class="brand">${brandName}</span><span class="num">СПРАВА №${caseNum} · ${String(s.num).padStart(2,'0')}/${String(totalSlides).padStart(2,'0')}</span></div>`
    : `<div class="case-bar"><span class="num">СПРАВА №${caseNum}</span><span class="right">${brandName} · ${String(s.num).padStart(2,'0')}/${String(totalSlides).padStart(2,'0')}</span></div>`;

  // -- COVER (slide 1) --
  if (isCover) {
    const bodyText = s.body.replace(/\*\*(.+?)\*\*/g,'<em>$1</em>');
    if (variant === 'hormozi') {
      const firstLine = bodyText.split('\n')[0];
      const rest = bodyText.split('\n').slice(1).join(' ');
      return `
<div class="slide cover" id="s${s.num}">
  ${topBar}
  <div>
    <div class="kicker">Для психологів, коучів, консалтерів</div>
    <h1 class="headline">${firstLine.replace(/\*\*(.+?)\*\*/g,'<em>$1</em>')}</h1>
    ${rest ? `<p class="sub">${rest}</p>` : ''}
  </div>
  <div class="footer-brand"><span>${brandName}</span><span>→ ЛИСТАЙ</span></div>
</div>`;
    } else {
      return `
<div class="slide cover" id="s${s.num}">
  ${topBar}
  <div class="hook">${bodyText.replace(/\n/g,'<br>')}</div>
  <div class="footer-brand"><span>${brandName}</span><span class="slide-num">→ ЛИСТАЙ</span></div>
</div>`;
    }
  }

  // -- CTA (slide 10) --
  if (isCTA) {
    // try extract code word line from body
    const cwMatch = s.body.match(/\*\*([А-ЯҐЄІЇ]+)\*\*/);
    const cw = cwMatch ? cwMatch[1] : codeWord;
    // lines without the code word
    const lines = s.body.split('\n').map(l => l.trim()).filter(l => l && !/^\*\*[А-ЯҐЄІЇ]+\*\*$/.test(l));
    const directive = lines[0] || 'Напишіть у директ одне слово:';
    const after = lines.slice(1).join(' ');
    return `
<div class="slide cta" id="s${s.num}">
  ${topBar}
  <div>
    <div class="directive">${directive.replace(/[*]+/g,'').replace(/:$/,'')}</div>
    <div class="code-word">${cw}</div>
    ${after ? `<div class="instruction">${after.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</div>` : ''}
  </div>
  <div class="footer-brand"><span>${brandName}</span><span>&nbsp;DM · INSTAGRAM</span></div>
</div>`;
  }

  // -- QUOTE slide --
  if (isQuote) {
    const clean = s.body.replace(/^«/,'').replace(/»$/,'').trim();
    return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <div class="quote">${clean.replace(/\n/g,'<br>')}</div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
  }

  // -- MECHANISM / STEPS --
  const isSimpl = /МЕХАН|SIMPL|КРОК|ЯК\s*ПРАЦЮЄ|ЯК\s*ЦЕ/.test(label);
  if (isSimpl && variant === 'hormozi') {
    // видаляємо структурні лейбли writer-агента ("ЗАГОЛОВОК:", "ТІЛО:", "ФУТЕР:", "Пайплайн у 3 кроки:")
    const cleanBody = s.body.replace(/^(ЗАГОЛОВОК|ТІЛО|ФУТЕР|HEADER|BODY|FOOTER|Пайплайн[^:]*)\s*[:：].*?\n/gim, '').trim();
    // розпарсити "Крок 1: ... Крок 2: ... Крок 3: ..."
    const steps = cleanBody.split(/(?:^|\n)\s*(?:\*\*)?Крок\s*\d+[.:]?\s*(?:\*\*)?/i).map(x => x.trim()).filter(x => x.length && !/^(Разом|Разом:|у\s*\d+\s*кроки|у 3)/i.test(x));
    if (steps.length >= 2) {
      return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <h2 class="slide-title">Як це працює</h2>
  <div class="content"><ol class="steps">${steps.slice(0,4).map(t => `<li>${t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,' ')}</li>`).join('')}</ol></div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
    }
  }
  if (isMechanism && variant === 'harmony') {
    // as short lines
    return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <div class="body-text">${toHtmlLines(s.body)}</div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
  }

  // -- AVATAR / PROBLEMS / BONUSES (hormozi) --
  if (variant === 'hormozi' && /АВАТАР|БОЛ[ІI]|ЩО\s*ВХОД|БОНУС|ЗНАЙОМЕ|ОТРИМАЄТЕ|ALL\s*PROBLEMS|PROBLEM|ДОКАЗ|СКАРСИТ|SCARCITY|URGENCY|SPEED|ШВИДК|ВКЛЮЧЕНО/i.test(label)) {
    // чистимо структурні writer-префікси
    let cleanBody = s.body
      .replace(/^(ЗАГОЛОВОК|ТІЛО|ФУТЕР|HEADER|BODY|FOOTER)\s*[:：][^\n]*\n/gim, '')
      .replace(/^(Це для вас якщо|Знайоме\?|Що входить|Що отримаєте)[:：]?\s*\n?/gim, '')
      .trim();
    // беремо lines; bullet-line = починається з • ✓ ▸ → — - або ФРАЗА "Проблема..." тощо
    const rawLines = cleanBody.split('\n').map(l => l.trim()).filter(l => l.length);
    const cleanLines = [];
    for (let i = 0; i < rawLines.length; i++) {
      let l = rawLines[i];
      // схопити bullet
      if (/^[•✓▸→—\-]\s*/.test(l)) {
        l = l.replace(/^[•✓▸→—\-]\s*/, '');
        // якщо наступний рядок — continuation (без bullet + не новий розділ) — додати
        while (i + 1 < rawLines.length && !/^[•✓▸→—\-]/.test(rawLines[i+1]) && !/^[А-ЯA-Z]{4,}[:：]?$/.test(rawLines[i+1])) {
          l += ' ' + rawLines[++i];
        }
        cleanLines.push(l);
      } else if (cleanLines.length === 0 && l.length > 10 && !/^[А-ЯA-Z]{4,}[:：]?$/.test(l)) {
        // перший не-bullet рядок може бути вводом — зберегти як окремий тезис
        // skip якщо це "Знайоме?" або "Проблема не в тобі" — це footer text
      }
    }
    const title = /БОЛ[ІI]|ЗНАЙОМЕ|PROBLEM/i.test(label) ? 'Знайоме?'
                : /АВАТАР/.test(label) ? 'Це для вас якщо'
                : /БОНУС|ВХОД|ОТРИМАЄТЕ|ВКЛЮЧЕНО/i.test(label) ? 'Що входить'
                : /ДОКАЗ|METRIC/i.test(label) ? 'Доказ з практики'
                : /СКАРСИТ|SCARCITY|URGENCY/i.test(label) ? 'Скільки беру'
                : /SPEED|ШВИДК/i.test(label) ? 'Коли перший результат'
                : label;
    const cls = /БОЛ[ІI]|ЗНАЙОМЕ|PROBLEM/i.test(label) ? 'problems'
              : /БОНУС|ВХОД|ОТРИМАЄТЕ|ВКЛЮЧЕНО/i.test(label) ? 'bonuses'
              : '';
    if (cleanLines.length >= 2) {
      return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <h2 class="slide-title">${title}</h2>
  <ul class="bullets ${cls}">${cleanLines.slice(0,6).map(l => `<li>${l.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</li>`).join('')}</ul>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
    }
    // fallback — простий текст без структури
    return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <h2 class="slide-title">${title}</h2>
  <div class="content">${toHtmlLines(cleanBody.replace(/^(ЗАГОЛОВОК|ТІЛО|ФУТЕР)\s*[:：][^\n]*\n/gim,''))}</div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
  }

  // -- SCENE / DREAM (hormozi) --
  if (variant === 'hormozi' && (isScene || /DREAM|МРІЯ|РЕЗУЛЬТАТ|СЦЕНА|УЯВ/.test(label))) {
    return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <h2 class="slide-title">${label || 'Уявіть:'}</h2>
  <div class="content"><div class="scene">${toHtmlLines(s.body)}</div></div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
  }

  // -- ZEIGARNIK (harmony) --
  if (isZeigarnik && variant === 'harmony') {
    return `
<div class="slide zeigarnik" id="s${s.num}">
  ${topBar}
  <div class="body-text">${toHtmlLines(s.body)}</div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
  }

  // -- ARTEFACT (harmony) --
  if (isArtefact && variant === 'harmony') {
    const lines = s.body.split('\n').map(l => l.trim()).filter(l => l.length);
    return `
<div class="slide" id="s${s.num}">
  ${topBar}
  <div class="body-text">${toHtmlLines(s.body)}</div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
  }

  // -- DEFAULT: body text --
  return `
<div class="slide" id="s${s.num}">
  ${topBar}
  ${variant === 'hormozi' ? `<h2 class="slide-title">${label || ''}</h2>` : ''}
  <div class="${variant === 'hormozi' ? 'content' : 'body-text'}">${toHtmlLines(s.body)}</div>
  <div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div>
</div>`;
}

const slidesHtml = slides.map((s, i) => renderSlide(s, i, slides.length, variant, codeWord)).join('\n\n');
const finalHtml = tpl.replace('{{SLIDES}}', slidesHtml);

// write HTML to folder for debug
const htmlFile = path.join(outDir, 'slides.html');
fs.writeFileSync(htmlFile, finalHtml, 'utf8');

(async () => {
  console.log(`[${variant}/${slug}] launching Chrome…`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });

  const url = 'file:///' + htmlFile.replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1200));

  for (const s of slides) {
    const id = `s${s.num}`;
    const clip = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    }, id);
    if (!clip) { console.warn('skip', id); continue; }
    await page.screenshot({
      path: path.join(outDir, `slide_${String(s.num).padStart(2,'0')}.jpg`),
      type: 'jpeg',
      quality: 92,
      clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h }
    });
    console.log(`  ✓ slide_${String(s.num).padStart(2,'0')}.jpg`);
  }

  await browser.close();
  console.log(`[${variant}/${slug}] DONE (${slides.length} JPEG)`);
})();
