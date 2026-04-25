// render_one.js — карусельний рендер (1 папка text.md → 10 JPEG 1080x1350)
// Usage: node render_one.js <variant> <slug> [--v1|--v2]
//   variant: harmony | hormozi
//   slug:    slid | golos | dzerkalo | zirky | portret (harmony)
//            zvit | pomichnyk | analiz | produkt | anketa (hormozi)
//
// V2 mode (default if text_v2.md exists):
//   reads:  carousels/<variant>/<slug>/text_v2.md
//   parses: "## Slide N [layout: xxx]" sections
//   uses:   carousels/templates/<variant>_v2.html
//
// V1 mode (fallback if text_v2.md missing OR --v1 forced):
//   reads:  carousels/<variant>/<slug>/text.md
//   uses:   carousels/templates/<variant>.html
//
// writes: carousels/<variant>/<slug>/slide_01.jpg ... slide_10.jpg

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Users/yurii/.cache/puppeteer/chrome-headless-shell/win64-147.0.7727.57/chrome-headless-shell-win64/chrome-headless-shell.exe';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node render_one.js <variant> <slug> [--v1|--v2]');
  process.exit(1);
}
const [variant, slug] = args;
const forceV1 = args.includes('--v1');
const forceV2 = args.includes('--v2');

const ROOT = __dirname;
const v2TextFile = path.join(ROOT, variant, slug, 'text_v2.md');
const v1TextFile = path.join(ROOT, variant, slug, 'text.md');
const outDir = path.join(ROOT, variant, slug);

// resolve mode + files
let mode, textFile, tplFile;
if (forceV1) {
  mode = 'v1';
  textFile = v1TextFile;
  tplFile = path.join(ROOT, 'templates', variant + '.html');
} else if (forceV2) {
  mode = 'v2';
  textFile = v2TextFile;
  tplFile = path.join(ROOT, 'templates', variant + '_v2.html');
} else {
  // auto-detect: prefer V2 if text_v2.md exists
  if (fs.existsSync(v2TextFile)) {
    mode = 'v2';
    textFile = v2TextFile;
    tplFile = path.join(ROOT, 'templates', variant + '_v2.html');
  } else {
    mode = 'v1';
    textFile = v1TextFile;
    tplFile = path.join(ROOT, 'templates', variant + '.html');
  }
}

if (!fs.existsSync(textFile)) { console.error('NO text file at', textFile); process.exit(1); }
if (!fs.existsSync(tplFile))  { console.error('NO template at', tplFile);  process.exit(1); }

console.log(`[${variant}/${slug}] mode=${mode} · text=${path.basename(textFile)} · tpl=${path.basename(tplFile)}`);

const src = fs.readFileSync(textFile, 'utf8');
const tpl = fs.readFileSync(tplFile, 'utf8');

// === META extraction (common to both modes) ===
const codeWordMatch = src.match(/\*\*([А-ЯҐЄІЇ]{2,})\*\*/);
const codeWord = codeWordMatch ? codeWordMatch[1] : slug.toUpperCase();
const brandName = '@yurii_dovhan';
const caseNum = String(Math.floor(Math.random() * 900) + 100); // 100-999

// =================================================================
// ============ V2 PARSER + RENDERER ===============================
// =================================================================
function parseV2(src) {
  // ## Slide N [layout: xxx] OR ### Слайд N - `layout` OR ## СЛАЙД N · `layout`
  const slides = [];
  const norm = src.replace(/\r\n/g,'\n').replace(/\r/g,'\n');

  // Pattern A: "## Slide 1 [layout: case-file-cover]"
  // Pattern B: "### Слайд 1 — `case-file-cover`"
  // Pattern C: "## СЛАЙД 1 · `case-file-cover`"
  const headerRe = /^#{2,4}\s*(?:Slide|Слайд|СЛАЙД)\s*(\d+)\s*(?:[\[\(]\s*layout\s*:\s*([a-z\-]+)\s*[\]\)]|[—\-·:]?\s*[`']?([a-z\-]+)[`']?)?\s*([^\n]*)$/gim;

  const headers = [];
  let m;
  while ((m = headerRe.exec(norm)) !== null) {
    const num = parseInt(m[1]);
    const layout = (m[2] || m[3] || '').trim().toLowerCase();
    headers.push({ num, layout, start: m.index, headerEnd: m.index + m[0].length, label: (m[4] || '').trim() });
  }

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i+1].start : norm.length;
    const sub = norm.slice(h.headerEnd, nextStart);
    // cut at ## CAPTION / ## HASHTAGS / ## ВЕРИФІКАЦІЯ / --- followed by section
    const cutMatch = sub.match(/\n(?:#{1,4}\s*(?:CAPTION|Caption|caption|HASHTAGS|Hashtags|ВЕРИФІК|Caption|Parent|---+\s*$)|---\s*\n##)/m);
    const body = (cutMatch ? sub.slice(0, cutMatch.index) : sub).trim();
    if (body) slides.push({ num: h.num, layout: h.layout || guessLayoutFromBody(body, h.num), body });
  }
  // dedup by num
  const seen = new Set(); const uniq = [];
  for (const s of slides) if (!seen.has(s.num)) { seen.add(s.num); uniq.push(s); }
  uniq.sort((a,b) => a.num - b.num);
  return uniq;
}

