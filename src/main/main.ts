import { app, BrowserWindow, dialog, ipcMain, Notification, powerMonitor, session, type IpcMainEvent } from "electron";

import { CallSignals, summon } from "./calls";
import { installMenu } from "./menu";
import { installPermissions } from "./permissions";
import { alive, appOriginOf, classify, DEFAULT_APP_URL, inFront, messageLabel, quitStep, ringLabel, threadIdOf, widgetCall, widgetCommand } from "./policy";
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

/** OnCall's window; null once it is closed for real (a quit), never a destroyed one. */
let mainWindow: BrowserWindow | null = null;
let quitting = false;
/** The «Ești într-un apel» question is open. */
let asking = false;
/** The last chat notification, held so it is not collected before its click arrives. */
let chatNotification: Notification | null = null;
const widget = new CallWidget({ url: `${APP_ORIGIN}/widget/apel`, main: () => alive(mainWindow), quitting: () => quitting });
const calls = new CallSignals(() => alive(mainWindow), () => !widget.available);

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
    if (fromOncall(event) && event.sender === alive(mainWindow)?.webContents) widget.update(widgetCall(state));
  });
  ipcMain.on("oncall:widget-ready", (event) => {
    if (fromOncall(event) && widget.owns(event.sender)) widget.ready();
  });
  ipcMain.on("oncall:widget-command", (event, value: unknown) => {
    const command = widgetCommand(value);
    if (!command || !fromOncall(event) || !widget.owns(event.sender)) return;
    if (command === "open") show();
    alive(mainWindow)?.webContents.send("oncall:command", command);
  });

  // A Supervisor's or an Admin's chat message while no OnCall window is in front: «Mesaj de la …», never the words.
  ipcMain.on("oncall:message", (event, label: unknown, id: unknown) => {
    if (!fromOncall(event)) return;
    notifyMessage(messageLabel(label), threadIdOf(id));
  });

  const updates = new Updates({ calls, downloadPage: DOWNLOAD_PAGE, beforeInstall: beginQuit });
  const checkForUpdates = () => void updates.check(true);

  openMainWindow();
  installMenu({ window: () => alive(mainWindow), calls, home: `${APP_ORIGIN}/`, downloadPage: DOWNLOAD_PAGE, checkForUpdates, quit: requestQuit });
  installTray({ show, quit: requestQuit, checkForUpdates, calls });
  updates.start();

  // macOS: the Dock icon of an app whose window is hidden.
  app.on("activate", show);
  powerMonitor.on("shutdown", quitNow);
}

/** OnCall's window, at start or again when it was closed while the app kept running. */
function openMainWindow(): BrowserWindow {
  const win = createMainWindow({
    appUrl: APP_URL,
    appOrigin: APP_ORIGIN,
    quitting: () => quitting,
    onPageReplaced: () => {
      calls.reset();
      widget.reset();
    },
  });
  for (const change of ["focus", "blur", "show", "hide", "minimize", "restore"] as const) win.on(change as "focus", () => widget.refresh());
  // The system is shutting down or logging off: the window closes instead of hiding, or it would hold that up.
  win.on("session-end", beginQuit);
  // Closed for real: forgotten, so nothing reaches for a destroyed window («Object has been destroyed»).
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    widget.refresh();
  });
  mainWindow = win;
  return win;
}

/** The quit has begun: from here the call widget never opens again, and it goes first. */
function beginQuit(): void {
  quitting = true;
  widget.close();
}

function quitNow(): void {
  beginQuit();
  app.quit();
}

process.on("SIGTERM", quitNow);

/**
 * «Ieși din OnCall» in the tray or the menu. Normally Electron's quit (which
 * asks first in a call, below). When a quit already began and did not finish,
 * Electron ignores another one: every window goes, which lets it finish, and
 * if the app is somehow still here a moment later, it stops.
 */
function requestQuit(): void {
  if (quitStep({ quitting, asking, inCall: calls.inCall, request: "ours" }) !== "force") {
    app.quit();
    return;
  }
  widget.close();
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
  app.quit();
  setTimeout(() => app.exit(0), 3000).unref();
}

/** OnCall's window to the front; opened again if it was closed. */
function show(): void {
  const win = alive(mainWindow);
  // A new window shows itself once its page is ready (createMainWindow), without a blank frame first.
  if (win) summon(win);
  else openMainWindow();
}

/** The chat notification; a click brings the main window (never the call widget) to the front, on the thread. */
function notifyMessage(label: string | null, threadId: string | null): void {
  if (!label || !threadId) return;
  // «In front» means the main window itself, as the call widget counts it: a focused widget is not OnCall's page.
  if (inFront(mainWindow)) return;
  if (process.platform === "win32") alive(mainWindow)?.flashFrame(true);
  if (process.platform === "darwin") app.dock?.bounce("informational");
  if (!Notification.isSupported()) return;
  chatNotification?.close();
  const notification = new Notification({ title: label });
  notification.on("click", () => {
    show();
    alive(mainWindow)?.webContents.send("oncall:open-chat", threadId);
  });
  notification.on("close", () => {
    if (chatNotification === notification) chatNotification = null;
  });
  chatNotification = notification;
  notification.show();
}

/** A message from an OnCall page; the sign-in on onsell.ro, an iframe or anything else does not count. */
function fromOncall(event: IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return Boolean(frame && !frame.parent && classify(frame.url, APP_ORIGIN) === "app");
}

// Quitting ends the call in progress: in a call, it asks first.
app.on("before-quit", (event) => {
  const step = quitStep({ quitting, asking, inCall: calls.inCall, request: "electron" });
  if (step === "proceed") {
    beginQuit();
    return;
  }
  event.preventDefault();
  // The question is already open: no second one.
  if (step === "wait") return;
  asking = true;
  void dialog
    .showMessageBox({
      type: "warning",
      message: "Ești într-un apel.",
      detail: "Dacă ieși din OnCall, apelul se închide.",
      buttons: ["Ieși oricum", "Rămân în apel"],
      defaultId: 1,
      cancelId: 1,
    })
    .finally(() => (asking = false))
    .then(({ response }) => {
      if (response !== 0) return;
      // The widget goes before the call's end can bring it back, then everything else.
      beginQuit();
      app.quit();
    });
});

// The window is only ever hidden, so this fires on quit; nothing keeps the app alive past it.
app.on("window-all-closed", () => app.quit());
