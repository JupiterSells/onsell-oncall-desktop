import { contextBridge, ipcRenderer } from "electron";

/**
 * `window.oncallDesktop`: how OnCall's pages know they run in the app, and
 * tell it about calls (the web app's `src/lib/desktop.ts`).
 *
 * The main process decides whether this page gets it: only OnCall's own
 * origin does, not the onsell.ro sign-in or anything else the window shows.
 * It is asked once per page load, synchronously, so the bridge is there
 * before the page's scripts run.
 */
const hello = ipcRenderer.sendSync("oncall:hello") as { version: string; platform: string } | null;

if (hello) {
  contextBridge.exposeInMainWorld(
    "oncallDesktop",
    Object.freeze({
      version: hello.version,
      platform: hello.platform,
      /** An incoming call is ringing (who, as the phone panel shows it), or stopped ringing (null). */
      ringing(label: string | null): void {
        ipcRenderer.send("oncall:ringing", typeof label === "string" ? label : null);
      },
      /** A call is up on this phone (true) or there is none (false). */
      callActive(active: boolean): void {
        ipcRenderer.send("oncall:call", active === true);
      },
    }),
  );
}
