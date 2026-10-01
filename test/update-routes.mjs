/**
 * The updater's HTTP surface, which is the only part of this plugin that touches
 * the network. The plugin asks its own repository for the branch revision and
 * hands the pinned commit to the harness plugin manager; both halves are checked
 * here against a scripted GitHub and a stand-in manager.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { apply } from "../index.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** Mount the host half with the services a test needs. */
function mount({ pluginManager } = {}) {
	const routes = [];
	const services = { webServer: { register: (route) => { routes.push(route); return () => {}; } } };
	if (pluginManager !== undefined) services.pluginManager = pluginManager;

	const ctx = {
		effect: (callback) => callback(),
		inject: (deps, callback) => {
			const scope = {};
			if (deps.every((dep) => dep in services)) {
				for (const dep of deps) Object.defineProperty(scope, dep, { get: () => services[dep] });
				callback(scope);
			}
			return () => {};
		},
		webServer: services.webServer
	};

	process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-quote-update-"));
	apply(ctx, {});
	return routes;
}

/** Answer the two GitHub endpoints the check reads. */
function stubGithub({ version = "9.9.9", commits = [{ sha: "c".repeat(40), commit: { message: "make it better" } }] } = {}) {
	const real = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const target = String(url);
		if (target.includes("raw.githubusercontent.com")) return new Response(JSON.stringify({ version }), { status: 200 });
		if (target.includes("api.github.com")) return new Response(JSON.stringify(commits), { status: 200 });
		throw new Error(`unexpected fetch ${target}`);
	};
	return () => { globalThis.fetch = real; };
}

/** One request through a registered route. */
async function call(route, { method = "GET", url = route.path, address = "127.0.0.1" } = {}) {
	const request = new EventEmitter();
	request.url = url;
	request.method = method;
	request.headers = {};
	request.socket = { remoteAddress: address };
	process.nextTick(() => request.emit("end"));

	let body = "";
	const response = {
		statusCode: 0,
		headers: {},
		writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers ?? {}); return this; },
		end(chunk) { if (chunk !== undefined && chunk !== null) body += chunk.toString(); return this; }
	};
	await route.handler(request, response);
	await new Promise((resolve) => setTimeout(resolve, 5));
	return { status: response.statusCode, body: JSON.parse(body) };
}

test("the check compares the branch with the running version", async () => {
	const routes = mount();
	const route = routes.find((entry) => entry.path === "/api/dsh-quote/update");
	const restore = stubGithub();
	try {
		const { status, body } = await call(route);
		assert.equal(status, 200);
		assert.equal(body.current, manifest.version);
		assert.equal(body.latest, "9.9.9");
		assert.equal(body.updateAvailable, true);
		assert.equal(body.sha, "ccccccc");
		assert.equal(body.spec, "github:naletko/dsh-quote#ccccccc");
		assert.equal(body.manager, false, "no plugin manager in this composition");
	} finally {
		restore();
	}
});

test("the check refuses anything but a local GET", async () => {
	const routes = mount();
	const route = routes.find((entry) => entry.path === "/api/dsh-quote/update");
	assert.equal((await call(route, { method: "POST" })).status, 405);
	assert.equal((await call(route, { address: "10.0.0.7" })).status, 403);
});

test("applying hands the pinned revision to the plugin manager", async () => {
	const calls = [];
	const pluginManager = {
		installBundle: (spec, options) => {
			calls.push({ spec, options });
			return Promise.resolve({ stage: "install", status: "ok" });
		}
	};
	const routes = mount({ pluginManager });
	const route = routes.find((entry) => entry.path === "/api/dsh-quote/update/apply");
	const checkRoute = routes.find((entry) => entry.path === "/api/dsh-quote/update");
	const restore = stubGithub();
	try {
		const { status, body } = await call(route, { method: "POST" });
		assert.equal(status, 202);
		assert.equal(body.started, true);
		assert.equal(body.spec, "github:naletko/dsh-quote#ccccccc");

		await new Promise((resolve) => setTimeout(resolve, 30));
		const after = await call(checkRoute);
		assert.equal(after.body.progress.status, "done");
		assert.deepEqual(after.body.progress.outcome, { stage: "install", status: "ok" });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].spec, "github:naletko/dsh-quote#ccccccc");
		assert.match(calls[0].options.requestId, /^dsh-quote-update-/);
	} finally {
		restore();
	}
});

test("applying without a plugin manager explains the manual route", async () => {
	const routes = mount();
	const route = routes.find((entry) => entry.path === "/api/dsh-quote/update/apply");
	const restore = stubGithub();
	try {
		const { status, body } = await call(route, { method: "POST" });
		assert.equal(status, 409);
		assert.match(body.error, /plugin manager/i);
		assert.equal(body.spec, "github:naletko/dsh-quote#ccccccc");
	} finally {
		restore();
	}
});

test("an unreachable GitHub is reported as a failure, not as up to date", async () => {
	const routes = mount();
	const route = routes.find((entry) => entry.path === "/api/dsh-quote/update");
	const real = globalThis.fetch;
	globalThis.fetch = async () => new Response("nope", { status: 503 });
	try {
		const { status, body } = await call(route);
		assert.equal(status, 502);
		assert.match(body.error, /Cannot reach/);
	} finally {
		globalThis.fetch = real;
	}
});
