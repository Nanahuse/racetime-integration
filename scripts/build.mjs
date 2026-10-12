import {build, context} from "esbuild";

const options = {
	entryPoints: ["src/extension/index.ts"],
	outfile: "extension/index.js",
	platform: "node",
	target: "node24",
	format: "cjs",
	bundle: true,
	packages: "external",
	sourcemap: true,
	footer: {js: "module.exports = module.exports.default;"},
};
if (process.argv.includes("--watch")) {
	await (await context(options)).watch();
} else {
	await build(options);
}
