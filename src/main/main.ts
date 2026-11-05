import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, type IpcMainEvent } from "electron";

import { CallSignals, summon } from "./calls";
import { installMenu } from "./menu";
import { installPermissions } from "./permissions";
import { appOriginOf, classify, DEFAULT_APP_URL, ringLabel, widgetCall, widgetCommand } from "./policy";
import { installTray } from "./tray";
import { Updates } from "./updater";
import { CallWidget } from "./widget";
import { createMainWindow, guardContents, PARTITION } from "./window";

/**
 * OnCall for Windows and macOS: call.onsell.ro in its own window.
 *
 * Every screen, role and rule is the web app's, served by call.onsell.ro, so
 * the app is never a version behind a deploy and holds no copy of OnCall's
 * logic. What it adds is what a browser tab cannot do well for an operator:
 * a phone that rings over other apps and while minimised, a computer that
 * does not sleep under a call, a tray icon, and updates of its own.
 */
const APP_URL = !app.isPackaged && process.env.ONCALL_URL ? process.env.ONCALL_URL : DEFAULT_APP_URL;
const APP_ORIGIN = appOriginOf(APP_URL);
const DOWNLOAD_PAGE = `${APP_ORIGIN}/aplicatie`;

let mainWindow: BrowserWindow | null = null;
let quitting = false;
const widget = new CallWidget({ url: `${APP_ORIGIN}/widget/apel`, main: () => mainWindow });
const calls = new CallSignals(() => mainWindow, () => !widget.available);

app.setAppUserModelId("ro.onsell.oncall");
// A developer's run against another OnCall keeps its own sign-in and lock, apart from the installed app's.
if (APP_URL !== DEFAULT_APP_URL) app.setPath("userData", `${app.getPath("userData")}-dev`);

if (!app.requestSingleInstanceLock()) {
  // OnCall is already open: that one comes to the front (second-instance below), this one leaves.
  app.quit();
} else {
  app.on("second-instance", () => show());
  app.on("web-contents-created", (_event, contents) => guardContents(contents, APP_ORIGIN));
  void app.whenReady().then(start);
}

function start(): void {
  const oncall = session.fromPartition(PARTITION);
  // Chrome's user agent and the app's version; without "Electron/…", which some sign-in pages refuse.
  oncall.setUserAgent(`${oncall.getUserAgent().replace(/\s(Electron|onsell-oncall-desktop|OnCall)\/\S+/g, "")} OnCallDesktop/${app.getVersion()}`);
  oncall.setSpellCheckerLanguages(process.platform === "darwin" ? [] : ["ro", "en-US"]);
  installPermissions(oncall, APP_ORIGIN);

  ipcMain.on("oncall:hello", (event) => {
    event.returnValue = fromOncall(event) ? { version: app.getVersion(), platform: process.platform } : null;
  });
  ipcMain.on("oncall:ringing", (event, label: unknown) => {
    if (fromOncall(event)) calls.ring(ringLabel(label));
  });
  ipcMain.on("oncall:call", (event, active: unknown) => {
    if (fromOncall(event)) calls.setInCall(active === true);
  });
  // The call widget: the call from the main window's softphone, the buttons from the widget, each only from its own window.
  ipcMain.on("oncall:call-update", (event, state: unknown) => {
    if (fromOncall(event) && event.sender === mainWindow?.webContents) widget.update(widgetCall(state));
  });
  ipcMain.on("oncall:widget-ready", (event) => {
    if (fromOncall(event) && widget.owns(event.sender)) widget.ready();
  });
  ipcMain.on("oncall:widget-command", (event, value: unknown) => {
    const command = widgetCommand(value);
    if (!command || !fromOncall(event) || !widget.owns(event.sender)) return;
    if (command === "open") show();
    mainWindow?.webContents.send("oncall:command", command);
  });

  const updates = new Updates({ calls, downloadPage: DOWNLOAD_PAGE, beforeInstall: () => (quitting = true) });
  const checkForUpdates = () => void updates.check(true);

  mainWindow = createMainWindow({
    appUrl: APP_URL,
    appOrigin: APP_ORIGIN,
    quitting: () => quitting,
    onPageReplaced: () => {
      calls.reset();
      widget.reset();
    },
  });
  for (const change of ["focus", "blur", "show", "hide", "minimize", "restore"] as const) mainWindow.on(change as "focus", () => widget.refresh());
  installMenu({ window: () => mainWindow, calls, home: `${APP_ORIGIN}/`, downloadPage: DOWNLOAD_PAGE, checkForUpdates });
  installTray({ show, checkForUpdates, calls });
  updates.start();

  // macOS: the Dock icon of an app whose window is hidden.
  app.on("activate", show);

  // The system is shutting down or logging off: the window closes instead of hiding, or it would hold that up.
  mainWindow.on("session-end", () => (quitting = true));
  powerMonitor.on("shutdown", quitNow);
}

function quitNow(): void {
  quitting = true;
  app.quit();
}

process.on("SIGTERM", quitNow);

function show(): void {
  if (mainWindow) summon(mainWindow);
}

/** A message from an OnCall page; the sign-in on onsell.ro, an iframe or anything else does not count. */
function fromOncall(event: IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return Boolean(frame && !frame.parent && classify(frame.url, APP_ORIGIN) === "app");
}

// Quitting ends the call in progress: in a call, it asks first.
app.on("before-quit", (event) => {
  if (quitting) return;
  if (calls.inCall) {
    event.preventDefault();
    void dialog
      .showMessageBox({
        type: "warning",
        message: "Ești într-un apel.",
        detail: "Dacă ieși din OnCall, apelul se închide.",
        buttons: ["Ieși oricum", "Rămân în apel"],
        defaultId: 1,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response !== 0) return;
        quitting = true;
        app.quit();
      });
    return;
  }
  quitting = true;
});

// The window is only ever hidden, so this fires on quit; nothing keeps the app alive past it.
app.on("window-all-closed", () => app.quit());
