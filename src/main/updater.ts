import fs from "node:fs";
import path from "node:path";

import { app, dialog, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

import type { CallSignals } from "./calls";
import { downloadMacUpdate, installable, installMacUpdate } from "./mac-update";
import { updateMode } from "./policy";

const EVERY_4_HOURS = 4 * 60 * 60 * 1000;

/**
 * New versions from the GitHub releases of JupiterSells/onsell-oncall-desktop
 * (the feed electron-builder writes into the app as `app-update.yml`),
 * checked at start and every four hours.
 *
 * Every version downloads in the background and installs on the next quit,
 * or at once from «Repornește acum»; never in the middle of a call, which a
 * restart would end. Windows (and a signed Mac) use electron-updater's
 * installer; an unsigned Mac replaces its own bundle (mac-update.ts). A Mac
 * app that cannot write where it lives (the DMG, a non-admin account) says
 * why and opens OnCall's download page instead.
 */
export class Updates {
  private readonly mode = updateMode(process.platform, signedMac());
  private announced = new Set<string>();
  private waitingForCallEnd: (() => void) | null = null;
  /** Unsigned Mac: the version downloaded and unpacked, waiting for a quit or a restart. */
  private macReady: { version: string; bundle: string } | null = null;
  private macDownloading: string | null = null;

  constructor(
    private readonly options: {
      calls: CallSignals;
      downloadPage: string;
      /** Lets the window close for real before the installer runs. */
      beforeInstall(): void;
    },
  ) {}

  start(): void {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = this.mode === "install";
    autoUpdater.autoInstallOnAppQuit = this.mode === "install";
    autoUpdater.on("update-available", (info) => {
      if (this.mode === "replace") void this.downloadForMac(info);
    });
    autoUpdater.on("update-downloaded", (info) => this.offerRestart(info));
    autoUpdater.on("error", (error) => console.error("[updates]", error.message));
    // An ordinary quit installs what is waiting, as Windows does; the new version is there next time.
    app.on("will-quit", () => {
      const ready = this.macReady;
      this.macReady = null;
      if (ready) installMacUpdate(ready.bundle, false);
    });
    setTimeout(() => void this.check(false), 10_000);
    setInterval(() => void this.check(false), EVERY_4_HOURS);
  }

  /** From the menu: says what it found, including that there is nothing new. */
  async check(manual: boolean): Promise<void> {
    if (!app.isPackaged) {
      if (manual) void dialog.showMessageBox({ message: "Actualizările vin doar în aplicația instalată.", detail: "Aceasta rulează din cod (npm start)." });
      return;
    }
    if (manual) this.announced.clear();
    try {
      const result = await autoUpdater.checkForUpdates();
      if (manual && !result?.isUpdateAvailable) {
        void dialog.showMessageBox({ message: "OnCall este la zi.", detail: `Versiunea ${app.getVersion()} este cea mai nouă.` });
      } else if (manual && this.mode === "replace" && this.macReady && result?.updateInfo.version === this.macReady.version) {
        this.offerRestart(result.updateInfo);
      }
    } catch (error) {
      console.error("[updates]", error);
      if (manual) void dialog.showMessageBox({ type: "warning", message: "Nu am putut verifica actualizările.", detail: "Verifică conexiunea și încearcă din nou." });
    }
  }

  private async downloadForMac(info: UpdateInfo): Promise<void> {
    if (this.macReady?.version === info.version || this.macDownloading === info.version) return;
    const refusal = installable();
    if (refusal) return void this.offerDownloadPage(info, refusal);
    this.macDownloading = info.version;
    try {
      this.macReady = { version: info.version, bundle: await downloadMacUpdate(info) };
      this.offerRestart(info);
    } catch (error) {
      console.error("[updates]", error);
    } finally {
      this.macDownloading = null;
    }
  }

  private async offerDownloadPage(info: UpdateInfo, why: string): Promise<void> {
    if (this.announced.has(info.version)) return;
    this.announced.add(info.version);
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `Este disponibilă versiunea ${info.version} a aplicației OnCall.`,
      detail: `Ai versiunea ${app.getVersion()}. ${why}`,
      buttons: ["Descarcă", "Mai târziu"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void shell.openExternal(this.options.downloadPage);
  }

  private offerRestart(info: UpdateInfo): void {
    if (this.options.calls.inCall) {
      // After the call: asking now would put a dialog over the order the operator is talking about.
      if (this.waitingForCallEnd) return;
      const stop = this.options.calls.onChange(() => {
        if (this.options.calls.inCall) return;
        stop();
        this.waitingForCallEnd = null;
        this.offerRestart(info);
      });
      this.waitingForCallEnd = stop;
      return;
    }
    if (this.announced.has(info.version)) return;
    this.announced.add(info.version);
    void dialog
      .showMessageBox({
        type: "info",
        message: `Versiunea ${info.version} a aplicației OnCall este gata.`,
        detail: "Se instalează la repornire. Repornește acum sau la următoarea pornire a aplicației.",
        buttons: ["Repornește acum", "Mai târziu"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response !== 0 || this.options.calls.inCall) return;
        this.options.beforeInstall();
        if (this.mode === "install") return autoUpdater.quitAndInstall();
        const ready = this.macReady;
        this.macReady = null;
        if (!ready) return;
        installMacUpdate(ready.bundle, true);
        app.quit();
      });
  }
}

/**
 * Whether this macOS build was signed with a Developer ID. The release
 * workflow sets `oncallSignedMac` in the packaged package.json only when it
 * had the certificate (see .github/workflows/release.yml).
 */
function signedMac(): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { oncallSignedMac?: unknown };
    return pkg.oncallSignedMac === true;
  } catch {
    return false;
  }
}
