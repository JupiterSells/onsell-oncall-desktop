import { describe, expect, it } from "vitest";

import { alive, appOriginOf, classify, messageLabel, inFront, quitStep, restoreBounds, ringLabel, threadIdOf, updateMode, widgetCall, widgetCommand, widgetMove, widgetPosition } from "./policy";

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

  it("installs on a signed Mac build and replaces its own bundle on an unsigned one", () => {
    expect(updateMode("darwin", true)).toBe("install");
    expect(updateMode("darwin", false)).toBe("replace");
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

describe("chat notification", () => {
  it("a chat notification carries only a clean «Mesaj de la …» and a thread id", () => {
    // Clean.
    expect(messageLabel("Mesaj de la Ana Popescu")).toBe("Mesaj de la Ana Popescu");
    expect(messageLabel("  Mesaj de la Ana  ")).toBe("Mesaj de la Ana");
    // Control characters become spaces.
    expect(messageLabel("Mesaj de la Ana\nPopescu\u0007")).toBe("Mesaj de la Ana Popescu");
    // Too long: cut at 80.
    const long = messageLabel(`Mesaj de la ${"x".repeat(500)}`);
    expect(long).toHaveLength(80);
    expect(long?.startsWith("Mesaj de la x")).toBe(true);
    // Wrong prefix, or the prefix with no name.
    expect(messageLabel("Apel primit")).toBeNull();
    expect(messageLabel("mesaj de la Ana")).toBeNull();
    expect(messageLabel("Ana: Mesaj de la Ana")).toBeNull();
    expect(messageLabel("Mesaj de la ")).toBeNull();
    // Not a string.
    expect(messageLabel(null)).toBeNull();
    expect(messageLabel(42)).toBeNull();
    expect(messageLabel({ toString: () => "Mesaj de la Ana" })).toBeNull();

    // A ULID, as the gateway makes thread ids.
    expect(threadIdOf("01JCDX9Z8K3M4N5P6Q7R8S9T0V")).toBe("01JCDX9Z8K3M4N5P6Q7R8S9T0V");
    // Bad id: wrong length, lower case, letters outside Crockford base32, a Mongo ObjectId, a UUID, a path, not a string.
    expect(threadIdOf("01JCDX9Z8K3M4N5P6Q7R8S9T0")).toBeNull();
    expect(threadIdOf("01jcdx9z8k3m4n5p6q7r8s9t0v")).toBeNull();
    expect(threadIdOf("01JCDX9Z8K3M4N5P6Q7R8S9TOU")).toBeNull();
    expect(threadIdOf("507f1f77bcf86cd799439011")).toBeNull();
    expect(threadIdOf("123e4567-e89b-12d3-a456-426614174000")).toBeNull();
    expect(threadIdOf("../01JCDX9Z8K3M4N5P6Q7R8S9T0V")).toBeNull();
    expect(threadIdOf(undefined)).toBeNull();
    expect(threadIdOf(12345)).toBeNull();
  });
});

/** A window like Electron's: once destroyed, everything but isDestroyed() throws. */
function win(state: { destroyed?: boolean; visible?: boolean; minimized?: boolean; focused?: boolean } = {}) {
  const { destroyed = false, visible = true, minimized = false, focused = true } = state;
  const live = <T>(value: T) => () => {
    if (destroyed) throw new TypeError("Object has been destroyed");
    return value;
  };
  return { isDestroyed: () => destroyed, isVisible: live(visible), isMinimized: live(minimized), isFocused: live(focused) };
}

describe("alive and inFront", () => {
  it("a destroyed window counts as gone, without being touched", () => {
    expect(alive(win({ destroyed: true }))).toBeNull();
  });

  it("a window that exists is returned as it is, and nothing is returned for none", () => {
    const open = win();
    expect(alive(open)).toBe(open);
    expect(alive(null)).toBeNull();
    expect(alive(undefined)).toBeNull();
  });

  it("a destroyed main window is not in front", () => {
    expect(inFront(win({ destroyed: true }))).toBe(false);
    expect(inFront(null)).toBe(false);
  });

  it("the main window is in front only when visible, not minimised and focused", () => {
    expect(inFront(win())).toBe(true);
    expect(inFront(win({ visible: false }))).toBe(false);
    expect(inFront(win({ minimized: true }))).toBe(false);
    expect(inFront(win({ focused: false }))).toBe(false);
  });
});

describe("widgetMove", () => {
  it("the widget never opens while the app quits, even for the call that just ended", () => {
    expect(widgetMove({ call: true, quitting: true, main: null, widget: null })).toBe("none");
    expect(widgetMove({ call: true, quitting: true, main: win({ focused: false }), widget: win({ destroyed: true }) })).toBe("none");
  });

  it("a widget still visible when the quit begins is hidden", () => {
    expect(widgetMove({ call: true, quitting: true, main: null, widget: win({ visible: true }) })).toBe("hide");
  });

  it("a call shows the widget while the main window is gone", () => {
    expect(widgetMove({ call: true, quitting: false, main: null, widget: null })).toBe("show");
    expect(widgetMove({ call: true, quitting: false, main: win({ destroyed: true }), widget: null })).toBe("show");
  });

  it("a call shows the widget while the main window is behind", () => {
    expect(widgetMove({ call: true, quitting: false, main: win({ focused: false }), widget: null })).toBe("show");
    expect(widgetMove({ call: true, quitting: false, main: win({ minimized: true }), widget: win({ visible: false }) })).toBe("show");
  });

  it("a widget already showing is left alone while the main window stays behind", () => {
    expect(widgetMove({ call: true, quitting: false, main: win({ focused: false }), widget: win({ visible: true }) })).toBe("none");
  });

  it("the widget hides when the main window is in front", () => {
    expect(widgetMove({ call: true, quitting: false, main: win(), widget: win({ visible: true }) })).toBe("hide");
  });

  it("with no call the widget hides if it is showing, and nothing happens if there is none", () => {
    expect(widgetMove({ call: false, quitting: false, main: null, widget: win({ visible: true }) })).toBe("hide");
    expect(widgetMove({ call: false, quitting: false, main: null, widget: null })).toBe("none");
    expect(widgetMove({ call: false, quitting: false, main: null, widget: win({ visible: false }) })).toBe("none");
  });
});

describe("quitStep", () => {
  it("a quit during a call asks first", () => {
    expect(quitStep({ quitting: false, asking: false, inCall: true, request: "electron" })).toBe("ask");
    expect(quitStep({ quitting: false, asking: false, inCall: true, request: "ours" })).toBe("ask");
  });

  it("a second quit while the question is open opens no second dialog", () => {
    expect(quitStep({ quitting: false, asking: true, inCall: true, request: "ours" })).toBe("wait");
    expect(quitStep({ quitting: false, asking: true, inCall: true, request: "electron" })).toBe("wait");
  });

  it("a quit with no call goes ahead", () => {
    expect(quitStep({ quitting: false, asking: false, inCall: false, request: "electron" })).toBe("proceed");
    expect(quitStep({ quitting: false, asking: false, inCall: false, request: "ours" })).toBe("proceed");
  });

  it("«Ieși din OnCall» after a quit that did not finish forces it through", () => {
    expect(quitStep({ quitting: true, asking: false, inCall: true, request: "ours" })).toBe("force");
    expect(quitStep({ quitting: true, asking: false, inCall: false, request: "ours" })).toBe("force");
  });

  it("Electron's own quit after «Ieși oricum» goes ahead without asking again", () => {
    expect(quitStep({ quitting: true, asking: false, inCall: true, request: "electron" })).toBe("proceed");
  });
});
