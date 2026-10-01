/**
 * Unit tests for the quoting rules that decide what lands in the composer.
 *
 * `client.js` is not a module — it is a browser script that registers itself
 * with DSH's module loader — so the test loads it the same way the browser does
 * and drives the functions the factory exposes through its `__test` hook. That
 * way a rule cannot pass the test while the composer does something else.
 *
 * The host half is a real ES module, so its validation and path rules are
 * imported directly and checked here too.
 *
 *   node test/quote-logic-check.mjs
 */

import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { apply, configFilePath, isLocalRequest, normalizeHotkey, readJsonBody, validateConfig, resolveDshHome, CONFIG_FILE_NAME, DEFAULT_CONFIG } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const source = readFileSync(join(packageRoot, "client.js"), "utf8");

const failures = [];
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures.push(label);
	const short = detail === undefined ? "" : ` — ${String(detail).slice(0, 200)}`;
	console.log(`  FAIL ${label}${short}`);
}
function equal(label, actual, expected) {
	check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Load client.js the way the browser loader does and return its test hook.
 * `platform` drives the Apple check, so the macOS spelling of the default
 * hotkey can be tested on any machine.
 */
function loadClient(platform = "Win32") {
	const react = {
		createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; },
		useState(value) { return [typeof value === "function" ? value() : value, () => {}]; },
		useEffect() {},
		useLayoutEffect() {},
		useRef(value) { return { current: value ?? null }; },
		useCallback(fn) { return fn; },
		useMemo(fn) { return fn(); }
	};
	const window = {
		navigator: { platform, language: "en-US" },
		innerWidth: 1024,
		innerHeight: 768,
		__ModuleLoader__: { load(record) { window.__record = record; } }
	};
	// `computeQuotePosition` measures the viewport, exactly as it does in the
	// browser; the stand-in only has to answer with a size.
	globalThis.document = { documentElement: { clientWidth: 1024, clientHeight: 768 } };
	const requireStub = (id) => {
		if (id === "react") return react;
		if (id === "react-dom") return { createPortal: (node) => node };
		throw new Error(`unexpected require: ${id}`);
	};
	new Function("window", "require", source)(window, requireStub);
	return window.__record.factory(requireStub).__test;
}

const win = loadClient("Win32");
const mac = loadClient("MacIntel");

// ── Quote formatting ─────────────────────────────────────────────────────────

console.log("the `> ` prefix");
equal("a single line is quoted", win.buildQuoteText("hello", {}).text, "> hello");
equal(
	"every line gets the prefix",
	win.buildQuoteText("first line\nsecond line", {}).text,
	"> first line\n> second line"
);
equal("three lines keep their order", win.buildQuoteText("a\nb\nc", {}).text, "> a\n> b\n> c");

console.log("trimming and blank lines");
equal("surrounding whitespace goes", win.buildQuoteText("   hi there   ", {}).text, "> hi there");
equal("surrounding blank lines go", win.buildQuoteText("\n\nonly line\n\n", {}).text, "> only line");
equal(
	"an internal blank line is kept as one quoting line",
	win.buildQuoteText("para one\n\n\n\npara two", {}).text,
	"> para one\n>\n> para two"
);
equal("trailing spaces on a line go", win.buildQuoteText("text   \nmore", {}).text, "> text\n> more");
equal("CRLF input is normalized", win.buildQuoteText("one\r\ntwo\r\n", {}).text, "> one\n> two");
equal("a non-breaking space is not a line break", win.buildQuoteText("a\u00a0b", {}).text, "> a b");
equal("whitespace only selects nothing", win.buildQuoteText("   \n\t\n ", {}).text, "");
equal("an empty selection produces no quote", win.buildQuoteText("", {}).text, "");
equal("a missing selection produces no quote", win.buildQuoteText(undefined, {}).text, "");

