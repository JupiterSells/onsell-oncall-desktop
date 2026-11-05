import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { app, net } from "electron";
import type { UpdateInfo } from "electron-updater";

import { RELEASES } from "./policy";

const run = promisify(execFile);

/**
 * Updates for a macOS build without a Developer ID.
 *
 * Squirrel.Mac, which electron-updater uses on macOS, installs only an update
 * signed by the same Developer ID as the running app, so an ad-hoc signed
 * build cannot use it. This does the same job by hand:
 *
 * 1. download the release's `OnCall-mac.zip` and check its SHA-512 against
 *    the release's `latest-mac.yml` (both over HTTPS from GitHub);
 * 2. unpack it with `ditto` and check the bundle's signature is intact;
 * 3. when the app quits (or «Repornește acum»), a small script waits for it
 *    to exit, swaps the bundle in place (the old one is put back if the copy
 *    fails) and, for a restart, opens the new one.
 *
 * The app must be somewhere it can write: Applications for an admin account
 * (the usual Mac), not the DMG or a read-only translocated copy.
 * `installable()` says so before anything is downloaded.
 */

/** The running app's bundle: …/OnCall.app. */
function currentBundle(): string | null {
  const bundle = path.resolve(app.getPath("exe"), "..", "..", "..");
  return bundle.endsWith(".app") ? bundle : null;
}

/** Null if the bundle can be replaced; otherwise why not, in Romanian, for the dialog. */
export function installable(): string | null {
  const bundle = currentBundle();
  if (!bundle) return "Aplicația nu rulează dintr-un pachet OnCall.app.";
  if (bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) {
    return "OnCall rulează direct din imaginea descărcată. Mut-o în Applications ca să se poată actualiza singură.";
  }
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return null;
  } catch {
    return "Contul tău nu poate scrie în dosarul aplicației. Cere unui administrator al calculatorului să instaleze versiunea nouă.";
  }
}

/** Downloads, checks and unpacks the version; resolves with the new OnCall.app, ready to install. */
export async function downloadMacUpdate(info: UpdateInfo): Promise<string> {
  const file = info.files.find((f) => f.url.endsWith(".zip"));
  if (!file?.sha512) throw new Error(`release ${info.version} has no macOS zip in latest-mac.yml`);
  const name = path.basename(file.url);
  const url = `https://github.com/${RELEASES.owner}/${RELEASES.repo}/releases/download/v${info.version}/${encodeURIComponent(name)}`;

  const dir = path.join(app.getPath("temp"), `oncall-update-${info.version}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, name);

  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${url}: HTTP ${res.status}`);
  const hash = createHash("sha512");
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => hash.update(chunk));
  await pipeline(body, fs.createWriteStream(zip));
  if (hash.digest("base64") !== file.sha512) throw new Error(`download ${name}: checksum does not match the release`);

  const unpacked = path.join(dir, "app");
  await run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
  fs.rmSync(zip, { force: true });
  const bundle = path.join(unpacked, "OnCall.app");
  if (!fs.existsSync(bundle)) throw new Error(`download ${name}: no OnCall.app inside`);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  return bundle;
}

/**
 * Hands the swap to a script that outlives the app, then the caller quits.
 * `relaunch`: open the new version once it is in place («Repornește acum»);
 * otherwise it is simply there next time (an ordinary quit).
 */
export function installMacUpdate(newBundle: string, relaunch: boolean): void {
  const current = currentBundle();
  if (!current) return;
  const script = [
    'while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.2; done',
    'rm -rf "$CURRENT.previous"',
    'if mv "$CURRENT" "$CURRENT.previous" && /usr/bin/ditto "$NEW" "$CURRENT"; then',
    '  rm -rf "$CURRENT.previous" "$(dirname "$NEW")"',
    "else",
    '  rm -rf "$CURRENT"; mv "$CURRENT.previous" "$CURRENT"',
    "fi",
    '/usr/bin/xattr -dr com.apple.quarantine "$CURRENT" 2>/dev/null',
    'if [ "$RELAUNCH" = 1 ]; then /usr/bin/open "$CURRENT"; fi',
  ].join("\n");
  spawn("/bin/sh", ["-c", script], {
    detached: true,
    stdio: "ignore",
    env: { PATH: "/usr/bin:/bin", OLD_PID: String(process.pid), CURRENT: current, NEW: newBundle, RELAUNCH: relaunch ? "1" : "0" },
  }).unref();
}
