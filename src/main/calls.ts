import { app, Notification, powerSaveBlocker, type BrowserWindow } from "electron";

/**
 * What the softphone tells the app (through the preload's `oncallDesktop`),
 * and what the app does about it.
 *
 * - **A call rings**: the web app already plays the tone and blinks the tab
 *   title (Voxbee guide §11.5). On a desktop the window may be minimised or
 *   behind another app, so it also comes to the front, the taskbar button
 *   flashes (Windows) or the Dock icon bounces (macOS), and a notification
 *   names the caller.
 * - **A call is up**: the computer does not go to sleep under it, and
 *   quitting or reloading asks first, since either ends the call.
 *
 * Both are reset when the page itself is replaced (a reload, a crash): the
 * page that said so is gone, and its call with it.
 */
export class CallSignals {
  private ringing: string | null = null;
  private notification: Notification | null = null;
  private blocker: number | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly window: () => BrowserWindow | null) {}

  get inCall(): boolean {
    return this.blocker !== null;
  }

  /** Called with every change of `inCall`. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ring(label: string | null): void {
    if (label === this.ringing) return;
    this.stopRinging();
    this.ringing = label;
    if (!label) return;

    const win = this.window();
    if (win && !win.isFocused()) summon(win);
    if (process.platform === "darwin") app.dock?.bounce("critical");

    if (Notification.isSupported()) {
      // Silent: the page plays the ring, a second sound would be on top of it.
      this.notification = new Notification({ title: "Apel primit", body: label, silent: true, urgency: "critical" });
      this.notification.on("click", () => {
        const w = this.window();
        if (w) summon(w);
      });
      this.notification.show();
    }
  }

  setInCall(active: boolean): void {
    if (active === this.inCall) return;
    if (active) {
      // The app keeps running, the screen may still dim: a call needs the network and the audio, not the display.
      this.blocker = powerSaveBlocker.start("prevent-app-suspension");
    } else if (this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
    }
    for (const listener of this.listeners) listener();
  }

  /** The page was replaced: whatever it said no longer holds. */
  reset(): void {
    this.ring(null);
    this.setInCall(false);
  }

  private stopRinging(): void {
    this.ringing = null;
    this.notification?.close();
    this.notification = null;
    this.window()?.flashFrame(false);
  }
}

/** The window to the front, over whatever the operator has open. */
export function summon(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  if (process.platform === "win32") {
    // Windows does not let a background app take the focus; briefly on top is the accepted way over it.
    win.setAlwaysOnTop(true);
    win.focus();
    win.setAlwaysOnTop(false);
    if (!win.isFocused()) win.flashFrame(true);
  } else {
    app.focus({ steal: true });
    win.focus();
  }
}
