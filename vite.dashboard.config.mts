import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";

export default defineConfig({
	base: "./",
	root: "ui/dashboard",
	plugins: [react()],
	build: {
		outDir: "../../dashboard",
		emptyOutDir: true,
		rollupOptions: {
			input: {"racetime-integration": "racetime-integration.html"},
		},
	},
});
