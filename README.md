# OnCall for Windows and macOS

OnSell's call-center app, [call.onsell.ro](https://call.onsell.ro), in its own window.

Every screen, role and rule is the web app's (`JupiterSells/onsell-oncall-web`), loaded live from call.onsell.ro, so the app is never a version behind a deploy and holds none of OnCall's logic or data. What it adds is what a browser tab does badly for an operator:

| | Browser tab | App |
|---|---|---|
| Incoming call while minimised or behind another app | tone + blinking tab title | the call widget over other apps with «Răspunde», taskbar flash / Dock bounce, notification with the caller |
| A call while OnCall is not in front | — | the call widget: caller, shop, timer, mute, hold, hang up, back to the Pupitru; a result still owed stays on it |
| Ring before anyone clicked the page | may be silent | always heard |
| Softphone in a background tab | throttled | runs at full speed |
| Computer during a call | may sleep | kept awake until the call ends |
| Quit or reload during a call | ends it | asks first |
| Closing the window | signs the phone off | keeps OnCall in the tray / Dock; a call brings it back |
| Updates | — | from this repo's releases |

## Download

From OnCall: **call.onsell.ro/aplicatie** (also linked from the sign-in page and the sidebar). The files are always this repo's latest release:

- Windows: `OnCall-Setup.exe`
- macOS (Apple silicon and Intel): `OnCall-mac.dmg`

## How it works

- `src/main/main.ts`: start-up, single instance, the IPC from the page, quit rules.
- `src/main/policy.ts`: the rules, with tests. Which URLs stay in the app (OnCall, the onsell.ro and Google sign-in), which go to the browser, which go nowhere (`tel:`, so no call leaves OnCall unrecorded); window restore; how updates arrive.
- `src/main/window.ts`: the window, its security settings (sandboxed, isolated, no Node in the page), the link rules, the context menu, the offline page.
- `src/main/permissions.ts`: OnCall's pages get the microphone (audio only), notifications, clipboard write and full screen; everything else and everyone else is refused.
- `src/main/calls.ts`: what happens when a call rings or is up.
- `src/main/widget.ts`: the call widget, a small always-on-top window showing the web app's `/widget/apel` while OnCall's window is not focused. The call comes from the Pupitru's softphone (`callUpdate`), the buttons go back to it (`command` → `onCommand`); the widget has no phone of its own.
- `src/preload/preload.ts`: `window.oncallDesktop` (`version`, `platform`, `ringing(label|null)`, `callActive(bool)`; from 1.1 `callUpdate`, `onCommand`, `onCallUpdate`, `command` for the widget), given only to OnCall's own pages, and each message accepted only from the window it belongs to. The web app uses it from `src/lib/desktop.ts` and `src/softphone/desktop-bridge.tsx`.
- `src/main/updater.ts`: updates from this repo's GitHub releases: downloaded in the background, installed on quit or «Repornește acum», never during a call.
- `src/main/mac-update.ts`: the unsigned Mac's own updater (Squirrel.Mac installs only Developer ID-signed updates): the release zip, checked against the SHA-512 in `latest-mac.yml`, swapped into place by a script once the app exits.

## Develop

```sh
npm ci
npm start                              # against call.onsell.ro
ONCALL_URL=http://localhost:3200 npm start   # against `next dev` in onsell-oncall-web
npm test && npm run typecheck
npm run dist:mac                       # local, unsigned, into release/
```

`ONCALL_URL` is ignored by packaged builds; a run with it keeps its own profile (`OnCall-dev`), apart from the installed app's sign-in. Started from VS Code's terminal, unset `ELECTRON_RUN_AS_NODE` first (`env -u ELECTRON_RUN_AS_NODE npm start`), or Electron runs as plain Node.

Icons are drawn from the OnCall mark by `npm run icons` (writes `build/icon.png` and `static/*.png`; commit them).

## Release

```sh
npm version patch      # or minor / major
git push --follow-tags
```

The tag starts `.github/workflows/release.yml`: tests, a draft release, the macOS (universal DMG + zip) and Windows (NSIS) builds uploaded to it, then the release is published. Installed apps see it within four hours, or at once from «Caută actualizări…».

## Signing

The builds are **not signed yet**. Until they are:

- **macOS**: the first open is refused by Gatekeeper. Right-click the app in Applications → Open, or System Settings → Privacy & Security → «Open Anyway». After that it updates itself (mac-update.ts) as long as it runs from a folder the account can write (Applications on an admin account); otherwise it says why and opens the download page. macOS may ask for the microphone again after an update, since an ad-hoc signature changes with every build.
- **Windows**: SmartScreen says «Windows protected your PC» → More info → Run anyway. Updates install themselves.

Signing turns on by adding the repo secrets listed at the top of `release.yml` (an Apple Developer ID Application certificate plus notarisation credentials; a Windows code-signing certificate). Nothing else changes: the next tag is signed, and signed Macs update themselves.
