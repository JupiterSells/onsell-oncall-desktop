import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow, screen, type WebContents } from "electron";

import { WIDGET_SIZE, widgetPosition, type WidgetCall } from "./policy";
import { webPreferences } from "./window";

/**
 * The call widget (owner, 05.11.2026): while OnCall's window is not in front
 * (minimised, closed to the tray, behind another app), a small window over
 * everything shows the call and its buttons: answer, mute, hold, hang up,
 * back to the Pupitru. It is OnCall's own page (`/widget/apel` of the web
 * app); the call is the Pupitru's softphone's, relayed through here, so the
 * widget has no phone of its own and no second registration.
 *
 * Shown while there is something to show (a call ringing, dialled, up or
 * just ended, or a result still owed) and OnCall's window is not focused;
 * hidden as soon as it is. It never takes the focus by appearing.
 */
export class CallWidget {
  private win: BrowserWindow | null = null;
  private state: WidgetCall | null = null;
  /** The page in the main window has spoken since it loaded (web app with the widget, not an older one). */
  private pageHasWidget = false;

  constructor(private readonly options: { url: string; main(): BrowserWindow | null }) {}

  /** Whether a ring can rely on the widget instead of pulling OnCall's window over the operator's work. */
  get available(): boolean {
    return this.pageHasWidget;
  }

  update(state: WidgetCall | null): void {
    this.pageHasWidget = true;
    this.state = state;
    this.send();
    this.refresh();
  }

  /** The main window's page was replaced: its call is gone, and the next page has to say again whether it knows the widget. */
  reset(): void {
    this.pageHasWidget = false;
    this.state = null;
    this.send();
    this.refresh();
  }

  owns(contents: WebContents): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.webContents === contents);
  }

  /** The widget's page has loaded and is listening: it gets the call as it is now. */
  ready(): void {
    this.send();
  }

  /** Main window focus changed, or the call did: show or hide. */
  refresh(): void {
    const main = this.options.main();
    const mainInFront = Boolean(main && main.isVisible() && !main.isMinimized() && main.isFocused());
    if (this.state && !mainInFront) {
      const win = this.window();
      if (!win.isVisible()) win.showInactive();
    } else if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
    }
  }

  private send(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send("oncall:call-state", this.state);
  }

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const displays = screen.getAllDisplays().map((d) => d.workArea);
    const { x, y } = widgetPosition(readPosition(), displays, screen.getPrimaryDisplay().workArea);
    const win = new BrowserWindow({
      x,
      y,
      ...WIDGET_SIZE,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "OnCall · apel",
      backgroundColor: "#ffffff",
      webPreferences: webPreferences(),
    });
    // Above ordinary windows, on every desktop / Space the operator switches to.
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true);
    win.on("moved", () => writePosition(win));
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    void win.loadURL(this.options.url);
    this.win = win;
    return win;
  }
}

const positionPath = () => path.join(app.getPath("userData"), "widget-position.json");

function readPosition(): unknown {
  try {
    return JSON.parse(fs.readFileSync(positionPath(), "utf8"));
  } catch {
    return null;
  }
}

function writePosition(win: BrowserWindow): void {
  const [x, y] = win.getPosition();
  try {
    fs.writeFileSync(positionPath(), JSON.stringify({ x, y }));
  } catch {
    // The corner again next time.
  }
}
