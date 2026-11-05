import { dialog, shell, systemPreferences, type Session } from "electron";

import { classify } from "./policy";

/**
 * What OnCall's pages may use, and nothing else: the microphone (audio only,
 * for the softphone), notifications, writing to the clipboard and full
 * screen. Everything else (camera, screen capture, location, USB…) is
 * refused, and so is every request from a page that is not OnCall's.
 */
const ALLOWED = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen"]);

const MIC_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

export function installPermissions(session: Session, appOrigin: string): void {
  const trusted = (url: string | undefined) => Boolean(url) && classify(url!, appOrigin) === "app";

  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (!trusted(details.requestingUrl) || !ALLOWED.has(permission)) return callback(false);
    if (permission !== "media") return callback(true);
    const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    if (types.some((type) => type !== "audio")) return callback(false);
    void microphoneAllowedBySystem().then(callback);
  });

  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (!trusted(requestingOrigin) || !ALLOWED.has(permission)) return false;
    if (permission !== "media") return true;
    if (details.mediaType === "video") return false;
    // What the softphone shows as the microphone's state: refused by macOS is refused.
    return process.platform !== "darwin" || systemPreferences.getMediaAccessStatus("microphone") !== "denied";
  });
}

let explained = false;

/**
 * macOS asks the person once per app; Windows has no per-app prompt the app
 * can raise. A refusal on macOS can only be undone in System Settings, so the
 * first refused call says where.
 */
async function microphoneAllowedBySystem(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "granted") return true;
  if (status === "not-determined") return systemPreferences.askForMediaAccess("microphone");
  if (!explained) {
    explained = true;
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: "OnCall nu are acces la microfon",
      detail: "Fără microfon nu poți vorbi în apeluri. Permite-l în Setări sistem → Confidențialitate și securitate → Microfon, apoi repornește OnCall.",
      buttons: ["Deschide Setări sistem", "Închide"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void shell.openExternal(MIC_SETTINGS);
  }
  return false;
}
