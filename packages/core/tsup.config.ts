import { defineConfig } from "tsup";

export default defineConfig(() => ({
	entry: ["src/index.ts"],
	outDir: "lib",
	target: "node16",
	format: ["cjs"],
	shims: true,
	clean: true,
	splitting: false,
	dts: true,
}));
