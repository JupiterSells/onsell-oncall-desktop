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

Until 20 Nov 2026 the tag started `.github/workflows/release.yml` on GitHub's macOS and Windows runners. The org's Actions jobs are refused (billing), so that workflow and `ci.yml` were removed (both are in git history: `f=.github/workflows/release.yml; git show "$(git log --diff-filter=D -1 --format=%h -- $f)^:$f"`). **Pushing the tag no longer builds anything.** Until a new build route exists, a release is made by hand:

1. On the tagged commit: `npm ci && npx tsc --noEmit -p tsconfig.json && npx vitest run`, and check the tag is the package's version (`v$(node -p 'require("./package.json").version')`).
2. On a Mac: `npm run dist:mac` (universal DMG + zip, ad-hoc signed). Windows: `npm run dist:win`, on a Windows machine (on a Mac, electron-builder's NSIS build may need Wine).
3. Create the GitHub release of the tag (title `OnCall <version>`) and attach **every** file from `release/` that both builds made: the DMG, the mac zip, the NSIS `.exe`, `latest-mac.yml`, `latest.yml` and the `.blockmap` files. The installed apps update from the two `latest*.yml` files.
4. Publish it (not a draft) and mark it latest: the download page (call.onsell.ro/aplicatie) links to `/releases/latest`.

Installed apps see a published release within four hours, or at once from «Caută actualizări…».

## Signing

The builds are **not signed yet**. Until they are:

- **macOS**: the first open is refused by Gatekeeper. Right-click the app in Applications → Open, or System Settings → Privacy & Security → «Open Anyway». After that it updates itself (mac-update.ts) as long as it runs from a folder the account can write (Applications on an admin account); otherwise it says why and opens the download page. macOS may ask for the microphone again after an update, since an ad-hoc signature changes with every build.
- **Windows**: SmartScreen says «Windows protected your PC» → More info → Run anyway. Updates install themselves.

Signing, by hand: for macOS set `CSC_LINK` / `CSC_KEY_PASSWORD` (a Developer ID Application .p12) and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and build with `npm run build && npx electron-builder --mac -c.mac.notarize=true -c.extraMetadata.oncallSignedMac=true --publish never` (not `dist:mac`, which forces an ad-hoc identity). For Windows set `CSC_LINK` / `CSC_KEY_PASSWORD` to the .pfx before `npm run dist:win`. Signed Macs update themselves. (The Actions secrets of the same names were used only by the removed workflow.)
