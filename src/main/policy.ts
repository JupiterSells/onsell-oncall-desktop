/**
 * The app's rules, without Electron: what may load in its window, where a
 * saved window goes back to, how an update is installed. Kept apart so the
 * rules have tests (policy.test.ts) and main.ts only wires them up.
 */

/** Packaged builds always open this. `ONCALL_URL` is for a developer's `npm start` against `next dev`. */
export const DEFAULT_APP_URL = "https://call.onsell.ro";

/** The public repo whose releases hold the installers and the update feed. */
export const RELEASES = { owner: "JupiterSells", repo: "onsell-oncall-desktop" } as const;

/**
 * Where a URL may go.
 *
 * - `app`: OnCall itself (the configured origin), in the app's window.
 * - `sign-in`: onsell.ro and its subdomains, and Google's sign-in (onsell.ro
 *   offers «Continuă cu Google»). The way in passes through onsell.ro's entry
 *   for OnCall and back to `/auth/callback`, so it has to happen in the
 *   app's window, where the session cookie is set.
 * - `external`: any other web or mail link, in the default browser.
 * - `blocked`: everything else. `tel:` is here on purpose: a phone number
 *   handed to the system dialler would be a call OnCall does not record.
 */
export type Destination = "app" | "sign-in" | "external" | "blocked";

const SIGN_IN_HOSTS = [/^(.+\.)?onsell\.ro$/, /^accounts\.google\.com$/, /^accounts\.google\.ro$/];

export function classify(url: string, appOrigin: string): Destination {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "blocked";
  }
  if (parsed.origin === appOrigin) return "app";
  if (parsed.protocol === "https:" && SIGN_IN_HOSTS.some((host) => host.test(parsed.hostname))) return "sign-in";
  if (parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:") return "external";
  return "blocked";
}

/** The origin of the configured app URL; throws on one that is not http(s), so a typo fails at start and not on the first link. */
export function appOriginOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`ONCALL_URL must be http(s): ${url}`);
  return parsed.origin;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1440, height: 900 } as const;
export const MIN_SIZE = { width: 1024, height: 640 } as const;

/**
 * The saved window back where it was, if a display still shows enough of it
 * (a monitor unplugged since is the usual case); otherwise null and the
 * window opens centred at its default size.
 */
export function restoreBounds(saved: unknown, workAreas: Rect[]): WindowState | null {
  if (!saved || typeof saved !== "object") return null;
  const raw = saved as { bounds?: Partial<Rect>; maximized?: unknown };
  const b = raw.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const bounds = {
    x: Math.round(b.x!),
    y: Math.round(b.y!),
    width: Math.max(MIN_SIZE.width, Math.round(b.width!)),
    height: Math.max(MIN_SIZE.height, Math.round(b.height!)),
  };
  // At least the title bar's worth (200×50 px) on some display, so the window can be grabbed and moved.
  const visible = workAreas.some((area) => {
    const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const h = Math.min(bounds.y + 50, area.y + area.height) - Math.max(bounds.y, area.y);
    return w >= 200 && h >= 50;
  });
  return visible ? { bounds, maximized: raw.maximized === true } : null;
}

/**
 * How a new version arrives.
 *
 * - `install`: downloaded in the background, installed on restart (Windows;
 *   macOS once the build is signed with a Developer ID, which Squirrel.Mac
 *   requires).
 * - `notify`: the app says a version is out and opens OnCall's download page
 *   (an unsigned macOS build cannot replace itself).
 */
export type UpdateMode = "install" | "notify";

export function updateMode(platform: NodeJS.Platform, signedMac: boolean): UpdateMode {
  if (platform === "darwin") return signedMac ? "install" : "notify";
  return "install";
}

/** The caller shown in the incoming-call notification: one line, no control characters, bounded. */
export function ringLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean ? clean.slice(0, 120) : null;
}