function guessLayoutFromBody(body, num) {
  if (num === 1) return 'case-file-cover';
  if (num === 10) return 'case-closed';
  if (/«|»|"|"/.test(body) && body.length < 400) return 'quote-pull';
  if (/БУЛО|СТАЛО|БЕЗ|З\s+:|BEFORE|AFTER/i.test(body)) return 'comparison-split';
  if (/REDACTED|CLASSIFIED|\[CLASS/i.test(body)) return 'redacted-text';
  if (/полароїд|polaroid|01.*02.*03/i.test(body)) return 'evidence-board';
  if (/—\s/.test(body) && body.split('\n').filter(l => l.trim().startsWith('—')).length >= 3) return 'field-notes';
  return 'statement-card';
}

// V2 inline-markup parser → strong/em → semantic spans
function v2Markup(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<span class="strike">$1</span>');
}

// strip directive prefixes like "LABEL (mono small):", "HEADLINE (...)", "BIG NUMBER:"
function stripDirective(line) {
  return line
    .replace(/^[\-\*]\s+/, '')
    .replace(/^[A-ZА-ЯҐЄІЇ][A-ZА-ЯҐЄІЇ\s\d\(\),\.\-/·]+\s*[:：]\s*/i, '')
    .replace(/^[\[\(].*?[\]\)]\s*/, '')
    .trim();
}

// extract clean lines from slide body (filter out directive markers)
function extractContentLines(body) {
  return body.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^(LABEL|HEADLINE|HEAD|SUB|KICKER|BODY|FOOT|FOOTER|HEADER|CONTEXT|H1|H2|H3|BIG|UNIT|SOURCE|CASE BAR|DIRECTIVE|CODE-WORD|INSTRUCTION|SEAL|TEASER|HINT|QMARK|BLOCKQUOTE|AUTHOR|REF|OPEN LOOP|ENDING_FORMULA|ACCENT MARK|POLAROID|PHOTO|NUM|NOTE|COL|DIVIDER|STATEMENT|REVEAL|STAMP|BLACK|FINALE|STAKE|STAKE-LABEL|VISUAL|VІZUАL)\s*[\d]*\s*\(?[^)]*\)?\s*[:：]?\s*$/i.test(l));
}

