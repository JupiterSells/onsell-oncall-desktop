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
 * How a new version arrives. Either way it is downloaded in the background
 * and installed on the next restart, or at once if the person says so.
 *
 * - `install`: electron-updater's own (Windows; macOS once the build is
 *   signed with a Developer ID, which Squirrel.Mac requires).
 * - `replace`: an unsigned macOS build swaps its own bundle (mac-update.ts).
 */
export type UpdateMode = "install" | "replace";

export function updateMode(platform: NodeJS.Platform, signedMac: boolean): UpdateMode {
  if (platform === "darwin" && !signedMac) return "replace";
  return "install";
}

/** The caller shown in the incoming-call notification: one line, no control characters, bounded. */
export function ringLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean ? clean.slice(0, 120) : null;
}

/** The call widget's window (widget.ts): small enough to sit in a corner over other work. */
export const WIDGET_SIZE = { width: 340, height: 148 } as const;

/**
 * Where the widget opens: where the operator last dragged it, if a display
 * still holds all of it; otherwise the top right corner of the primary
 * display, under the menu bar.
 */
export function widgetPosition(saved: unknown, workAreas: Rect[], primary: Rect): { x: number; y: number } {
  const corner = { x: primary.x + primary.width - WIDGET_SIZE.width - 16, y: primary.y + 16 };
  if (!saved || typeof saved !== "object") return corner;
  const { x, y } = saved as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return corner;
  const fits = workAreas.some(
    (a) => x >= a.x && y >= a.y && x + WIDGET_SIZE.width <= a.x + a.width && y + WIDGET_SIZE.height <= a.y + a.height,
  );
  return fits ? { x: Math.round(x), y: Math.round(y) } : corner;
}

/** What the call widget shows; the web app's `WidgetCall` (src/lib/desktop.ts in onsell-oncall-web). */
export interface WidgetCall {
  phase: "incoming" | "dialing" | "ringing" | "in_call" | "ended" | "wrap";
  title: string;
  number: string | null;
  detail: string | null;
  answeredAt: number | null;
  muted: boolean;
  held: boolean;
}

const PHASES = new Set<WidgetCall["phase"]>(["incoming", "dialing", "ringing", "in_call", "ended", "wrap"]);

/** The page's call as the widget may get it: known phases, bounded one-line texts, nothing else carried over. Null for anything else. */
export function widgetCall(value: unknown): WidgetCall | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.phase !== "string" || !PHASES.has(v.phase as WidgetCall["phase"])) return null;
  const text = (s: unknown) => ringLabel(s);
  return {
    phase: v.phase as WidgetCall["phase"],
    title: text(v.title) ?? "Apel",
    number: text(v.number),
    detail: text(v.detail),
    answeredAt: typeof v.answeredAt === "number" && Number.isFinite(v.answeredAt) ? v.answeredAt : null,
    muted: v.muted === true,
    held: v.held === true,
  };
}

/** The widget's buttons, as the web app's softphone takes them. */
export type WidgetCommand = "answer" | "hangup" | "mute" | "hold" | "open";

export function widgetCommand(value: unknown): WidgetCommand | null {
  return value === "answer" || value === "hangup" || value === "mute" || value === "hold" || value === "open" ? value : null;
}
