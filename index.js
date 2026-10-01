// Host service for the Quote plugin (dsh-quote).
//
// The browser half owns everything the user sees; this half owns exactly one
// thing — the plugin's settings, kept in a JSON file under `$DSH_HOME` and read
// or written through `/api/dsh-quote/config`. No secrets are involved and no
// other route exists, so the plugin never touches the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const inject = ['webServer'];

/** Largest configuration body accepted, in bytes. */
const MAX_BODY_BYTES = 16 * 1024;

/** Shortest accepted hotkey expression, e.g. `Mod+Shift+.`. */
const MIN_HOTKEY_LENGTH = 3;

/** Longest accepted hotkey expression; anything longer is a user mistake. */
const MAX_HOTKEY_LENGTH = 48;

/** Upper bound for the accepted hotkey; the field is a chord, not a script. */
const MAX_HOTKEY_PARTS = 5;

/** The settings the plugin starts with when no file has been written yet. */
export const DEFAULT_CONFIG = {
  enabled: true,
  attribution: false,
  maxLength: 4000,
  hotkey: 'Mod+Shift+.'
};

/** The settings file name inside `$DSH_HOME`. */
export const CONFIG_FILE_NAME = 'dsh-quote-config.json';

/**
 * The DSH home directory, as the rest of the product resolves it.
 * `DSH_HOME` wins when set; otherwise the conventional `~/.dsh`.
 */
export function resolveDshHome(env = process.env, homedir = os.homedir) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (configured !== '') return configured;
  return path.join(homedir(), '.dsh');
}

/**
 * The absolute configuration path, built with `node:path` so the same code
 * works on Windows and on macOS.
 */
export function configFilePath(env = process.env, homedir = os.homedir) {
  return path.join(resolveDshHome(env, homedir), CONFIG_FILE_NAME);
}

/** Clamp an arbitrary value into an integer range. */
function clampInteger(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/**
 * Whether a hotkey expression is one the client can actually match: a `+`
 * separated chord of modifiers and exactly one key, e.g. `Mod+Shift+.` or
 * `Ctrl+Alt+Q`. Returns the normalized expression, or `null` when unusable.
 */
export function normalizeHotkey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < MIN_HOTKEY_LENGTH || trimmed.length > MAX_HOTKEY_LENGTH) return null;
  const parts = trimmed.split('+').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length < 2 || parts.length > MAX_HOTKEY_PARTS) return null;
  const key = parts[parts.length - 1];
  if (key.length !== 1 && key.length > 12) return null;
  return parts.join('+');
}

/**
 * Fold an untrusted patch onto the defaults, dropping anything that does not
 * have the expected shape and clamping everything that does. The result is
 * always a complete, valid configuration — the client never has to defend
 * against a partially written file.
 */
export function validateConfig(patch, base = DEFAULT_CONFIG) {
  const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const fallback = base !== null && typeof base === 'object' && !Array.isArray(base) ? base : DEFAULT_CONFIG;
  const next = { ...DEFAULT_CONFIG, ...fallback };
  if (typeof source.enabled === 'boolean') next.enabled = source.enabled;
  if (typeof source.attribution === 'boolean') next.attribution = source.attribution;
  if (source.maxLength !== undefined) {
    next.maxLength = clampInteger(source.maxLength, 200, 20000, next.maxLength);
  }
  if (source.hotkey !== undefined) {
    const hotkey = normalizeHotkey(source.hotkey);
    if (hotkey !== null) next.hotkey = hotkey;
  }
  return next;
}

/** Read the settings file. A missing or unreadable file yields the defaults. */
export function readConfig(file) {
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validateConfig(parsed);
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

/** Write the settings file, creating `$DSH_HOME` when it does not exist yet. */
export function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Whether an address is a loopback address. Both `127.0.0.1` and the wider
 * `127.0.0.0/8` range count, as does the IPv6 form and its IPv4-mapped spelling.
 */
export function isLoopbackAddress(address) {
  const value = String(address ?? '').trim();
  return value === '::1'
    || value === 'localhost'
    || /^127(?:\.\d{1,3}){3}$/u.test(value)
    || /^::ffff:127(?:\.\d{1,3}){3}$/u.test(value);
}

/**
 * Whether a request comes from this machine. The plugin's routes return local
 * settings and accept local writes only, so the check is conservative: a
 * request that does not clearly originate from loopback is refused, and a
 * loopback socket carrying a foreign `Host` header is refused too (that is the
 * shape of a DNS-rebinding attempt).
 */
export function isLocalRequest(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  const host = String(req.headers?.host ?? '').trim().toLowerCase();
  if (host === '') return true;
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return hostname === 'localhost'
    || hostname === '[::1]'
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

/** Read a JSON request body, refusing anything larger than the accepted size. */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > limit) fail(new Error(`Body exceeds the ${limit} byte limit`));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (body.trim() === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', fail);
  });
}

/** Send one JSON answer with the headers a same-origin fetch expects. */
function sendJson(res, status, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

export function apply(ctx, config) {
  const file = configFilePath();
  let current = validateConfig({}, readConfig(file));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-quote/config',
    handler: async (req, res) => {
      if (!isLocalRequest(req)) {
        sendJson(res, 403, { ok: false, error: 'This endpoint only answers requests from this machine' });
        return;
      }
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          current = validateConfig({}, readConfig(file));
          sendJson(res, 200, { ok: true, config: current });
          return;
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          const body = await readJsonBody(req);
          const patch = body !== null && typeof body === 'object' && body.config !== undefined ? body.config : body;
          current = validateConfig(patch, current);
          writeConfig(file, current);
          sendJson(res, 200, { ok: true, config: current });
          return;
        }
        sendJson(res, 405, { ok: false, error: `Method ${req.method} is not supported` });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error?.message ? String(error.message) : String(error) });
      }
    }
  }), 'dsh-quote: configuration route');
}