console.log("the length limit");
const short = win.buildQuoteText("abcdef", { maxLength: 100 });
equal("text under the limit is untouched", short.text, "> abcdef");
equal("text under the limit is not clipped", short.clipped, false);
const clipped = win.buildQuoteText("x".repeat(50), { maxLength: 10 });
equal("the limit cuts the quote", clipped.text, `> ${"x".repeat(10)}`);
equal("the cut is reported", clipped.clipped, true);
const clippedOnSpace = win.buildQuoteText("hello world again", { maxLength: 12 });
equal("a cut trailing space is trimmed", clippedOnSpace.text, "> hello world");
equal("the default limit is generous", win.buildQuoteText("y".repeat(4000), {}).clipped, false);
equal("the default limit still bites", win.buildQuoteText("y".repeat(4001), {}).clipped, true);
equal(
	"a cut inside a blank run leaves no dangling marker",
	win.buildQuoteText(`kept\n\n${"z".repeat(50)}`, { maxLength: 6 }).text,
	"> kept"
);

console.log("the attribution line");
const attributed = win.buildQuoteText("quoted", { attributionEnabled: true, attribution: "— quote" });
equal("the attribution closes the quote", attributed.text, "> quoted\n> — quote");
equal(
	"the attribution is skipped when disabled",
	win.buildQuoteText("quoted", { attribution: "— quote" }).text,
	"> quoted"
);
equal(
	"an empty attribution adds nothing",
	win.buildQuoteText("quoted", { attributionEnabled: true, attribution: "  " }).text,
	"> quoted"
);
equal(
	"a translated attribution is used verbatim",
	win.buildQuoteText("quoted", { attributionEnabled: true, attribution: "— цитата" }).text,
	"> quoted\n> — цитата"
);

// ── Draft appending ─────────────────────────────────────────────────────────

console.log("appending to the draft");
equal("an empty draft takes the quote alone", win.buildAppendText("", "> q"), "> q");
equal("typed text gets a blank line first", win.buildAppendText("my prompt", "> q"), "my prompt\n\n> q");
equal("a trailing newline already separates", win.buildAppendText("my prompt\n", "> q"), "my prompt\n\n> q");
equal("an existing blank line is not doubled", win.buildAppendText("my prompt\n\n", "> q"), "my prompt\n\n> q");
equal("an already separated draft is left as is", win.buildAppendText("my prompt\n\n> old", "> q"), "my prompt\n\n> old\n\n> q");
equal("a whitespace-only separator still counts", win.buildAppendText("my prompt\n \n  ", "> q"), "my prompt\n \n  > q");
equal("no quote means no change", win.buildAppendText("my prompt", ""), "my prompt");
equal("a missing draft is treated as empty", win.buildAppendText(undefined, "> q"), "> q");

// ── Hotkeys ─────────────────────────────────────────────────────────────────

console.log("hotkey parsing (Windows/Linux)");
const defaultChord = win.parseHotkey(win.FALLBACK_HOTKEY);
check("the default chord parses", defaultChord !== null, win.FALLBACK_HOTKEY);
equal("Mod means Ctrl off macOS", defaultChord.ctrl, true);
equal("Mod does not mean Cmd off macOS", defaultChord.meta, false);
equal("the default chord needs Shift", defaultChord.shift, true);
equal("the default chord ends in a dot", defaultChord.key, ".");
equal("the default chord label is spelled out", win.formatHotkeyLabel(win.FALLBACK_HOTKEY), "Ctrl+Shift+.");
check("a chord without a modifier is refused", win.parseHotkey(".") === null);
check("a chord without a key is refused", win.parseHotkey("Ctrl+Shift") === null);
check("an unknown modifier is refused", win.parseHotkey("Hyper+Q") === null);
check("an empty expression is refused", win.parseHotkey("") === null);
check("a non-string is refused", win.parseHotkey(undefined) === null);
equal("named keys survive parsing", win.parseHotkey("Ctrl+Alt+Space").key, "space");

