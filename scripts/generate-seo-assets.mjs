import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
await mkdir(publicDir, { recursive: true });

const mark = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Private Story Reader audio lines mark">
  <circle cx="16" cy="16" r="16" fill="#294f3e"/>
  <g fill="none" stroke="#f8f6f0" stroke-linecap="round" stroke-width="1.65">
    <path d="M7.5 12.5v7M11.5 9.5v13M15.5 13v6M19.5 8.5v15M23.5 12v8"/>
  </g>
</svg>`;

const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>\n${mark}`;
await writeFile(resolve(publicDir, 'favicon.svg'), iconSvg);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const renderSvg = async (svg, path, width, height) => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<body style="margin:0;width:${width}px;height:${height}px">${svg}</body>`);
    await page.locator('svg').screenshot({ path, omitBackground: false });
  };
  const svgDocument = (width, height, content) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;

  for (const [name, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    const scaled = `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.42}" fill="#294f3e"/><g fill="none" stroke="#f8f6f0" stroke-linecap="round" stroke-width="${size * 0.052}"><path d="M${size * .29} ${size * .39}v${size * .22}M${size * .4} ${size * .29}v${size * .42}M${size * .5} ${size * .41}v${size * .18}M${size * .6} ${size * .26}v${size * .46}M${size * .71} ${size * .38}v${size * .24}"/></g>`;
    await renderSvg(svgDocument(size, size, `<rect width="${size}" height="${size}" fill="#f7f6f2"/>${scaled}`), resolve(publicDir, name), size, size);
  }
  const maskable = svgDocument(512, 512, '<rect width="512" height="512" fill="#294f3e"/><g fill="none" stroke="#f8f6f0" stroke-linecap="round" stroke-width="28"><path d="M145 200v112M205 148v216M256 210v92M307 133v246M367 195v122"/></g>');
  await renderSvg(maskable, resolve(publicDir, 'icon-512-maskable.png'), 512, 512);

  const og = svgDocument(1200, 630, `
    <rect width="1200" height="630" fill="#f7f6f2"/>
    <circle cx="1000" cy="310" r="255" fill="#e4e6da"/>
    <circle cx="1000" cy="310" r="215" fill="none" stroke="#d7dacd" stroke-width="2"/>
    <g transform="translate(854 124) rotate(-5 130 185)">
      <rect x="9" y="11" width="258" height="368" rx="12" fill="#b6b4a5"/>
      <rect width="258" height="368" rx="12" fill="#35503f"/>
      <rect x="15" y="15" width="228" height="338" rx="8" fill="#304b3d" stroke="#89967e"/>
      <circle cx="130" cy="132" r="40" fill="#d8ba7a"/>
      <path d="M18 237 Q80 160 151 230 T244 210 V353 H18Z" fill="#67735a"/>
      <path d="M18 277 Q103 220 155 281 T244 260 V353 H18Z" fill="#243b32"/>
      <text x="34" y="310" fill="#f1e8cf" font-family="Georgia,serif" font-size="30">a story</text>
    </g>
    <circle cx="115" cy="114" r="32" fill="#294f3e"/>
    <g fill="none" stroke="#f8f6f0" stroke-linecap="round" stroke-width="2.3"><path d="M100 108v12M108 101v26M116 109v10M124 99v30M132 106v16"/></g>
    <text x="165" y="124" fill="#252923" font-family="Georgia,serif" font-size="30">Private Story Reader</text>
    <text x="90" y="282" fill="#30342b" font-family="Georgia,serif" font-size="55">Let the story</text>
    <text x="90" y="345" fill="#63785e" font-family="Georgia,serif" font-size="55" font-style="italic">find its voice.</text>
    <text x="92" y="408" fill="#62645b" font-family="Arial,sans-serif" font-size="19">Read your documents. Listen in your browser.</text>
    <text x="92" y="443" fill="#62645b" font-family="Arial,sans-serif" font-size="19">Private by design. Free and open source.</text>
  `);
  await renderSvg(og, resolve(publicDir, 'og-image.png'), 1200, 630);
} finally {
  await browser.close();
}
