# Persistent debug Chrome (shared browser with Will)

A real, visible Chrome window on Will's Mac that the agent drives via CDP.
Launched 08/09/2026 for the Google Cloud Console work. **Do not kill it and
do not wipe its profile** — Will logs in there himself so he never has to
re-sign-in.

- Debug port: `http://localhost:9222` (DevTools protocol)
- Profile: `/tmp/pulse-chrome-debug` (⚠️ macOS clears /tmp on reboot — if the
  browser is gone after a restart, relaunch below and ask Will to log in once)
- Connect from scripts: `playwright-core`'s `chromium.connectOverCDP('http://localhost:9222')`
  (client lib pre-installed at `/var/folders/nn/j289_vm11kgg14p2ybhycsgm0000gn/T/opencode/cdp`)
- Relaunch if needed:
  ```
  mkdir -p /tmp/pulse-chrome-debug && nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/pulse-chrome-debug --no-first-run --new-window about:blank >/tmp/pulse-chrome-debug.log 2>&1 < /dev/null & disown
  ```

Rules:
1. Never type passwords or 2FA codes — stop and hand over to Will, then resume on his word.
2. Never close his tabs or quit the browser; only navigate the tab you're given.
3. His everyday Brave is out of bounds — only this Chrome window.
