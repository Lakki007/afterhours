// Generates the PWA icons from web/src/assets/brand/recurse-icon.png using the
// Chromium that Playwright installs (canvas resize, no extra dependency).
//   node scripts/make-icons.mjs
/* global Image, document */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'web/src/assets/brand/recurse-icon.png')).toString('base64');
const out = join(root, 'web/public/icons');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const specs = [
  { file: 'icon-192.png', size: 192, pad: 0.1, bg: true },
  { file: 'icon-512.png', size: 512, pad: 0.1, bg: true },
  // maskable: art inside the central 60% safe zone, full-bleed background
  { file: 'icon-maskable-512.png', size: 512, pad: 0.22, bg: true, full: true },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.1, bg: true, full: true },
  { file: 'favicon-32.png', size: 32, pad: 0.02, bg: false },
];
for (const sp of specs) {
  const dataUrl = await page.evaluate(
    async ({ src, sp }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = sp.size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      const S = sp.size;
      if (sp.bg) {
        // tangerine card stock with a hard ink offset shadow, like the app
        g.fillStyle = '#ff6a1f';
        if (sp.full) g.fillRect(0, 0, S, S);
        else {
          g.beginPath();
          g.roundRect(S * 0.02, S * 0.02, S * 0.96, S * 0.96, S * 0.2);
          g.fill();
        }
      }
      const art = S * (1 - sp.pad * 2);
      const o = (S - art) / 2;
      if (sp.bg) {
        g.fillStyle = '#1d1630';
        g.beginPath();
        g.roundRect(o + S * 0.025, o + S * 0.03, art, art, art * 0.22);
        g.fill();
      }
      g.drawImage(img, o, o, art, art);
      return c.toDataURL('image/png');
    },
    { src, sp },
  );
  writeFileSync(join(out, sp.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', sp.file);
}
await browser.close();
