import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow, clipboard, Menu, screen, shell, type MenuItemConstructorOptions, type WebContents, type WebPreferences } from "electron";

import { classify, DEFAULT_SIZE, MIN_SIZE, restoreBounds, type WindowState } from "./policy";

/** One session for every OnCall window, kept on disk: the sign-in survives a restart as it would in a browser. */
export const PARTITION = "persist:oncall";

const STATIC = path.join(__dirname, "..", "..", "static");
const OFFLINE_PAGE = path.join(STATIC, "offline.html");
export const WINDOW_ICON = path.join(STATIC, "icon.png");

/**
 * The page runs as it does in Chrome: no Node, isolated from the preload,
 * sandboxed. Two differences, both for the softphone:
 * - not throttled in the background, so a minimised window still registers,
 *   rings and keeps its call's timers;
 * - sound without a click first, so the ring is heard on a window nobody has
 *   touched since it opened (a browser may keep it silent).
 */
export function webPreferences(): WebPreferences {
  return {
    preload: path.join(__dirname, "..", "preload", "preload.js"),
    partition: PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required",
    spellcheck: true,
  };
}

/**
 * The rules for every page the app shows (main window and the windows it
 * opens): OnCall and its sign-in stay in the app, other web links open in the
 * browser, anything else goes nowhere.
 */
export function guardContents(contents: WebContents, appOrigin: string): void {
  const stayOrLeave = (event: Electron.Event, url: string) => {
    const where = classify(url, appOrigin);
    if (where === "app" || where === "sign-in") return;
    event.preventDefault();
    if (where === "external") void shell.openExternal(url);
  };
  contents.on("will-navigate", stayOrLeave);
  contents.on("will-redirect", stayOrLeave);
  // A frame inside the page has no business loading anything but OnCall.
  contents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && classify(event.url, appOrigin) !== "app") event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    const where = classify(url, appOrigin);
    if (where === "app") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { width: 1200, height: 820, icon: WINDOW_ICON, autoHideMenuBar: true, webPreferences: webPreferences() },
      };
    }
    // admin.onsell.ro and the rest are their own sites, with their own sessions: the browser's.
    if (where !== "blocked") void shell.openExternal(url);
    return { action: "deny" };
  });

  contents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    for (const word of params.dictionarySuggestions.slice(0, 5)) items.push({ label: word, click: () => contents.replaceMisspelling(word) });
    if (params.misspelledWord) {
      items.push({ label: "Adaugă în dicționar", click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: "separator" });
    }
    if (params.linkURL && classify(params.linkURL, appOrigin) !== "blocked") {
      items.push({ label: "Copiază linkul", click: () => clipboard.writeText(params.linkURL) }, { type: "separator" });
    }
    if (params.isEditable) {
      items.push(
        { label: "Taie", role: "cut", enabled: params.editFlags.canCut },
        { label: "Copiază", role: "copy", enabled: params.editFlags.canCopy },
        { label: "Lipește", role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: "Selectează tot", role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      items.push({ label: "Copiază", role: "copy" });
    }
    while (items.at(-1)?.type === "separator") items.pop();
    if (items.length > 0) Menu.buildFromTemplate(items).popup();
  });
}

export interface MainWindowOptions {
  appUrl: string;
  appOrigin: string;
  /** True once the app is really quitting: closing the window then closes it instead of hiding it. */
  quitting(): boolean;
  /** The page was replaced (reload, crash, new load): its call signals no longer hold. */
  onPageReplaced(): void;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const saved = restoreBounds(readState(), screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    ...(saved?.bounds ?? DEFAULT_SIZE),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: "OnCall",
    icon: WINDOW_ICON,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  if (saved?.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const contents = win.webContents;
  contents.on("did-navigate", options.onPageReplaced);
  contents.on("render-process-gone", (_event, details) => {
    options.onPageReplaced();
    if (details.reason !== "clean-exit") contents.reload();
  });

  // No connection (or call.onsell.ro is down): a page that says so and tries again, instead of Chromium's error.
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED: a navigation replaced by another */) return;
    if (classify(url, options.appOrigin) === "blocked") return;
    void win.loadFile(OFFLINE_PAGE, { query: { url } });
  });

  // Closing the window keeps OnCall running (tray, Dock): the phone stays registered and an incoming call brings it back.
  win.on("close", (event) => {
    writeState(win);
    if (options.quitting()) return;
    event.preventDefault();
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => win.hide());
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  });

  void win.loadURL(options.appUrl);
  return win;
}

const statePath = () => path.join(app.getPath("userData"), "window-state.json");

function readState(): unknown {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return null;
  }
}

function writeState(win: BrowserWindow): void {
  const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    // A window that opens at its default size next time is not worth an error.
  }
}
