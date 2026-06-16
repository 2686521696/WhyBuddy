const SUPPORTED_LANGS = new Set(['en', 'zh-CN']);

export function parseProbeArgs(argv) {
  const parsed = {
    lang: 'en',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') {
      parsed.lang = readValue(argv, ++i, '--lang');
      if (!SUPPORTED_LANGS.has(parsed.lang)) {
        throw new Error('--lang must be one of: en, zh-CN');
      }
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}
