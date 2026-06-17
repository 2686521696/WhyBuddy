// Strip terminal color / style escape sequences from command output.
const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_ESCAPE_RE, '');
}