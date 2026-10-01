/**
 * Contract check for the plugin's package metadata and client registration.
 *
 * Two things are verified here, both of them things the host resolves on its
 * own and reports only as an empty card when they are wrong:
 *
 * 1. The package's `exports` map resolves the entry point, `package.json` (the
 *    host reads the icon from it) and every `locale/*.json` the card needs.
 * 2. `client.js` registers itself with the browser module loader under the
 *    plugin's id, returns the `{ inject: ['slots'], apply }` shape the loader
 *    expects, and registers the three slots the plugin promises: the composer
 *    activity seat, the bundle's config card and the row's config card.
 *
 *   node test/metadata-check.mjs
 */

import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const name = manifest.name;

const failures = [];
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures.push(label);
	console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail).slice(0, 160)}`}`);
}

// Self-reference resolves through the package's exports map, the same way the
// host's resource resolver does.
const require = createRequire(join(packageRoot, "package.json"));
function resolve(specifier) {
	try {
		return require.resolve(specifier);
	} catch (error) {
		return error;
	}
}

console.log("exports map");
const mainEntry = resolve(name);
check("the plugin entry resolves", typeof mainEntry === "string", mainEntry?.code ?? mainEntry?.message);
const manifestPath = resolve(`${name}/package.json`);
check("package.json is exported (the host reads the icon from it)", typeof manifestPath === "string", manifestPath?.code ?? manifestPath?.message);
const clientPath = resolve(`${name}/client`);
check("client.js is exported", typeof clientPath === "string", clientPath?.code ?? clientPath?.message);
const englishPath = resolve(`${name}/locale/en.json`);
check("locale/en.json is exported", typeof englishPath === "string", englishPath?.code ?? englishPath?.message);

console.log("icon");
const icon = manifest.icon;
check("the manifest declares an icon", typeof icon === "string" && icon.trim() !== "");
if (typeof icon === "string") {
	check("the icon is a relative path", !isAbsolute(icon) && !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon), icon);
	const allowed = [".svg", ".png", ".jpg", ".jpeg", ".webp"];
	check("the icon has an allowed media type", allowed.includes(extname(icon).toLowerCase()), extname(icon));
	const iconPath = join(packageRoot, icon);
	let size = 0;
	try { size = statSync(iconPath).size; } catch { size = -1; }
	check("the icon exists", size >= 0, iconPath);
	check("the icon stays inside the package", !relative(packageRoot, iconPath).startsWith(".."), relative(packageRoot, iconPath));
	check("the icon is at most 256 KiB", size >= 0 && size <= 256 * 1024, `${size} bytes`);
	check("the icon paints in the current colour", /currentColor/u.test(readFileSync(iconPath, "utf8")));
}

console.log("locale files (the shape the host reads)");
const languages = [];
const localeDirectories = new Set();
if (typeof englishPath === "string") {
	const directory = dirname(englishPath);
	check("locale files live in one directory beside package.json", directory === join(packageRoot, "locale"), directory);
	for (const file of ["en.json", "ru.json"]) {
		const specifier = `${name}/locale/${file}`;
		const resolved = resolve(specifier);
		check(`${specifier} resolves`, typeof resolved === "string", resolved?.code ?? resolved?.message);
		if (typeof resolved !== "string") continue;
		localeDirectories.add(dirname(resolved));
		let parsed = null;
		try { parsed = JSON.parse(readFileSync(resolved, "utf8")); } catch (error) { parsed = error; }
		check(`${file} is valid JSON`, parsed !== null && !(parsed instanceof Error), parsed?.message);
		if (parsed === null || parsed instanceof Error) continue;
		const meta = parsed.meta;
		check(`${file} has a meta object`, meta !== undefined && typeof meta === "object", JSON.stringify(parsed).slice(0, 80));
		check(`${file} meta.title is a non-empty string`, typeof meta?.title === "string" && meta.title.trim() !== "", meta?.title);
		check(`${file} meta.description is a non-empty string`, typeof meta?.description === "string" && meta.description.trim() !== "", meta?.description);
		languages.push([file.slice(0, -5), meta]);
	}
	check("every locale shares the English directory", localeDirectories.size === 1, [...localeDirectories].join(" | "));
}

console.log("what the card would show");
const english = languages.find(([language]) => language === "en")?.[1];
check("the English title is the short product name", english?.title === "Quote", english?.title);
check("the description credits the author", /Alex Naletko/u.test(english?.description ?? ""), english?.description);
check("the description is longer than the title", (english?.description?.length ?? 0) > (english?.title?.length ?? 0));
check("a Russian translation ships too", languages.some(([language]) => language === "ru"));
check("every locale carries the same title", languages.every(([, meta]) => meta?.title === "Quote"), languages.map(([language, meta]) => `${language}:${meta?.title}`).join(" | "));
check("the manifest description is a usable fallback", typeof manifest.description === "string" && manifest.description.trim() !== "");
check("the plugin publishes under its own repository", String(manifest.repository?.url ?? "").includes("naletko/dsh-quote"), manifest.repository?.url);
check("the author is credited", manifest.author === "Alex Naletko", manifest.author);
check("the licence is MIT", manifest.license === "MIT", manifest.license);

