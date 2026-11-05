import path from "node:path";

import { app, Menu, nativeImage, Tray } from "electron";

import type { CallSignals } from "./calls";

const STATIC = path.join(__dirname, "..", "..", "static");

/**
 * The menu bar (macOS) or notification area (Windows) icon: the way back to a
 * closed window, and the way to quit for real, since closing the window
 * leaves OnCall running.
 */
export function installTray(actions: { show(): void; checkForUpdates(): void; calls: CallSignals }): Tray {
  const mac = process.platform === "darwin";
  // macOS: a template image, which the menu bar tints for light and dark. Windows: the coloured mark.
  const image = nativeImage.createFromPath(path.join(STATIC, mac ? "trayTemplate.png" : "tray.png"));
  if (mac) image.setTemplateImage(true);
  const tray = new Tray(image);

  const refresh = () => {
    const status = actions.calls.inCall ? "În apel" : "Fără apel în curs";
    tray.setToolTip(`OnCall · ${status}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Deschide OnCall", click: actions.show },
        { label: status, enabled: false },
        { type: "separator" },
        { label: `Versiunea ${app.getVersion()}`, enabled: false },
        { label: "Caută actualizări…", click: actions.checkForUpdates },
        { type: "separator" },
        { label: "Ieși din OnCall", click: () => app.quit() },
      ]),
    );
  };
  refresh();
  actions.calls.onChange(refresh);

  // On Windows a click on the icon opens the window; the menu is on the right click.
  if (!mac) tray.on("click", actions.show);
  return tray;
}