// is a line a "noise"/spec/marker line that should never be a headline?
function isNoiseLine(line) {
  const l = line.trim();
  if (!l) return true;
  // markdown headers (#, ##, ###)
  if (/^#{1,6}\s/.test(l)) return true;
  // CASE №... DOSSIER... lines (placeholder header)
  if (/^CASE\s*№/i.test(l)) return true;
  // Layout: spec lines  e.g., "Layout: `case-file-cover` (...)"
  if (/^layout\s*[:：]/i.test(l)) return true;
  if (/`[a-z\-]+`/i.test(l) && /layout/i.test(l)) return true;
  // bracketed marker lines like "[kicker]", "[footer]", "[label]", "[h1]"
  if (/^\[[^\]]+\]\s*$/.test(l)) return true;
  // pure directive header lines like "**H1:**" or "HEADLINE:" with no value
  if (/^\*?\*?[A-ZА-ЯҐЄІЇ][A-ZА-ЯҐЄІЇ0-9\s\-]*\*?\*?\s*[:：]\s*\*?\*?\s*$/.test(l)) return true;
  // code fence
  if (/^```/.test(l)) return true;
  // separator/divider lines
  if (/^[─\-=_]{3,}\s*$/.test(l)) return true;
  // pure parenthetical specification e.g., "(IBM Plex Serif Bold 80px)"
  if (/^\([^)]+\)\s*$/.test(l)) return true;
  // blockquote markers
  if (/^>/.test(l)) return true;
  // pure code-word-only lines like "**ГОЛОС**"
  if (/^\*\*[А-ЯҐЄІЇA-Z]+\*\*\s*$/.test(l)) return true;
  // bold-prefixed metadata lines: "**Hook: Confession**", "**KICKER:** РОЗСЛІД",
  // "**Hook type:** ...", "**ДНК:** Іра — коуч ICF"
  if (/^\*\*[^*]+:[^*]*\*\*\s*$/.test(l)) return true;
  // Cyrillic/English caps-only labels with colon ending the line:
  // e.g., "JD · DETECTIVE · СЛІД →"  (we keep these; they're cover-foot text rendered separately)
  // skip pure punctuation/symbol lines
  if (/^[\s\-—·•→←↓↑\.]+$/.test(l)) return true;
  return false;
}

// extract headline: prefer explicit markers (HEADLINE/H1/[h1]); fallback to first
// largest non-noise content block (>20 chars, no markdown markup).
function extractHeadline(body) {
  // 1) try explicit markers first via extractDirective (handles same-line + multi-line)
  const explicit = extractDirective(body, 'HEADLINE', 'H1');
  if (explicit) return explicit;

  // 2) collect contiguous content blocks (separated by blank lines or noise)
  const rawLines = body.split('\n');
  const blocks = [];
  let cur = [];
  for (const raw of rawLines) {
    const l = raw.trim();
    if (!l || isNoiseLine(l)) {
      if (cur.length) { blocks.push(cur.join(' ')); cur = []; }
      continue;
    }
    // skip directive prefix lines that have inline value (let stripDirective handle)
    const cleaned = stripDirective(l);
    if (!cleaned || isNoiseLine(cleaned)) {
      if (cur.length) { blocks.push(cur.join(' ')); cur = []; }
      continue;
    }
    // skip pure ALL-CAPS short labels
    if (/^[A-ZА-ЯҐЄІЇ\s\d·\-]+$/.test(cleaned) && cleaned.length < 30) {
      if (cur.length) { blocks.push(cur.join(' ')); cur = []; }
      continue;
    }
    cur.push(cleaned);
  }
  if (cur.length) blocks.push(cur.join(' '));

  // 3) pick first block with length >20 (largest contiguous non-noise text)
  for (const b of blocks) {
    if (b.length >= 20) return b;
  }
  // fallback: any non-empty block
  for (const b of blocks) if (b.length > 0) return b;
  return body.split('\n').map(l => l.trim()).filter(l => l.length)[0] || '';
}

// extract value of a directive section: "LABEL (mono small): X" or "- LABEL: X"
// Supports both same-line value and multi-line marker (where value is on
// following lines until blank/next-directive).
function extractDirective(body, ...keys) {
  const lines = body.split('\n');
  // matches "**H1:**" "H1:" "- LABEL:" "HEADLINE (font spec):" — possibly empty value
  const keyRe = new RegExp('^[\\-\\*]?\\s*(?:\\*\\*)?(?:' + keys.join('|') + ')(?:\\*\\*)?\\s*\\(?[^)]*\\)?\\s*[:：]\\s*(.*)$','i');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = l.match(keyRe);
    if (!m) continue;
    let val = (m[1] || '').trim().replace(/\*\*$/,'').trim();
    // strip leading/trailing **bold** markers from same-line
    val = val.replace(/^\*\*/,'').replace(/\*\*$/,'').trim();
    if (val.length > 0) {
      return val.replace(/^[«"']|[»"']$/g, '').trim();
    }
    // empty same-line value → collect following non-blank lines until blank or next directive
    const collected = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) {
        if (collected.length) break;
        continue;
      }
      // stop at next directive marker (e.g., "**SUB:**", "CONTEXT:", "[kicker]")
      if (/^[\-\*]?\s*\*?\*?[A-ZА-ЯҐЄІЇ][A-ZА-ЯҐЄІЇ0-9\s\-]*\*?\*?\s*\(?[^)]*\)?\s*[:：]/.test(next)) break;
      if (/^\[[^\]]+\]/.test(next)) break;
      // stop at horizontal separator
      if (/^[─\-=_]{3,}\s*$/.test(next)) break;
      // stop at heading
      if (/^#{1,6}\s/.test(next)) break;
      // stop at code fence
      if (/^```/.test(next)) break;
      // stop at CASE №
      if (/^CASE\s*№/i.test(next)) break;
      collected.push(next);
    }
    if (collected.length) {
      const joined = collected.join('\n').trim();
      return joined.replace(/^[«"']|[»"']$/g, '').replace(/^\*\*|\*\*$/g, '').trim();
    }
  }
  return null;
}

