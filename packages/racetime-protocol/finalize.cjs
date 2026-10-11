require("node:fs").writeFileSync(
	require("node:path").join(__dirname, "dist/cjs/package.json"),
	JSON.stringify({type: "commonjs"}),
);
