// Browser transport bridge replacing the VS Code webview postMessage channel.
//
// In the VS Code extension, DashboardApp fired commands via `postCommand` and the
// extension host handled them (and pushed back overview/detail re-renders). In the
// main app there is no host, so commands are dispatched to a handler that the page
// registers — navigation commands switch the in-page view and data commands hit the
// Python HTTP API.

export type DashboardCommandHandler = (
  type: string,
  extra: Record<string, unknown>,
) => void;

let handler: DashboardCommandHandler | null = null;

export function setCommandHandler(next: DashboardCommandHandler | null): void {
  handler = next;
}

export function postCommand(type: string, extra: Record<string, unknown> = {}): void {
  handler?.(type, extra);
}