console.log("the default chord matches the right events");
const chordEvent = (overrides) => ({
	key: ".",
	code: "Period",
	ctrlKey: true,
	metaKey: false,
	shiftKey: true,
	altKey: false,
	...overrides
});
equal("the exact chord matches", win.matchesHotkey(chordEvent(), defaultChord), true);
equal("a missing Ctrl does not match", win.matchesHotkey(chordEvent({ ctrlKey: false, metaKey: true }), defaultChord), false);
equal("a missing Shift does not match", win.matchesHotkey(chordEvent({ shiftKey: false }), defaultChord), false);
equal("an extra Alt does not match", win.matchesHotkey(chordEvent({ altKey: true }), defaultChord), false);
equal("another key does not match", win.matchesHotkey(chordEvent({ key: ",", code: "Comma" }), defaultChord), false);
equal("a layout-resolved key still matches by code", win.matchesHotkey(chordEvent({ code: "NumpadDecimal" }), defaultChord), true);
equal(
	"a letter chord matches by code on another layout",
	win.matchesHotkey({ key: "й", code: "KeyQ", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, win.parseHotkey("Mod+Q")),
	true
);
equal("a null event never matches", win.matchesHotkey(null, defaultChord), false);
equal("a null chord never matches", win.matchesHotkey(chordEvent(), null), false);

console.log("the macOS spelling of the same chord");
const macChord = mac.parseHotkey(mac.FALLBACK_HOTKEY);
equal("Mod means Cmd on macOS", macChord.meta, true);
equal("Mod no longer means Ctrl on macOS", macChord.ctrl, false);
equal("the macOS label uses symbols", mac.formatHotkeyLabel(mac.FALLBACK_HOTKEY), "⇧⌘.");
equal("the macOS chord matches Cmd", mac.matchesHotkey(chordEvent({ ctrlKey: false, metaKey: true }), macChord), true);
equal("the macOS chord rejects Ctrl", mac.matchesHotkey(chordEvent(), macChord), false);

console.log("recording a chord from a keydown");
equal("Ctrl+Shift+. is recorded portably", win.hotkeyFromEvent(chordEvent()), "Mod+Shift+.");
equal("a letter key is recorded in lower case", win.hotkeyFromEvent({
	key: "Q", code: "KeyQ", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false
}), "Mod+q");
equal("Meta is recorded on Windows too", win.hotkeyFromEvent({
	key: "q", code: "KeyQ", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false
}), "Meta+q");
equal("a digit is recorded", win.hotkeyFromEvent({
	key: "1", code: "Digit1", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false
}), "Mod+1");
equal("a bare key is refused", win.hotkeyFromEvent({
	key: "q", code: "KeyQ", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false
}), null);
equal("a recorded chord parses back", win.parseHotkey(win.hotkeyFromEvent(chordEvent())).key, ".");
equal("the macOS recorder prefers Cmd", mac.hotkeyFromEvent(chordEvent({ ctrlKey: false, metaKey: true })), "Mod+Shift+.");
equal("the macOS recorder keeps Ctrl distinct", mac.hotkeyFromEvent(chordEvent()), "Ctrl+Shift+.");

// ── Settings normalization ──────────────────────────────────────────────────

console.log("settings normalization (client)");
equal("unknown shapes fall back to the defaults", win.normalizeConfig(null).maxLength, win.DEFAULT_CONFIG.maxLength);
equal("a negative limit is refused", win.normalizeConfig({ maxLength: -5 }).maxLength, win.DEFAULT_CONFIG.maxLength);
equal("an absurd limit is refused", win.normalizeConfig({ maxLength: 10 ** 9 }).maxLength, win.DEFAULT_CONFIG.maxLength);
equal("a usable limit is kept", win.normalizeConfig({ maxLength: 1200 }).maxLength, 1200);
equal("a bogus hotkey falls back", win.normalizeConfig({ hotkey: "nonsense" }).hotkey, win.DEFAULT_CONFIG.hotkey);
equal("a valid hotkey is kept", win.normalizeConfig({ hotkey: "Mod+Alt+Q" }).hotkey, "Mod+Alt+Q");
equal("non-boolean flags fall back", win.normalizeConfig({ enabled: "yes" }).enabled, true);
equal("an explicit false survives", win.normalizeConfig({ enabled: false }).enabled, false);
equal("the attribution flag survives", win.normalizeConfig({ attribution: true }).attribution, true);

console.log("settings validation (host)");
const hostConfig = validateConfig({ enabled: false, attribution: true, maxLength: 999999, hotkey: "Ctrl+Shift+Q" });
equal("a patch is folded onto the defaults", hostConfig.maxLength, DEFAULT_CONFIG.maxLength === 999999 ? 999999 : 20000);
equal("the host clamps the limit", hostConfig.maxLength, 20000);
equal("the host clamps a tiny limit", validateConfig({ maxLength: 1 }).maxLength, 200);
equal("the host keeps flags", hostConfig.enabled, false);
equal("the host keeps a valid hotkey", hostConfig.hotkey, "Ctrl+Shift+Q");
equal("the host drops a bogus hotkey", validateConfig({ hotkey: "no-modifier" }).hotkey, DEFAULT_CONFIG.hotkey);
equal("the host refuses an array", validateConfig([]).maxLength, DEFAULT_CONFIG.maxLength);
equal("the host refuses a string limit", validateConfig({ maxLength: "wide" }).maxLength, DEFAULT_CONFIG.maxLength);
equal("the host honours a numeric string", validateConfig({ maxLength: "1500" }).maxLength, 1500);
check("the host normalizes a padded hotkey", normalizeHotkey("  Mod + Shift + .  ") === "Mod+Shift+.", normalizeHotkey("  Mod + Shift + .  "));
check("the host refuses a one-part hotkey", normalizeHotkey("F5") === null);

console.log("host paths and defaults");const fakeHome = join("C:", "Users", "tester");
equal("DSH_HOME wins when set", resolveDshHome({ DSH_HOME: join("D:", "dsh") }, () => fakeHome), join("D:", "dsh"));
equal("the conventional home is used otherwise", resolveDshHome({}, () => fakeHome), join(fakeHome, ".dsh"));
equal("a blank DSH_HOME is ignored", resolveDshHome({ DSH_HOME: "   " }, () => fakeHome), join(fakeHome, ".dsh"));
check("the config file lives under the DSH home", configFilePath({}, () => fakeHome) === join(fakeHome, ".dsh", "dsh-quote-config.json"), configFilePath({}, () => fakeHome));
check("paths use the platform separator", configFilePath({}, () => fakeHome).includes(sep), configFilePath({}, () => fakeHome));
equal("the default hotkey is the documented one", DEFAULT_CONFIG.hotkey, "Mod+Shift+.");
equal("quoting is on by default", DEFAULT_CONFIG.enabled, true);
equal("attribution is off by default", DEFAULT_CONFIG.attribution, false);

// ── Route guards ────────────────────────────────────────────────────────────

console.log("only this machine may read or write the settings");
const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
equal("a loopback socket is local", isLocalRequest(request("127.0.0.1", { host: "127.0.0.1:43129" })), true);
equal("IPv6 loopback is local", isLocalRequest(request("::1", { host: "[::1]:43129" })), true);
equal("a mapped loopback address is local", isLocalRequest(request("::ffff:127.0.0.1", { host: "localhost:43129" })), true);
equal("the loopback range is local", isLocalRequest(request("127.0.0.10", { host: "127.0.0.10:43129" })), true);
equal("a LAN address is refused", isLocalRequest(request("192.168.1.20", { host: "192.168.1.20:43129" })), false);
equal("a public address is refused", isLocalRequest(request("8.8.8.8", { host: "example.com" })), false);
equal("an empty socket address is refused", isLocalRequest(request("", { host: "127.0.0.1" })), false);
equal("a loopback socket with a foreign Host header is refused", isLocalRequest(request("127.0.0.1", { host: "evil.example" })), false);
equal("a missing Host header is tolerated", isLocalRequest(request("127.0.0.1")), true);
equal("a DNS-rebinding hostname is refused", isLocalRequest(request("127.0.0.1", { host: "dsh.local:43129" })), false);

console.log("the configuration body is bounded");
/**
 * A stand-in for the host's request stream. `emit` has to be called after the
 * reader has subscribed, exactly as a socket delivers data after `on('data')`.
 */
function bodyStream() {
	const listeners = new Map();
	return {
		on(name, handler) { listeners.set(name, handler); return this; },
		emit(...chunks) {
			for (const chunk of chunks) listeners.get("data")?.(chunk);
			listeners.get("end")?.();
		}
	};
}
async function readBody(chunks, limit) {
	const stream = bodyStream();
	const pending = readJsonBody(stream, limit);
	stream.emit(...chunks);
	return pending;
}
const parsed = await readBody(['{"maxLength":1200}']);
equal("a small body is parsed", parsed.maxLength, 1200);
equal("an empty body is an empty object", Object.keys(await readBody([])).length, 0);
let brokenError = null;
try { await readBody(["{nope"]); } catch (error) { brokenError = error; }
check("invalid JSON is rejected", brokenError !== null && /Invalid JSON/u.test(brokenError.message), brokenError?.message);
let oversizedError = null;
try { await readBody(["x".repeat(20 * 1024)]); } catch (error) { oversizedError = error; }
check("an oversized body is rejected", oversizedError !== null && /byte limit/u.test(oversizedError.message), oversizedError?.message);
let tinyLimitError = null;
try { await readBody(["12345"], 4); } catch (error) { tinyLimitError = error; }
check("the limit is configurable", tinyLimitError !== null && /4 byte limit/u.test(tinyLimitError.message), tinyLimitError?.message);

// ── The route itself ────────────────────────────────────────────────────────
// `apply()` is mounted against a stub web server pointed at a throwaway DSH
// home, so the whole read → patch → persist → reload cycle runs for real.

console.log("the configuration route round-trips");
const sandboxHome = join(tmpdir(), `dsh-quote-test-${process.pid}`);
process.env.DSH_HOME = sandboxHome;
const routes = [];
apply({
	effect(callback) { callback(); },
	webServer: { register(route) { routes.push(route); return () => {}; } }
}, {});

equal("one route is registered", routes.length, 1);
equal("the route is an exact match", routes[0].kind, "exact");
equal("the route lives under the plugin's own prefix", routes[0].path, "/api/dsh-quote/config");
equal("the handler is async", routes[0].handler.constructor.name, "AsyncFunction");

/** Answer one request through the registered handler. */
async function call(method, body, remoteAddress = "127.0.0.1") {
	const chunks = body === undefined ? [] : [JSON.stringify(body)];
	const stream = bodyStream();
	const request = {
		method,
		socket: { remoteAddress },
		headers: { host: "127.0.0.1:43129" },
		on(name, handler) { stream.on(name, handler); return this; }
	};
	let status = 0;
	let payload = null;
	const response = {
		writeHead(code) { status = code; return this; },
		end(text) { payload = text === undefined ? null : JSON.parse(text); }
	};
	const pending = routes[0].handler(request, response);
	stream.emit(...chunks);
	await pending;
	return { status, payload };
}

const initial = await call("GET");
equal("a GET succeeds", initial.status, 200);
equal("a GET reports success", initial.payload.ok, true);
equal("a GET answers with the defaults", initial.payload.config.hotkey, DEFAULT_CONFIG.hotkey);
equal("a GET keeps quoting on", initial.payload.config.enabled, true);

const patched = await call("POST", { enabled: false, maxLength: 5000, hotkey: "Mod+Alt+Q", attribution: true });
equal("a POST succeeds", patched.status, 200);
equal("the patch is applied", patched.payload.config.maxLength, 5000);
equal("the patch keeps its hotkey", patched.payload.config.hotkey, "Mod+Alt+Q");
equal("the patch turns quoting off", patched.payload.config.enabled, false);

const written = JSON.parse(readFileSync(configFilePath(), "utf8"));
equal("the file lands in the DSH home", configFilePath(), join(sandboxHome, CONFIG_FILE_NAME));
equal("the file matches the answer", written.maxLength, 5000);
equal("the file is the whole configuration", Object.keys(written).sort().join(","), "attribution,enabled,hotkey,maxLength");

const reread = await call("GET");
equal("a fresh GET returns the saved settings", reread.payload.config.hotkey, "Mod+Alt+Q");

const clamped = await call("POST", { config: { maxLength: 999999, hotkey: "broken" } });
equal("a nested config object is accepted", clamped.status, 200);
equal("the limit is clamped on the way in", clamped.payload.config.maxLength, 20000);
equal("a broken hotkey keeps the previous value", clamped.payload.config.hotkey, "Mod+Alt+Q");

const refused = await call("GET", undefined, "192.168.1.20");
equal("a non-local request is refused", refused.status, 403);
equal("the refusal explains itself", refused.payload.ok, false);

const wrongMethod = await call("DELETE");
equal("an unsupported method is refused", wrongMethod.status, 405);

const badJson = await (async () => {
	const stream = bodyStream();
	const request = {
		method: "POST",
		socket: { remoteAddress: "127.0.0.1" },
		headers: { host: "127.0.0.1:43129" },
		on(name, handler) { stream.on(name, handler); return this; }
	};
	let status = 0;
	let payload = null;
	const response = { writeHead(code) { status = code; return this; }, end(text) { payload = JSON.parse(text); } };
	const pending = routes[0].handler(request, response);
	stream.emit("{not json");
	await pending;
	return { status, payload };
})();
equal("a malformed body is a client error", badJson.status, 400);
check("the malformed body is reported", /Invalid JSON/u.test(String(badJson.payload.error)), badJson.payload.error);

rmSync(sandboxHome, { recursive: true, force: true });
delete process.env.DSH_HOME;

// ── Button placement ────────────────────────────────────────────────────────

console.log("button placement stays on screen");
const size = { width: 100, height: 28 };
const below = win.computeQuotePosition({ top: 100, bottom: 120, left: 300, width: 200 }, size);
equal("the button sits under the selection", below.top, 126);
equal("the button is centred on the selection", below.left, 350);
const stillFits = win.computeQuotePosition({ top: 700, bottom: 720, left: 300, width: 200 }, size);
equal("a selection with room below keeps the button below it", stillFits.top, 726);
const nearBottom = win.computeQuotePosition({ top: 725, bottom: 745, left: 300, width: 200 }, size);
check("near the bottom edge it flips above the selection", nearBottom.top < 725, nearBottom.top);
equal("the flipped button clears the selection", nearBottom.top, 725 - 28 - 6);
equal("the flipped button stays level with the selection", nearBottom.left, 350);
const atBottom = win.computeQuotePosition({ top: 764, bottom: 768, left: 300, width: 200 }, size);
check("a selection at the very bottom keeps the button on screen", atBottom.top + size.height <= 768 - 8, atBottom.top);
check("the bottom-edge button never leaves the top either", atBottom.top >= 8, atBottom.top);
const nearRight = win.computeQuotePosition({ top: 100, bottom: 120, left: 1000, width: 200 }, size);
check("near the right edge it is clamped", nearRight.left <= 1024 - 100 - 8, nearRight.left);
equal("a selection at the right edge is clamped to the margin", win.computeQuotePosition({ top: 10, bottom: 30, left: 5000, width: 10 }, size).left, 1024 - 100 - 8);
equal("a selection at the left edge is clamped", win.computeQuotePosition({ top: 10, bottom: 30, left: -40, width: 10 }, size).left, 8);
check("a missing rect does not throw", win.computeQuotePosition(null, size).top >= 8);

// ── Editable surfaces ───────────────────────────────────────────────────────

console.log("selections inside editable surfaces are ignored");
const node = (tagName, options = {}) => ({
	tagName: tagName.toUpperCase(),
	nodeType: 1,
	isContentEditable: options.editable === true,
	getAttribute: (name) => (name === "contenteditable"
		? (options.contenteditable ?? null)
		: (name === "data-composer-card" ? (options.composer ?? null) : null)),
	parentElement: options.parent ?? null
});
equal("a textarea is editable", win.isEditableNode(node("textarea")), true);
equal("an input is editable", win.isEditableNode(node("input")), true);
equal("a plain paragraph is not", win.isEditableNode(node("p")), false);
equal("contenteditable=true counts", win.isEditableNode(node("div", { contenteditable: "true" })), true);
equal("a child of an editable host counts", win.isInsideEditable(node("span", { parent: node("div", { editable: true }) })), true);
equal("the composer card counts", win.isInsideEditable(node("span", { parent: node("div", { composer: "" }) })), true);
equal("transcript text does not count", win.isInsideEditable(node("p", { parent: node("div") })), false);
equal("a text node is judged by its parent", win.isInsideEditable({ nodeType: 3, parentElement: node("div", { editable: true }) }), true);

// ── The settings surface renders in both languages ──────────────────────────

console.log("the settings slot");
const summaryText = win.QuoteSettingsSlot({ view: "summary" });
check("the summary is a sentence", typeof summaryText === "string" && summaryText.length > 10, summaryText);
check("both languages have every key the card uses", Object.keys(win.dictionaries.en).every((key) => typeof win.dictionaries.ru[key] === "string"));
check("the dictionaries agree on the key set", Object.keys(win.dictionaries.en).length === Object.keys(win.dictionaries.ru).length, `${Object.keys(win.dictionaries.en).length} vs ${Object.keys(win.dictionaries.ru).length}`);
check("the placeholder fill works", win.message("saveFailed", { error: "boom" }).includes("boom"), win.message("saveFailed", { error: "boom" }));
equal("an unknown key falls back to itself", win.message("not-a-key"), "not-a-key");

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
