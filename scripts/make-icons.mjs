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
  { file: 'icon-maskable-192.png', size: 192, pad: 0.22, bg: true, full: true },
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

// Monochrome notification badge (Android draws it as a white silhouette): keep the
// robot's light pixels as opaque white, everything else transparent.
for (const [file, size] of [
  ['badge-96.png', 96],
  ['icon-monochrome-192.png', 192],
]) {
  const dataUrl = await page.evaluate(
    async ({ src, size }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size, size);
      const d = g.getImageData(0, 0, size, size);
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
        const a = d.data[i + 3] * Math.max(0, Math.min(1, (lum - 110) / 90));
        d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
        d.data[i + 3] = a;
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    },
    { src, size },
  );
  writeFileSync(join(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', file);
}

// iOS launch images (apple-touch-startup-image): paper background, the app icon, "after hours by recurse".
const logo = readFileSync(join(root, 'web/src/assets/brand/recurse-logo-black.png')).toString('base64');
for (const [w, h] of [
  [1170, 2532],
  [1179, 2556],
  [1284, 2778],
  [1290, 2796],
  [750, 1334],
  [828, 1792],
]) {
  const dataUrl = await page.evaluate(
    async ({ src, logo, w, h }) => {
      const load = async (b64) => {
        const i = new Image();
        i.src = `data:image/png;base64,${b64}`;
        await i.decode();
        return i;
      };
      const [icon, mark] = [await load(src), await load(logo)];
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#f6e7c8';
      g.fillRect(0, 0, w, h);
      const s = Math.round(w * 0.34);
      const x = (w - s) / 2;
      const y = h * 0.36;
      g.fillStyle = '#1d1630';
      g.beginPath();
      g.roundRect(x + s * 0.04, y + s * 0.05, s, s, s * 0.22);
      g.fill();
      g.fillStyle = '#ff6a1f';
      g.beginPath();
      g.roundRect(x, y, s, s, s * 0.22);
      g.fill();
      g.drawImage(icon, x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
      const mw = w * 0.42;
      const mh = (mw * mark.height) / mark.width;
      g.drawImage(mark, (w - mw) / 2, y + s + h * 0.06, mw, mh);
      return c.toDataURL('image/png');
    },
    { src, logo, w, h },
  );
  writeFileSync(join(out, `splash-${w}x${h}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', `splash-${w}x${h}.png`);
}
await browser.close();
