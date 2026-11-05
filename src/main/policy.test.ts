import { describe, expect, it } from "vitest";

import { appOriginOf, classify, restoreBounds, ringLabel, updateMode, widgetCall, widgetCommand, widgetPosition } from "./policy";

const ORIGIN = "https://call.onsell.ro";

describe("classify", () => {
  it("keeps OnCall in the app", () => {
    expect(classify("https://call.onsell.ro/pupitru", ORIGIN)).toBe("app");
    expect(classify("https://call.onsell.ro/auth/callback?ticket=x", ORIGIN)).toBe("app");
  });

  it("keeps the onsell.ro sign-in in the app, over https only", () => {
    expect(classify("https://onsell.ro/enter/call?continue=%2Ftura", ORIGIN)).toBe("sign-in");
    expect(classify("https://admin.onsell.ro/login", ORIGIN)).toBe("sign-in");
    expect(classify("http://onsell.ro/enter/call", ORIGIN)).toBe("external");
  });

  it("keeps Google's sign-in in the app, for «Continuă cu Google»", () => {
    expect(classify("https://accounts.google.com/o/oauth2/v2/auth?client_id=x", ORIGIN)).toBe("sign-in");
    expect(classify("https://accounts.google.com.evil.com/", ORIGIN)).toBe("external");
    expect(classify("https://www.google.com/search?q=x", ORIGIN)).toBe("external");
  });

  it("does not take a look-alike host for onsell.ro", () => {
    expect(classify("https://evilonsell.ro/enter", ORIGIN)).toBe("external");
    expect(classify("https://onsell.ro.evil.com/enter", ORIGIN)).toBe("external");
    expect(classify("https://call.onsell.ro.evil.com/", ORIGIN)).toBe("external");
  });

  it("sends other web and mail links to the browser", () => {
    expect(classify("https://casabuna.ro/produs/1", ORIGIN)).toBe("external");
    expect(classify("mailto:dev@onsell.ro", ORIGIN)).toBe("external");
  });

  it("blocks the system dialler, files and scripts", () => {
    expect(classify("tel:+40736462968", ORIGIN)).toBe("blocked");
    expect(classify("file:///etc/passwd", ORIGIN)).toBe("blocked");
    expect(classify("javascript:alert(1)", ORIGIN)).toBe("blocked");
    expect(classify("not a url", ORIGIN)).toBe("blocked");
  });

  it("treats a development origin as the app", () => {
    expect(classify("http://localhost:3200/tura", "http://localhost:3200")).toBe("app");
    expect(classify("http://localhost:4200/tura", "http://localhost:3200")).toBe("external");
  });
});

describe("appOriginOf", () => {
  it("takes the origin of an http(s) URL", () => {
    expect(appOriginOf("https://call.onsell.ro/tura")).toBe(ORIGIN);
  });

  it("refuses anything else", () => {
    expect(() => appOriginOf("file:///tmp/x")).toThrow();
    expect(() => appOriginOf("call.onsell.ro")).toThrow();
  });
});

describe("restoreBounds", () => {
  const laptop = { x: 0, y: 25, width: 1512, height: 920 };

  it("puts a window back where it was", () => {
    expect(restoreBounds({ bounds: { x: 40, y: 60, width: 1200, height: 800 }, maximized: true }, [laptop])).toEqual({
      bounds: { x: 40, y: 60, width: 1200, height: 800 },
      maximized: true,
    });
  });

  it("forgets a window left on a monitor that is gone", () => {
    expect(restoreBounds({ bounds: { x: 2000, y: 60, width: 1200, height: 800 } }, [laptop])).toBeNull();
  });

  it("forgets a window whose title bar is above every display", () => {
    expect(restoreBounds({ bounds: { x: 40, y: -400, width: 1200, height: 800 } }, [laptop])).toBeNull();
  });

  it("does not shrink below the minimum size", () => {
    expect(restoreBounds({ bounds: { x: 0, y: 30, width: 300, height: 200 } }, [laptop])?.bounds).toEqual({ x: 0, y: 30, width: 1024, height: 640 });
  });

  it("ignores a damaged file", () => {
    expect(restoreBounds(null, [laptop])).toBeNull();
    expect(restoreBounds({ bounds: { x: "a" } }, [laptop])).toBeNull();
    expect(restoreBounds({ bounds: { x: 0, y: 0, width: Infinity, height: 1 } }, [laptop])).toBeNull();
  });
});

describe("updateMode", () => {
  it("installs on Windows", () => {
    expect(updateMode("win32", false)).toBe("install");
  });

  it("installs on a signed Mac build and only notifies on an unsigned one", () => {
    expect(updateMode("darwin", true)).toBe("install");
    expect(updateMode("darwin", false)).toBe("notify");
  });
});

describe("ringLabel", () => {
  it("keeps one bounded line", () => {
    expect(ringLabel("Casa Bună · 0736 462 968")).toBe("Casa Bună · 0736 462 968");
    expect(ringLabel("a\nb\u0007c")).toBe("a b c");
    expect(ringLabel("x".repeat(500))).toHaveLength(120);
  });

  it("is null for nothing", () => {
    expect(ringLabel(null)).toBeNull();
    expect(ringLabel("  ")).toBeNull();
    expect(ringLabel(42)).toBeNull();
  });
});

describe("widgetPosition", () => {
  const laptop = { x: 0, y: 25, width: 1512, height: 920 };

  it("opens in the top right corner the first time", () => {
    expect(widgetPosition(null, [laptop], laptop)).toEqual({ x: 1512 - 340 - 16, y: 41 });
  });

  it("goes back where it was dragged, if it still fits on a display", () => {
    expect(widgetPosition({ x: 20, y: 700 }, [laptop], laptop)).toEqual({ x: 20, y: 700 });
    expect(widgetPosition({ x: 1400, y: 700 }, [laptop], laptop)).toEqual({ x: 1156, y: 41 });
    expect(widgetPosition({ x: "a" }, [laptop], laptop)).toEqual({ x: 1156, y: 41 });
  });
});

describe("widgetCall", () => {
  const call = { phase: "in_call", title: "Casa Bună", number: "0736 462 968", detail: null, answeredAt: 5, muted: true, held: false };

  it("passes a call through", () => {
    expect(widgetCall(call)).toEqual(call);
  });

  it("keeps only what the widget shows, bounded", () => {
    expect(widgetCall({ ...call, title: "x".repeat(300), extra: "<script>", muted: "yes" })).toEqual({ ...call, title: "x".repeat(120), muted: false });
  });

  it("refuses an unknown phase or anything that is not a call", () => {
    expect(widgetCall({ ...call, phase: "hacked" })).toBeNull();
    expect(widgetCall(null)).toBeNull();
    expect(widgetCall("in_call")).toBeNull();
  });
});

describe("widgetCommand", () => {
  it("knows the widget's buttons only", () => {
    expect(widgetCommand("answer")).toBe("answer");
    expect(widgetCommand("open")).toBe("open");
    expect(widgetCommand("dial")).toBeNull();
    expect(widgetCommand(undefined)).toBeNull();
  });
});
