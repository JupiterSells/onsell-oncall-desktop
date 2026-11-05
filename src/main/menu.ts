import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

import type { CallSignals } from "./calls";

export interface MenuActions {
  window(): BrowserWindow | null;
  calls: CallSignals;
  home: string;
  downloadPage: string;
  checkForUpdates(): void;
}

/**
 * The menu bar (macOS) and the Alt menu (Windows), in Romanian like the app.
 * A browser has back, reload and zoom; so does this. Reloading ends a call,
 * so in a call it asks first.
 */
export function installMenu(actions: MenuActions): void {
  const mac = process.platform === "darwin";
  const contents = () => actions.window()?.webContents ?? null;

  const reload = async (hard: boolean) => {
    const win = actions.window();
    if (!win) return;
    if (actions.calls.inCall) {
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        message: "Ești într-un apel.",
        detail: "Reîncărcarea paginii închide apelul.",
        buttons: ["Reîncarcă oricum", "Rămân în apel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response !== 0) return;
    }
    if (hard) win.webContents.reloadIgnoringCache();
    else win.webContents.reload();
  };

  const about = () =>
    void dialog.showMessageBox({
      message: "OnCall",
      detail: `Versiunea ${app.getVersion()}\nAplicația de call center OnSell (call.onsell.ro).`,
    });

  const appItems: MenuItemConstructorOptions[] = [
    { label: "Despre OnCall", click: about },
    { label: "Caută actualizări…", click: actions.checkForUpdates },
  ];

  const template: MenuItemConstructorOptions[] = [
    mac
      ? {
          label: "OnCall",
          submenu: [
            ...appItems,
            { type: "separator" },
            { role: "services", label: "Servicii" },
            { type: "separator" },
            { role: "hide", label: "Ascunde OnCall" },
            { role: "hideOthers", label: "Ascunde celelalte" },
            { role: "unhide", label: "Arată tot" },
            { type: "separator" },
            { role: "quit", label: "Ieși din OnCall" },
          ],
        }
      : { label: "OnCall", submenu: [...appItems, { type: "separator" }, { role: "quit", label: "Ieși din OnCall" }] },
    {
      label: "Editare",
      submenu: [
        { role: "undo", label: "Anulează" },
        { role: "redo", label: "Refă" },
        { type: "separator" },
        { role: "cut", label: "Taie" },
        { role: "copy", label: "Copiază" },
        { role: "paste", label: "Lipește" },
        { role: "selectAll", label: "Selectează tot" },
      ],
    },
    {
      label: "Navigare",
      submenu: [
        {
          label: "Înapoi",
          accelerator: mac ? "Cmd+[" : "Alt+Left",
          click: () => {
            const c = contents();
            if (c?.navigationHistory.canGoBack()) c.navigationHistory.goBack();
          },
        },
        {
          label: "Înainte",
          accelerator: mac ? "Cmd+]" : "Alt+Right",
          click: () => {
            const c = contents();
            if (c?.navigationHistory.canGoForward()) c.navigationHistory.goForward();
          },
        },
        { label: "Pagina principală", accelerator: mac ? "Cmd+Shift+H" : "Alt+Home", click: () => void contents()?.loadURL(actions.home) },
        { type: "separator" },
        { label: "Reîncarcă", accelerator: "CmdOrCtrl+R", click: () => void reload(false) },
        { label: "Reîncarcă tot", accelerator: "CmdOrCtrl+Shift+R", click: () => void reload(true) },
      ],
    },
    {
      label: "Vizualizare",
      submenu: [
        { role: "zoomIn", label: "Mărește" },
        { role: "zoomOut", label: "Micșorează" },
        { role: "resetZoom", label: "Mărime normală" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Ecran complet" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Instrumente pentru dezvoltatori" },
      ],
    },
    {
      label: "Fereastră",
      role: "windowMenu",
      submenu: [{ role: "minimize", label: "Minimizează" }, { role: "zoom", label: "Zoom" }, ...(mac ? [{ type: "separator" as const }, { role: "front" as const, label: "Adu tot în față" }] : [{ role: "close" as const, label: "Închide" }])],
    },
    {
      label: "Ajutor",
      role: "help",
      submenu: [
        { label: "Aplicația OnCall pentru computer", click: () => void contents()?.loadURL(actions.downloadPage) },
        ...(mac ? [] : [{ label: "Despre OnCall", click: about }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
