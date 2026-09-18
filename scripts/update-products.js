// scripts/update-products.js
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const CHANNEL = 'JetBuyerService';
const TG_URL = `https://t.me/s/${CHANNEL}`;
const MAX_PER_CATEGORY = 50;

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

async function main() {
  const res = await fetch(TG_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JetServiceBot/1.0)' }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const posts = [...$('.tgme_widget_message')].reverse(); // найновіші спочатку
  const products = [];
  let stockCount = 0;
  let orderCount = 0;

  posts.forEach((postEl) => {
    if (stockCount >= MAX_PER_CATEGORY && orderCount >= MAX_PER_CATEGORY) return;
    const post = $(postEl);

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
      const key = t.slice(1).toUpperCase().replace(/[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ]/g, '').toLowerCase();
      if (key && cardTags.indexOf(key) === -1) cardTags.push(key);
    });

    let title = 'Товар', titleIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const c = cleanLine(lines[i]);
      if (c.length > 2) { title = c; titleIdx = i; break; }
    }
    if (titleIdx === -1 && lines.length) { title = cleanLine(lines[0]) || 'Товар'; titleIdx = 0; }

    let price = '';
    if (titleIdx > -1) {
      for (let i = titleIdx + 1; i < lines.length; i++) {
        if (/[€]|грн/i.test(lines[i])) { price = cleanLine(lines[i]); break; }
      }
      if (!price) {
        for (let i = titleIdx + 1; i < lines.length; i++) {
          const c = cleanLine(lines[i]);
          if (/\d/.test(c) && c.length < 30) { price = c; break; }
        }
      }
    }

    if (!price) return;

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

    products.push({ title, price, photos, videos, description: allText, postUrl, tags: cardTags, category });
  });

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
