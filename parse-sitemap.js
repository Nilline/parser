/**
 * Парсит sitemap.xml и создаёт маппинг URL -> базовая страница
 * Использует hreflang теги для группировки переводов
 *
 * Запуск: node parse-sitemap.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const SITEMAP_URL = 'https://www.coursebox.ai/sitemap.xml';

function fetchSitemap(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function parseSitemap() {
  console.log('📥 Загружаем sitemap.xml...\n');

  const xml = await fetchSitemap(SITEMAP_URL);

  console.log('📋 Парсим sitemap...\n');

  // Простой парсинг XML (без сторонних библиотек)
  // Ищем <url> блоки с <xhtml:link> hreflang тегами

  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  console.log(`Найдено блоков <url>: ${urlBlocks.length}\n`);

  // Маппинг: URL -> базовый URL (EN версия)
  const urlToBase = {};

  // Группы страниц по базовому URL
  const groups = new Map();

  for (const block of urlBlocks) {
    // Извлекаем основной <loc>
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) continue;

    const mainUrl = locMatch[1].replace('https://www.coursebox.ai', '');

    // Извлекаем все hreflang ссылки
    const hreflangMatches = block.matchAll(/<xhtml:link rel="alternate" hreflang="(.*?)" href="(.*?)"\/>/g);

    const translations = {};
    let hasHreflang = false;

    for (const match of hreflangMatches) {
      hasHreflang = true;
      const locale = match[1];
      const url = match[2].replace('https://www.coursebox.ai', '');
      translations[locale] = url;
    }

    // Если есть hreflang теги - это переводимая страница
    if (hasHreflang && translations.en) {
      const baseUrl = translations.en; // EN версия = базовый URL

      // Сохраняем группу
      if (!groups.has(baseUrl)) {
        groups.set(baseUrl, translations);
      }

      // Мапим все переводы на базовый URL
      for (const [locale, url] of Object.entries(translations)) {
        urlToBase[url] = baseUrl;
      }
    } else {
      // Страница без переводов - мапим саму на себя
      urlToBase[mainUrl] = mainUrl;
    }
  }

  console.log(`✅ Обработано страниц: ${urlBlocks.length}`);
  console.log(`✅ Уникальных базовых страниц: ${groups.size}`);
  console.log(`✅ Всего URL в маппинге: ${Object.keys(urlToBase).length}\n`);

  // Сохраняем в JSON файл
  const outputPath = path.join(__dirname, 'pages-mapping.json');
  fs.writeFileSync(outputPath, JSON.stringify(urlToBase, null, 2), 'utf8');

  console.log(`📝 Маппинг сохранён: ${outputPath}\n`);

  // Показываем примеры
  console.log('Примеры маппинга:');
  const examples = ['/contact', '/ar/tsl', '/pricing', '/ar/ltsaayr', '/about'];
  for (const url of examples) {
    if (urlToBase[url]) {
      console.log(`  ${url} → ${urlToBase[url]}`);
    }
  }

  console.log('\n✅ Готово!');
}

parseSitemap().catch(console.error);
