/**
 * Compare two URL lists
 */

const fs = require('fs');
const path = require('path');

const file1 = path.join(__dirname, '..', 'urls-main.txt');
const file2 = path.join(__dirname, '..', 'result', 'webflow-pages.txt');

function readUrls(filepath) {
  return fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

const urls1 = readUrls(file1);
const urls2 = readUrls(file2);

const set1 = new Set(urls1);
const set2 = new Set(urls2);

const onlyIn1 = urls1.filter(url => !set2.has(url));
const onlyIn2 = urls2.filter(url => !set1.has(url));
const inBoth = urls1.filter(url => set2.has(url));

console.log('URL Comparison\n');
console.log(`urls-main.txt: ${urls1.length} URLs`);
console.log(`webflow-pages.txt: ${urls2.length} URLs\n`);

console.log(`Common URLs: ${inBoth.length}\n`);

if (onlyIn1.length > 0) {
  console.log(`Only in urls-main.txt (${onlyIn1.length}):`);
  onlyIn1.forEach(url => console.log(`   ${url}`));
  console.log();
}

if (onlyIn2.length > 0) {
  console.log(`Only in webflow-pages.txt (${onlyIn2.length}):`);
  onlyIn2.forEach(url => console.log(`   ${url}`));
  console.log();
}

if (onlyIn1.length === 0 && onlyIn2.length === 0) {
  console.log('Files are identical!');
}
