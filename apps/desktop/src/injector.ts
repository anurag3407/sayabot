import { spawn, type ChildProcess } from "node:child_process"
import * as path from "node:path"

/**
 * Mouse and keyboard for remote control.
 * macOS: one long-lived JXA process posts CoreGraphics events and System Events keystrokes.
 * It needs the Accessibility permission; without it macOS silently drops the events.
 * Windows: one long-lived PowerShell process calls user32 (SetCursorPos, mouse_event, keybd_event,
 * SendInput). A normal interactive session can inject; there is no separate Accessibility grant.
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

/** Win32 virtual-key injection. Reads one JSON event per line, same shape as the Mac injector. */
export const WIN_INJECTOR_SCRIPT = String.raw`
$src = @'
using System;
using System.Runtime.InteropServices;
namespace Sayabot {
  public static class Input {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int cb);
    const uint KEYUP = 2;
    const uint UNICODE = 4;
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
    public static void Move(int x, int y) { SetCursorPos(x, y); }
    public static void Button(int x, int y, int button, bool down) {
      SetCursorPos(x, y);
      uint flag = button == 2 ? (down ? 0x0008u : 0x0010u) : (down ? 0x0002u : 0x0004u);
      mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }
    public static void Wheel(int dy, int dx) {
      if (dy != 0) mouse_event(0x0800, 0, 0, (uint)(-dy * 120), UIntPtr.Zero);
      if (dx != 0) mouse_event(0x1000, 0, 0, (uint)(-dx * 120), UIntPtr.Zero);
    }
    static void Tap(byte vk, bool down) { keybd_event(vk, 0, down ? 0u : KEYUP, UIntPtr.Zero); }
    public static void Key(byte vk, byte[] mods) {
      foreach (var m in mods) Tap(m, true);
      Tap(vk, true); Tap(vk, false);
      for (int i = mods.Length - 1; i >= 0; i--) Tap(mods[i], false);
    }
    public static void Text(string s) {
      var inputs = new INPUT[s.Length * 2];
      for (int i = 0; i < s.Length; i++) {
        inputs[i * 2].type = 1;
        inputs[i * 2].u.ki.wScan = s[i];
        inputs[i * 2].u.ki.dwFlags = UNICODE;
        inputs[i * 2 + 1].type = 1;
        inputs[i * 2 + 1].u.ki.wScan = s[i];
        inputs[i * 2 + 1].u.ki.dwFlags = UNICODE | KEYUP;
      }
      SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
$vk = @{
  Enter = 13; Backspace = 8; Tab = 9; Escape = 27; Delete = 46
  ArrowLeft = 37; ArrowRight = 39; ArrowDown = 40; ArrowUp = 38
  Home = 36; End = 35; PageUp = 33; PageDown = 34; ' ' = 32
}
$mod = @{ ctrl = 17; alt = 18; shift = 16; cmd = 91 }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $m = $line | ConvertFrom-Json
    if ($m.t -eq 'move') { [Sayabot.Input]::Move([int]$m.x, [int]$m.y) }
    elseif ($m.t -eq 'down') { [Sayabot.Input]::Button([int]$m.x, [int]$m.y, [int]$m.b, $true) }
    elseif ($m.t -eq 'up') { [Sayabot.Input]::Button([int]$m.x, [int]$m.y, [int]$m.b, $false) }
    elseif ($m.t -eq 'scroll') { [Sayabot.Input]::Wheel([int]$m.dy, [int]$m.dx) }
    elseif ($m.t -eq 'text') { [Sayabot.Input]::Text([string]$m.s) }
    elseif ($m.t -eq 'key') {
      $mods = @()
      foreach ($name in @($m.mods)) { if ($mod.ContainsKey([string]$name)) { $mods += [byte]$mod[[string]$name] } }
      $name = [string]$m.key
      if ($vk.ContainsKey($name)) { [Sayabot.Input]::Key([byte]$vk[$name], [byte[]]$mods) }
      elseif ($name.Length -eq 1) { [Sayabot.Input]::Text($name) }
    }
  } catch {}
}
`

/** macOS virtual key codes. Windows maps key names inside WIN_INJECTOR_SCRIPT instead. */
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

function powershellExe(): string {
  const root = process.env.SystemRoot || "C:\\Windows"
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

export class Injector {
  private proc: ChildProcess | null = null

  get supported(): boolean {
    return process.platform === "darwin" || process.platform === "win32"
  }

  send(event: Record<string, unknown>): void {
    if (!this.supported) return
    if (!this.proc || this.proc.exitCode !== null) {
      this.proc =
        process.platform === "win32"
          ? spawn(
              powershellExe(),
              [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                Buffer.from(WIN_INJECTOR_SCRIPT, "utf16le").toString("base64"),
              ],
              { windowsHide: true },
            )
          : spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", JXA])
      this.proc.on("error", () => (this.proc = null))
      this.proc.stderr?.on("data", () => {})
    }
    this.proc.stdin?.write(`${JSON.stringify(event)}\n`)
  }

  stop(): void {
    this.proc?.stdin?.end()
    this.proc?.kill()
    this.proc = null
  }
}

export { JXA as INJECTOR_SCRIPT }