console.log("bundle manifest");
check("the cordis patch ships", typeof manifest.dsh?.bundle?.patch === "string", manifest.dsh?.bundle?.patch);
const patch = readFileSync(join(packageRoot, manifest.dsh?.bundle?.patch ?? ""), "utf8");
check("the patch inserts the quote row", /id:\s*quote\b/u.test(patch), patch.trim().split("\n")[1]);
check("the patch names this package", patch.includes(`name: '${name}'`) || patch.includes(`name: "${name}"`), patch.trim().split("\n")[2]);
check("the client half is a web bundle that loads immediately", manifest.dsh?.client?.platform === "web" && manifest.dsh?.client?.immediately === true);
check("the client injects the conversation UI", Array.isArray(manifest.dsh?.client?.inject) && manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-conversation"), JSON.stringify(manifest.dsh?.client?.inject));

console.log("client module");
const source = readFileSync(join(packageRoot, "client.js"), "utf8");
const registrations = [];
let moduleRecord;

// The browser loader hands the plugin a `require`; React is all the client asks
// for, and the test's stand-in is enough for the registration pass.
const react = {
	createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; },
	useState(value) { return [typeof value === "function" ? value() : value, () => {}]; },
	useEffect() {},
	useLayoutEffect() {},
	useRef(value) { return { current: value ?? null }; },
	useCallback(fn) { return fn; },
	useMemo(fn) { return fn(); }
};
globalThis.window = {
	__ModuleLoader__: { load(record) { moduleRecord = record; } }
};

// Load the client half exactly the way the browser loader does.
new Function("window", "require", source)(globalThis.window, (id) => {
	if (id === "react") return react;
	if (id === "react-dom") return { createPortal: (node) => node };
	throw new Error(`unexpected require: ${id}`);
});

check("registers itself with the module loader", moduleRecord?.id === "dsh-quote", moduleRecord?.id);
check("the loader record carries a factory", typeof moduleRecord?.factory === "function");

const client = moduleRecord.factory((id) => {
	if (id === "react") return react;
	if (id === "react-dom") return { createPortal: (node) => node };
	throw new Error(`unexpected require: ${id}`);
});
check("returns the declared injection list", Array.isArray(client?.inject) && client.inject.length === 1 && client.inject[0] === "slots", JSON.stringify(client?.inject));
check("exposes apply()", typeof client?.apply === "function");

client.apply({
	slots: {
		inject(name, callback) { callback(); },
		register(slot, component) { registrations.push({ slot, component }); }
	}
});

console.log("slot registrations");
const activity = registrations.find((entry) => entry.slot.name === "conversation.input.activity");
const bundleConfig = registrations.find((entry) => entry.slot.name === "plugins.bundle.config");
const rowConfig = registrations.find((entry) => entry.slot.name === "plugins.row.config");
check("the composer activity seat is taken", activity !== undefined && activity.slot.id === "dsh-quote", activity?.slot.id);
check("the activity seat keeps a low order", typeof activity?.slot.order === "number", activity?.slot.order);
check("the activity seat renders the bridge", typeof activity?.component === "function");
check("bundle config slot is keyed by the package", bundleConfig?.slot.key === "dsh-quote", bundleConfig?.slot.key);
check("row config slot is keyed by package#row", rowConfig?.slot.key === "dsh-quote#quote", rowConfig?.slot.key);
check("exactly three slots are registered", registrations.length === 3, String(registrations.length));
check("no removed slot name is registered", !registrations.some((entry) => !["conversation.input.activity", "plugins.bundle.config", "plugins.row.config"].includes(entry.slot.name)));

console.log("settings surface");
const summary = bundleConfig.component({ view: "summary" });
check("summary view is a one-liner", typeof summary === "string" && summary.length > 0, String(summary));
const page = bundleConfig.component({ view: "page" });
check("page view returns a rendered element", page !== null && typeof page === "object" && typeof page.type === "function", typeof page);
const form = page.type({});
check("the form component returns a tree", form !== null && typeof form === "object" && form.type === "div", typeof form);
check("the form uses the plugin's own styled container", form?.props?.className === "dsh-quote-form", form?.props?.className);
check("the row card shows the same surface", rowConfig.component({ view: "summary" }) === summary);

console.log("test hook");
const hook = client.__test;
check("the formatting hook is exported for the logic test", hook !== undefined && typeof hook.buildQuoteText === "function");
check("the hook carries the defaults", hook?.DEFAULT_CONFIG?.enabled === true && typeof hook.DEFAULT_CONFIG?.hotkey === "string", JSON.stringify(hook?.DEFAULT_CONFIG));
check("both dictionaries ship", typeof hook?.dictionaries?.en?.quote === "string" && typeof hook?.dictionaries?.ru?.quote === "string");

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