// extract bullet list from body (lines starting with — or - or •)
function extractBullets(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length);
  const bullets = [];
  for (const l of lines) {
    if (/^[\-•—]\s*[«"']?(?:[—\-]\s*)?/.test(l)) {
      const cleaned = l.replace(/^[\-•—]\s*[«"']?\s*/, '').replace(/^[—\-]\s*/, '').replace(/[«"']?$/, '');
      // skip "ACCENT MARK..." etc.
      if (cleaned.length > 3 && !/^[A-ZА-ЯҐЄІЇ\s]+\s*\(/.test(cleaned)) {
        bullets.push(cleaned);
      }
    }
  }
  return bullets;
}

// ===== V2 LAYOUT RENDERERS =====
function renderV2Slide(s, idx, total) {
  const layout = s.layout;
  const num = s.num;
  const body = s.body;

  // helper: case-bar for cover
  const caseBar = (numLabel, dateLabel) =>
    `<div class="case-bar"><span class="num">${numLabel}</span><span>${dateLabel}</span></div>`;

  switch (layout) {
    case 'case-file-cover': {
      const kicker = extractDirective(body, 'KICKER') || 'РОЗСЛІДУВАННЯ';
      // headline = HEADLINE directive, або перший великий рядок без directive
      let headline = extractDirective(body, 'HEADLINE', 'H1');
      if (!headline) headline = extractHeadline(body);
      const sub = extractDirective(body, 'SUB', 'SUBHEADLINE');
      const labelDir = extractDirective(body, 'LABEL');
      const today = '2026·04';
      const numLabel = labelDir ? labelDir.split(/\s*[·\/]\s*/)[0] : `CASE №${caseNum}`;
      return `
<section class="slide" data-layout="case-file-cover" id="s${num}">
  ${caseBar(numLabel.toUpperCase(), `DOSSIER · ${today}`)}
  <div class="cover-body">
    <span class="kicker">${v2Markup(kicker.replace(/\*\*/g,''))}</span>
    <h1>${v2Markup(headline).replace(/\n/g,'<br>')}</h1>
  </div>
  <div class="cover-foot">
    <span>JD · DETECTIVE</span>
    <span class="swipe">${codeWord} →</span>
  </div>
</section>`;
    }

    case 'statement-card': {
      const label = extractDirective(body, 'LABEL') || `СЛІД ${String(num).padStart(2,'0')}`;
      let headline = extractDirective(body, 'HEADLINE', 'H2');
      if (!headline) headline = extractHeadline(body);
      const context = extractDirective(body, 'CONTEXT');
      const subNote = extractDirective(body, 'SUB-NOTE', 'SUB NOTE');
      return `
<section class="slide" data-layout="statement-card" id="s${num}">
  <span class="slide-label">${v2Markup(label.replace(/\*\*/g,''))}</span>
  <h2>${v2Markup(headline).replace(/\n/g,'<br>')}</h2>
  ${context ? `<span class="context">${v2Markup(context.replace(/\*\*/g,''))}</span>` : ''}
  ${subNote ? `<p class="sub-note">${v2Markup(subNote)}</p>` : ''}
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'evidence-board': {
      const label = extractDirective(body, 'LABEL') || `ДОКАЗИ · ${num}`;
      // знаходимо POLAROID-блоки
      const polaroidRe = /(?:POLAROID|polaroid)\s*(\d+)([^\n]*)\n([\s\S]*?)(?=(?:POLAROID|polaroid)\s*\d|FOOT|\[(?:label|polaroid)|$)/g;
      const polaroids = [];
      let pm;
      while ((pm = polaroidRe.exec(body)) !== null) {
        const block = pm[3];
        const numStr = extractDirective(block, 'NUM') || String(pm[1]).padStart(2,'0');
        const note = extractDirective(block, 'NOTE') || extractHeadline(block);
        const rotMatch = pm[2].match(/rotate\s*([\-\d\.]+)\s*deg/i);
        const r = rotMatch ? parseFloat(rotMatch[1]) : (pm[1] % 2 === 0 ? 1.5 : -2);
        polaroids.push({ num: numStr.replace(/\*\*/g,''), note: note.replace(/<br>/g,' ').replace(/\*\*/g,''), r });
      }
      // fallback: парсимо нумеровані блоки "01 ... 02 ... 03"
      if (polaroids.length === 0) {
        const numBlockRe = /^(\d{1,2})\s*[·\.\)]\s*([^\n]+)\n([^\n]+)/gm;
        let nm;
        while ((nm = numBlockRe.exec(body)) !== null) {
          polaroids.push({
            num: nm[1].padStart(2,'0'),
            note: (nm[2].trim() + '<br>' + nm[3].trim()).replace(/\*\*/g,''),
            r: (parseInt(nm[1]) % 2 === 0) ? 1.5 : -2
          });
        }
      }
      // ще fallback: розбити bullets
      if (polaroids.length === 0) {
        const bullets = extractBullets(body);
        for (let i = 0; i < bullets.length && i < 5; i++) {
          polaroids.push({
            num: String(i+1).padStart(2,'0'),
            note: bullets[i].replace(/\*\*/g,''),
            r: (i % 2 === 0) ? -2 : 1.5
          });
        }
      }
      const foot = extractDirective(body, 'FOOT', 'BOARD-FOOT', 'FOOTER');
      const colsClass = polaroids.length === 5 ? 'cols-5' : polaroids.length === 2 ? 'cols-2' : '';
      return `
<section class="slide" data-layout="evidence-board" id="s${num}">
  <span class="slide-label">${v2Markup(label.replace(/\*\*/g,''))}</span>
  <div class="board ${colsClass}">
    ${polaroids.map(p => `
      <article class="polaroid" style="--r:${p.r}deg">
        <div class="photo"></div>
        <span class="num">${p.num}</span>
        <p class="note">${v2Markup(p.note)}</p>
      </article>`).join('')}
  </div>
  ${foot ? `<div class="board-foot">${v2Markup(foot.replace(/\*\*/g,''))}</div>` : ''}
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'field-notes': {
      const head = extractDirective(body, 'HEAD') || `FIELD NOTES · ${new Date().toISOString().slice(0,10)}`;
      const bullets = extractBullets(body);
      const question = extractDirective(body, 'QUESTION');
      return `
<section class="slide" data-layout="field-notes" id="s${num}">
  <div class="notes-head">
    <span>${head.split('·')[0].trim()}</span>
    <span>${(head.split('·')[1] || '2026·04·24').trim()}</span>
  </div>
  <ol class="notes">
    ${bullets.map(b => `<li><span class="tick">—</span><span>${v2Markup(b)}</span></li>`).join('')}
  </ol>
  ${question ? `<p class="notes-question">${v2Markup(question)}</p>` : ''}
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'quote-pull': {
      // BLOCKQUOTE directive або перший рядок з лапками
      let quote = extractDirective(body, 'BLOCKQUOTE', 'QUOTE');
      if (!quote) {
        // шукаємо контент між « »
        const qm = body.match(/[«"]([\s\S]+?)[»"]/);
        quote = qm ? qm[1].trim() : extractHeadline(body);
      }
      const author = extractDirective(body, 'AUTHOR');
      const ref = extractDirective(body, 'REF', 'REFERENCE');
      const openLoop = extractDirective(body, 'OPEN LOOP', 'OPEN-LOOP');
      // якщо author/ref не extracted — шукаємо "— X" line
      let authorFallback = author, refFallback = ref;
      if (!authorFallback) {
        const am = body.match(/^[—\-]\s*([^\n,]+)/m);
        authorFallback = am ? am[1].trim() : '— Клієнт';
      }
      if (!refFallback) {
        const rm = body.match(/CASE\s*№?\s*\d+[^\n]*/i);
        refFallback = rm ? rm[0] : `CASE №${caseNum}`;
      }
      return `
<section class="slide" data-layout="quote-pull" id="s${num}">
  <span class="qmark">«</span>
  <blockquote>${v2Markup(quote).replace(/\n/g,'<br>')}</blockquote>
  <div class="quote-foot">
    <span class="author">${v2Markup(authorFallback.replace(/^[—\-]\s*/,'— '))}</span>
    <span class="ref">${v2Markup(refFallback)}</span>
  </div>
  ${openLoop ? `<span class="open-loop">${v2Markup(openLoop)}</span>` : ''}
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'data-card': {
      const label = extractDirective(body, 'LABEL') || `ДОКАЗ · СТАТИСТИКА`;
      let big = extractDirective(body, 'BIG FIGURE', 'BIG NUMBER', 'BIG');
      if (!big) {
        // пробуємо знайти число у форматі "X → Y" або "X × Y" або "$X"
        const bm = body.match(/(\d+\s*(?:[→×x]\s*\d+)?(?:\s*=\s*[\$€]?\s*[\d\s]+)?)/);
        big = bm ? bm[1] : '—';
      }
      // обробка: "30 × $60" → з em для × та "= $1 800" з equals
      const bigHtml = big
        .replace(/\s*→\s*/g, '<em>→</em>')
        .replace(/\s*[×x]\s*/g, '<em>×</em>')
        .replace(/\s*=\s*/g, '<em class="equals">=</em>');
      const unit = extractDirective(body, 'UNIT');
      const context = extractDirective(body, 'CONTEXT');
      const source = extractDirective(body, 'SOURCE');
      return `
<section class="slide" data-layout="data-card" id="s${num}">
  <span class="data-label">${v2Markup(label.replace(/\*\*/g,''))}</span>
  <div class="figure">
    <span class="big">${bigHtml}</span>
    ${unit ? `<span class="unit">${v2Markup(unit.replace(/\*\*/g,''))}</span>` : ''}
  </div>
  ${context ? `<p class="context">${v2Markup(context).replace(/<br>/g,'<br>').replace(/\n/g,'<br>')}</p>` : ''}
  ${source ? `<span class="source">${v2Markup(source.replace(/^Джерело:\s*/i,'').replace(/\*\*/g,''))}</span>` : ''}
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'comparison-split': {
      // шукаємо COL LEFT / COL RIGHT або БУЛО / СТАЛО блоки
      const beforeBlock = body.match(/(?:COL\s*LEFT|БУЛО)[\s\S]*?(?=COL\s*RIGHT|СТАЛО|$)/i);
      const afterBlock = body.match(/(?:COL\s*RIGHT|СТАЛО)[\s\S]*$/i);

      const parseCol = (txt) => {
        if (!txt) return { label:'', h3:'', body:'' };
        const labelM = txt.match(/(?:LABEL|^[—\-•]\s*)\s*[:：]?\s*([^\n]+)/);
        const h3M = txt.match(/(?:H3|HEADLINE|^)\s*\(?[^)]*\)?\s*[:：]\s*([^\n]+)/);
        const bodyM = txt.match(/(?:BODY|^)\s*\(?[^)]*\)?\s*[:：]\s*([\s\S]+)/);
        return {
          label: (labelM ? labelM[1] : '').trim(),
          h3: (h3M ? h3M[1] : '').trim(),
          body: (bodyM ? bodyM[1] : '').trim().split('\n')[0]
        };
      };

      // simpler fallback: шукаємо БУЛО {...} СТАЛО {...}
      let beforeLabel = 'БУЛО', afterLabel = 'СТАЛО';
      let beforeH3 = '', afterH3 = '';
      let beforeBody = '', afterBody = '';

      // парсимо стиль text_v2 (golos format):
      // БУЛО\nПост. 50 хв\nЯк у всіх\n\n—\n\nСТАЛО\nПост. 7 хв\n...
      const sepIdx = body.search(/^[—\-]+$/m);
      if (sepIdx > 0) {
        const beforePart = body.slice(0, sepIdx).trim();
        const afterPart = body.slice(sepIdx).replace(/^[—\-]+\s*\n?/m, '').trim();
        // beforePart: первая line з "БУЛО" або lable, потом content
        const bLines = beforePart.split('\n').map(l => l.trim()).filter(l => l.length);
        const aLines = afterPart.split('\n').map(l => l.trim()).filter(l => l.length);
        if (bLines[0] && /БУЛО|Was|Before/i.test(bLines[0])) bLines.shift();
        if (aLines[0] && /СТАЛО|Now|After/i.test(aLines[0])) aLines.shift();
        beforeH3 = bLines[0] || '';
        beforeBody = bLines.slice(1).join('<br>');
        afterH3 = aLines[0] || '';
        afterBody = aLines.slice(1).join('<br>');
      } else if (beforeBlock && afterBlock) {
        const b = parseCol(beforeBlock[0]);
        const a = parseCol(afterBlock[0]);
        beforeLabel = b.label || beforeLabel;
        afterLabel = a.label || afterLabel;
        beforeH3 = b.h3;
        afterH3 = a.h3;
        beforeBody = b.body;
        afterBody = a.body;
      } else {
        // last fallback: bullets
        const bullets = extractBullets(body);
        if (bullets.length >= 2) {
          beforeBody = bullets[0];
          afterBody = bullets[1];
        }
      }

      return `
<section class="slide" data-layout="comparison-split" id="s${num}">
  <div class="col before">
    <span class="col-label">${beforeLabel}</span>
    ${beforeH3 ? `<h3>${v2Markup(beforeH3)}</h3>` : ''}
    <p>${v2Markup(beforeBody).replace(/\n/g,'<br>')}</p>
  </div>
  <div class="divider"></div>
  <div class="col after">
    <span class="col-label">${afterLabel}</span>
    ${afterH3 ? `<h3>${v2Markup(afterH3)}</h3>` : ''}
    <p>${v2Markup(afterBody).replace(/\n/g,'<br>')}</p>
  </div>
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'redacted-text': {
      const label = extractDirective(body, 'LABEL') || 'CONFIDENTIAL';
      let statement = extractDirective(body, 'STATEMENT', 'HEADLINE');
      if (!statement) statement = extractHeadline(body);
      // обробка [CLASSIFIED] → black bar
      const stmtHtml = v2Markup(statement)
        .replace(/\[(CLASSIFIED|REDACTED|ЗАСЕКРЕЧЕНО)\]/gi, '<span class="black">[$1]</span>')
        .replace(/\n/g,'<br>');
      const reveal = extractDirective(body, 'REVEAL');
      return `
<section class="slide" data-layout="redacted-text" id="s${num}">
  <span class="slide-label">${v2Markup(label.replace(/\*\*/g,''))}</span>
  <p class="statement">${stmtHtml}</p>
  ${reveal ? `<p class="reveal">${v2Markup(reveal)}</p>` : ''}
  <span class="stamp">REDACTED</span>
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'cliff-hanger': {
      const teaser = extractDirective(body, 'TEASER') || 'А ОСЬ ЩО:';
      let headline = extractDirective(body, 'HEADLINE', 'H2');
      if (!headline) headline = extractHeadline(body);
      const hint = extractDirective(body, 'HINT') || `СЛІД →`;
      return `
<section class="slide" data-layout="cliff-hanger" id="s${num}">
  <span class="teaser">${v2Markup(teaser.replace(/\*\*/g,''))}</span>
  <h2>${v2Markup(headline).replace(/\n/g,'<br>')}</h2>
  <span class="hint">${v2Markup(hint.replace(/\*\*/g,''))}</span>
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }

    case 'case-closed': {
      const directive = extractDirective(body, 'DIRECTIVE') || 'НАПИШИ В ДИРЕКТ:';
      // code-word: явний CODE-WORD або жирне ВЕЛИКЕ слово
      let cw = extractDirective(body, 'CODE-WORD STAMP', 'CODE-WORD', 'CODEWORD');
      if (cw) cw = cw.replace(/\*\*/g,'').replace(/[«"']/g,'').trim();
      if (!cw) {
        const cwm = body.match(/\*\*([А-ЯҐЄІЇ]{3,})\*\*/);
        cw = cwm ? cwm[1] : codeWord;
      }
      const instruction = extractDirective(body, 'INSTRUCTION');
      // STAKE block (Hormozi)
      const stakeM = body.match(/(?:STAKE|СТАВКА)[\s\S]+?(?=─{3,}|SEAL|JD\s*·|$)/i);
      let stakeText = '';
      if (stakeM) {
        stakeText = stakeM[0]
          .replace(/^(?:STAKE|СТАВКА|stake-block|─+)\s*[—\-]*\s*\n?/i,'')
          .replace(/^─+\s*СТАВКА\s*─+\s*\n?/im,'')
          .replace(/─+/g,'')
          .trim();
      }
      const seal = extractDirective(body, 'SEAL') || 'JD · 2026 · @yurii_dovhan';
      const caseLabel = extractDirective(body, 'CASE BAR') || `CASE №${caseNum}`;
      return `
<section class="slide" data-layout="case-closed" id="s${num}">
  <div class="case-bar">
    <span class="num">${caseLabel.split('·')[0].trim()}</span>
    <span>СТАТУС: ЗАКРИТО</span>
  </div>
  <div class="finale">
    <span class="directive">${v2Markup(directive.replace(/\*\*/g,'').replace(/:$/,''))}:</span>
    <div class="code-word">${cw}</div>
    ${instruction ? `<p class="instruction">${v2Markup(instruction).replace(/\n/g,'<br>')}</p>` : ''}
    ${stakeText ? `
    <div class="stake-block">
      <span class="stake-label">СТАВКА</span>
      <p>${v2Markup(stakeText).replace(/\n/g,'<br>')}</p>
    </div>` : ''}
  </div>
  <div class="seal">
    <span class="seal-stamp">JD · 2026</span>
    <span>@yurii_dovhan</span>
  </div>
</section>`;
    }

    default: {
      // fallback — default-body
      const lines = extractContentLines(body);
      const html = lines.map(l => `<p>${v2Markup(stripDirective(l))}</p>`).join('');
      return `
<section class="slide" data-layout="${layout || 'statement-card'}" id="s${num}">
  <span class="slide-label">СЛІД ${String(num).padStart(2,'0')}</span>
  <div class="default-body">${html}</div>
  <div class="num-pill">${String(num).padStart(2,'0')} / ${String(total).padStart(2,'0')}</div>
</section>`;
    }
  }
}

// =================================================================
// ============ V1 PARSER + RENDERER (legacy back-compat) ==========
// =================================================================
function parseV1(src) {
  const slides = [];
  const norm = src.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const headerRe = /^#{2,4}\s*(?:СЛАЙД|Слайд)\s*(\d+)([^\n]*)$/gim;
  const headers = [];
  let hm;
  while ((hm = headerRe.exec(norm)) !== null) {
    headers.push({ num: parseInt(hm[1]), labelLine: hm[2] || '', start: hm.index, headerEnd: hm.index + hm[0].length });
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i+1].start : norm.length;
    const sub = norm.slice(h.headerEnd, nextStart);
    const cutMatch = sub.match(/\n(?:#{1,4}\s*(?:CAPTION|Caption|caption|HASHTAGS|Hashtags|ТЕКСТ ПІД|ВЕРИФІК|[А-ЯҐЄІЇA-Z]{3,}\s*$)|---+\s*$)/m);
    const body = (cutMatch ? sub.slice(0, cutMatch.index) : sub).trim();
    const parenLabel = h.labelLine.match(/\(([^)]+)\)/);
    const dashLabel = h.labelLine.match(/[—\-·:]\s*(.+?)(?:\s*\(|$)/);
    const label = (parenLabel ? parenLabel[1] : dashLabel ? dashLabel[1] : h.labelLine).trim().replace(/^[—\-·:]\s*/,'');
    if (body) slides.push({ num: h.num, label, body });
  }
  const seen = new Set(); const uniq = [];
  for (const s of slides) if (!seen.has(s.num)) { seen.add(s.num); uniq.push(s); }
  uniq.sort((a,b) => a.num - b.num);
  return uniq;
}

const toHtmlLines = body => {
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

function renderV1Slide(s, idx, totalSlides) {
  const label = (s.label || '').toUpperCase();
  const isCover = /ОБКЛАДИНКА/.test(label) || s.num === 1;
  const isCTA = /CTA|КОДОВ/.test(label) || s.num === totalSlides;
  const isQuote = /БІЛЬ ДОСЛ|ЦИТАТА|QUOTE|ДОСЛ/.test(label);
  const isZeigarnik = /ПОВОРОТ|МІСТ|ZEIGARNIK/.test(label);
  const isMechanism = /МЕХАН/.test(label);
  const isArtefact = /ВАУ|АРТЕФ|БОНУС|ВХОДИТЬ|ЩО ВХОД|ОТРИМАЄТЕ/.test(label);
  const isScene = /СЦЕНА/.test(label);

  const topBar = variant === 'hormozi'
    ? `<div class="top-bar"><span class="brand">${brandName}</span><span class="num">СПРАВА №${caseNum} · ${String(s.num).padStart(2,'0')}/${String(totalSlides).padStart(2,'0')}</span></div>`
    : `<div class="case-bar"><span class="num">СПРАВА №${caseNum}</span><span class="right">${brandName} · ${String(s.num).padStart(2,'0')}/${String(totalSlides).padStart(2,'0')}</span></div>`;

  if (isCover) {
    const bodyText = s.body.replace(/\*\*(.+?)\*\*/g,'<em>$1</em>');
    if (variant === 'hormozi') {
      const firstLine = bodyText.split('\n')[0];
      const rest = bodyText.split('\n').slice(1).join(' ');
      return `<div class="slide cover" id="s${s.num}">${topBar}<div><div class="kicker">Для психологів, коучів, консалтерів</div><h1 class="headline">${firstLine.replace(/\*\*(.+?)\*\*/g,'<em>$1</em>')}</h1>${rest ? `<p class="sub">${rest}</p>` : ''}</div><div class="footer-brand"><span>${brandName}</span><span>→ ЛИСТАЙ</span></div></div>`;
    }
    return `<div class="slide cover" id="s${s.num}">${topBar}<div class="hook">${bodyText.replace(/\n/g,'<br>')}</div><div class="footer-brand"><span>${brandName}</span><span class="slide-num">→ ЛИСТАЙ</span></div></div>`;
  }
  if (isCTA) {
    const cwMatch = s.body.match(/\*\*([А-ЯҐЄІЇ]+)\*\*/);
    const cw = cwMatch ? cwMatch[1] : codeWord;
    const lines = s.body.split('\n').map(l => l.trim()).filter(l => l && !/^\*\*[А-ЯҐЄІЇ]+\*\*$/.test(l));
    const directive = lines[0] || 'Напишіть у директ одне слово:';
    const after = lines.slice(1).join(' ');
    return `<div class="slide cta" id="s${s.num}">${topBar}<div><div class="directive">${directive.replace(/[*]+/g,'').replace(/:$/,'')}</div><div class="code-word">${cw}</div>${after ? `<div class="instruction">${after.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</div>` : ''}</div><div class="footer-brand"><span>${brandName}</span><span>&nbsp;DM · INSTAGRAM</span></div></div>`;
  }
  if (isQuote) {
    const clean = s.body.replace(/^«/,'').replace(/»$/,'').trim();
    return `<div class="slide" id="s${s.num}">${topBar}<div class="quote">${clean.replace(/\n/g,'<br>')}</div><div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div></div>`;
  }
  return `<div class="slide" id="s${s.num}">${topBar}${variant === 'hormozi' ? `<h2 class="slide-title">${label || ''}</h2>` : ''}<div class="${variant === 'hormozi' ? 'content' : 'body-text'}">${toHtmlLines(s.body)}</div><div class="num-pill">${String(s.num).padStart(2,'0')} / ${String(totalSlides).padStart(2,'0')}</div></div>`;
}

// =================================================================
// ============ MAIN PIPELINE ======================================
// =================================================================
const slides = mode === 'v2' ? parseV2(src) : parseV1(src);
console.log(`[${variant}/${slug}] parsed ${slides.length} slides`);
if (slides.length < 10) {
  console.warn('Only', slides.length, 'slides parsed — expected 10. Will render what I have.');
}

const slidesHtml = slides.map((s, i) =>
  mode === 'v2' ? renderV2Slide(s, i, slides.length) : renderV1Slide(s, i, slides.length)
).join('\n\n');

const finalHtml = tpl.replace('{{SLIDES}}', slidesHtml);

// write HTML for debug
const htmlFile = path.join(outDir, mode === 'v2' ? 'slides_v2.html' : 'slides.html');
fs.writeFileSync(htmlFile, finalHtml, 'utf8');

(async () => {
  console.log(`[${variant}/${slug}] launching Chrome…`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });

  const url = 'file:///' + htmlFile.replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  // wait for fonts
  await page.evaluate(() => document.fonts ? document.fonts.ready : Promise.resolve());
  await new Promise(r => setTimeout(r, 1500));

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
      optimizeForSpeed: false,
      clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h }
    });
    console.log(`  v slide_${String(s.num).padStart(2,'0')}.jpg`);
  }

  await browser.close();
  console.log(`[${variant}/${slug}] DONE (${slides.length} JPEG, mode=${mode})`);
})();
