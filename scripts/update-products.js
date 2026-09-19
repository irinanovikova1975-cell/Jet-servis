// scripts/update-products.js
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const CHANNEL = 'JetBuyerService';
const BASE_URL = `https://t.me/s/${CHANNEL}`;
const MAX_PER_CATEGORY = 50;
const BRAND_LABELS = {
  louisvuitton: 'LOUIS VUITTON',
  dolcegabbana: 'DOLCE & GABBANA',
  saintlaurent: 'SAINT LAURENT',
  ysl: 'SAINT LAURENT',
  hermes: 'HERMÈS',
  dior: 'DIOR',
  chanel: 'CHANEL',
  prada: 'PRADA',
  fendi: 'FENDI',
  loropiana: 'LORO PIANA',
  gucci: 'GUCCI',
  balenciaga: 'BALENCIAGA',
  bottegaveneta: 'BOTTEGA VENETA',
  celine: 'CÉLINE',
  valentino: 'VALENTINO',
  versace: 'VERSACE',
  burberry: 'BURBERRY',
  miumiu: 'MIU MIU',
  vancleefarpels: 'VAN CLEEF & ARPELS',
  cartier: 'CARTIER',
  rolex: 'ROLEX',
  iphone: 'IPHONE',
  apple: 'APPLE',
  dyson: 'DYSON',
  tiffany: 'TIFFANY & CO.',
  bulgari: 'BVLGARI',
  omega: 'OMEGA',
  patekphilippe: 'PATEK PHILIPPE'
};

const MAX_PAGES = 8; // скільки "сторінок" історії гортати назад

function cleanLine(s) {
  return s
    .replace(/#[^\s#.,!?;:()]+/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .trim();
}

function extractBgUrl(styleAttr) {
  const m = (styleAttr || '').match(/url\(['"]?(.*?)['"]?\)/);
  return m ? m[1] : '';
}

async function fetchPage(beforeId) {
  const url = beforeId ? `${BASE_URL}?before=${beforeId}` : BASE_URL;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JetServiceBot/1.0)' }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  return cheerio.load(html);
}

function getPostId($, postEl) {
  const dataPost = $(postEl).attr('data-post') || '';
  const parts = dataPost.split('/');
  const id = parseInt(parts[parts.length - 1], 10);
  return isNaN(id) ? null : id;
}

async function collectAllPosts() {
  const seenIds = new Set();
  const orderedPages = []; // кожна сторінка: масив {$ , el, id}, у порядку від новіших до старіших сторінок
  let beforeId = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const $ = await fetchPage(beforeId);
    const postEls = [...$('.tgme_widget_message')];
    if (!postEls.length) break;

    const pageItems = [];
    let minId = null;
    for (const el of postEls) {
      const id = getPostId($, el);
      if (id === null) continue;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        pageItems.push({ $, el, id });
      }
      if (minId === null || id < minId) minId = id;
    }

    if (!pageItems.length || minId === null || minId === beforeId) break;

    orderedPages.push(pageItems.reverse()); // в межах сторінки — найновіші спочатку
    beforeId = minId;

    if (seenIds.size >= MAX_PER_CATEGORY * 2 + 20) break; // зібрали достатньо з запасом
  }

  // сторінки йдуть від найновішої до найстарішої, всередині кожної вже найновіші спочатку
  return orderedPages.flat();
}

async function main() {
  const posts = await collectAllPosts();
  const products = [];
  let stockCount = 0;
  let orderCount = 0;

  posts.forEach(({ $, el }) => {
    if (stockCount >= MAX_PER_CATEGORY && orderCount >= MAX_PER_CATEGORY) return;
    const post = $(el);

    const textEl = post.find('.tgme_widget_message_text').first();
    const photoEls = post.find('.tgme_widget_message_photo_wrap');
    if (!textEl.length && photoEls.length === 0) return;

    const textUpper = textEl.text().toUpperCase();
    if (textUpper.includes('ПРОДАНО')) return;

    const photos = [];
    photoEls.each((_, ph) => {
      const url = extractBgUrl($(ph).attr('style'));
      if (url) photos.push(url);
    });

    const videos = [];
    post.find('video').each((_, v) => {
      const src = $(v).attr('src') || $(v).attr('data-src');
      const poster = $(v).attr('poster') || photos[0] || '';
      if (src) videos.push({ src, poster });
    });

    let lines = [];
    if (textEl.length) {
      const clone = textEl.clone();
      clone.find('br').replaceWith('\n');
      lines = clone.text().split('\n').map(s => s.trim()).filter(Boolean);
    }

    const allText = lines.join('\n');
    const allTextLower = allText.toLowerCase();

    const cardTags = [];
    (allText.match(/#[^\s#.,!?;:()]+/g) || []).forEach(t => {
      const key = t.slice(1).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ]/g, '').toLowerCase();
      if (key && cardTags.indexOf(key) === -1) cardTags.push(key);
    });

    let title = 'Товар', titleIdx = -1;
for (let i = 0; i < lines.length; i++) {
  const c = cleanLine(lines[i]);
  if (c.length > 2) { title = c; titleIdx = i; break; }
}
if (titleIdx === -1 && lines.length) { title = cleanLine(lines[0]) || 'Товар'; titleIdx = 0; }

if (cardTags.length && titleIdx > 0) {
  title = prettyBrand(cardTags[0]) + ' — ' + title;
}

    let price = '';
let priceLineIdx = -1;
if (titleIdx > -1) {
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (/[€]|грн/i.test(lines[i])) { price = cleanLine(lines[i]); priceLineIdx = i; break; }
  }
  if (!price) {
    for (let i = titleIdx + 1; i < lines.length; i++) {
      const c = cleanLine(lines[i]);
      if (/\d/.test(c) && c.length < 30) { price = c; priceLineIdx = i; break; }
    }
  }
}

if (!price) return;

const descLines = lines.filter((line, idx) => {
  if (idx === titleIdx || idx === priceLineIdx) return false;
  return line.replace(/#[^\s#.,!?;:()]+/g, '').trim().length > 0;
});
const descriptionBody = descLines.map(cleanLine).join('\n');


    let category = 'order';
    if (allTextLower.includes('у наявності') || allTextLower.includes('в наявності')) {
      category = 'stock';
    } else if (allTextLower.includes('доставка')) {
      category = 'order';
    }

    if (category === 'stock' && stockCount >= MAX_PER_CATEGORY) return;
    if (category === 'order' && orderCount >= MAX_PER_CATEGORY) return;
    if (category === 'stock') stockCount++; else orderCount++;

    const dataPost = post.attr('data-post') || '';
    const postUrl = dataPost ? `https://t.me/${dataPost}` : `https://t.me/${CHANNEL}`;

  
    products.push({ title, price, photos, videos, description: descriptionBody, postUrl, tags: cardTags, category });


  const outPath = path.join(__dirname, '..', 'products.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ updatedAt: new Date().toISOString(), products }, null, 2),
    'utf-8'
  );
  console.log(`Saved ${products.length} products (${stockCount} в наявності, ${orderCount} під замовлення)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
