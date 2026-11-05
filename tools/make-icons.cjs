"use strict";

/**
 * Draws the app's icons from the OnCall mark (the headset of the web app's
 * `src/app/icon.svg`) with Electron's own renderer, so no image tool is
 * needed: `npm run icons`, then commit what changed.
 *
 * - build/icon.png: 1024 px, the source electron-builder makes the .icns and
 *   .ico from; the mark inset to the macOS icon grid (~820 px of 1024).
 * - static/icon.png: the window icon (Windows taskbar, Alt+Tab).
 * - static/tray.png: the notification-area icon on Windows (32 px).
 * - static/trayTemplate.png, @2x: the macOS menu bar icon, black on clear,
 *   which macOS tints for light and dark menu bars.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const ROOT = path.join(__dirname, "..");
const HEADSET = "M7 19v-3a9 9 0 0 1 18 0v3M7 19h3.5v6H8a1 1 0 0 1-1-1zM25 19h-3.5v6H24a1 1 0 0 0 1-1z";

const mark = (inset) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect x="${inset}" y="${inset}" width="${32 - 2 * inset}" height="${32 - 2 * inset}" rx="${7 * (1 - inset / 16)}" fill="#B8173A"/>
    <g transform="translate(16 16) scale(${1 - inset / 16}) translate(-16 -16)">
      <path d="${HEADSET}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;

const template = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="4 6 24 22">
    <path d="${HEADSET}" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

const OUTPUTS = [
  { file: "build/icon.png", size: 1024, svg: mark(3.2) },
  { file: "static/icon.png", size: 512, svg: mark(0) },
  { file: "static/tray.png", size: 32, svg: mark(0) },
  { file: "static/trayTemplate.png", size: 16, svg: template },
  { file: "static/trayTemplate@2x.png", size: 32, svg: template },
];

async function render(win, { file, size, svg }) {
  win.setContentSize(size, size);
  const html = `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.writeFileSync(path.join(ROOT, file), image.resize({ width: size, height: size }).toPNG());
  console.log(`${file} ${size}px`);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // One window for all of them: a renderer per icon is slower and, in some sandboxes, refused.
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  for (const output of OUTPUTS) await render(win, output);
  app.quit();
});
