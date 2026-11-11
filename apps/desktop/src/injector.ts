import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

/**
 * Mouse and keyboard for remote control on macOS. One long-lived JXA process posts
 * CoreGraphics events (pointer) and System Events keystrokes (keys). It needs the
 * Accessibility permission; without it macOS silently drops the events.
 */

const JXA = String.raw`
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
var se = null;
var held = { 0: false, 2: false };
function mouse(type, x, y, button) {
  var e = $.CGEventCreateMouseEvent($(), type, { x: x, y: y }, button);
  $.CGEventPost(0, e);
}
function handle(m) {
  if (m.t === 'move') mouse(held[0] ? 6 : held[2] ? 7 : 5, m.x, m.y, held[2] ? 1 : 0);
  else if (m.t === 'down') { held[m.b] = true; mouse(m.b === 2 ? 3 : 1, m.x, m.y, m.b === 2 ? 1 : 0); }
  else if (m.t === 'up') { held[m.b] = false; mouse(m.b === 2 ? 4 : 2, m.x, m.y, m.b === 2 ? 1 : 0); }
  else if (m.t === 'scroll') { try { $.CGEventPost(0, $.CGEventCreateScrollWheelEvent2($(), 0, 2, -m.dy, -m.dx, 0)); } catch (e) {} }
  else if (m.t === 'text') { se = se || Application('System Events'); se.keystroke(m.s); }
  else if (m.t === 'key') {
    se = se || Application('System Events');
    var using = (m.mods || []).map(function (k) { return { cmd: 'command down', ctrl: 'control down', alt: 'option down', shift: 'shift down' }[k]; });
    if (typeof m.code === 'number') se.keyCode(m.code, { using: using });
    else se.keystroke(m.key, { using: using });
  }
}
var stdin = $.NSFileHandle.fileHandleWithStandardInput;
var buf = '';
while (true) {
  var d = stdin.availableData;
  if (Number(d.length) === 0) break;
  buf += $.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding).js;
  var i;
  while ((i = buf.indexOf('\n')) >= 0) {
    var line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try { handle(JSON.parse(line)); } catch (e) {}
  }
}
`

export const KEY_CODES: Record<string, number> = {
  Enter: 36,
  Backspace: 51,
  Tab: 48,
  Escape: 53,
  Delete: 117,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  " ": 49,
}

export class Injector {
  private proc: ChildProcessWithoutNullStreams | null = null

  get supported(): boolean {
    return process.platform === "darwin"
  }

  send(event: Record<string, unknown>): void {
    if (!this.supported) return
    if (!this.proc || this.proc.exitCode !== null) {
      this.proc = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", JXA])
      this.proc.on("error", () => (this.proc = null))
      this.proc.stderr.on("data", () => {})
    }
    this.proc.stdin.write(`${JSON.stringify(event)}\n`)
  }

  stop(): void {
    this.proc?.stdin.end()
    this.proc?.kill()
    this.proc = null
  }
}

export { JXA as INJECTOR_SCRIPT }
