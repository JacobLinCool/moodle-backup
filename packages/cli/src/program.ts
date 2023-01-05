import path from "node:path";
import ora from "ora";
import { config } from "dotenv";
import { program } from "commander";
import { Exporter } from "moodle-backup-core";

config();

program
	.name("Moodle Backup")
	.description("Backup your personal data from Moodle")
	.argument("[username]", "Moodle username", process.env.MOODLE_USERNAME)
	.argument("[password]", "Moodle password", process.env.MOODLE_PASSWORD)
	.option(
		"-m, --moodle <url>",
		"Moodle root URL",
		process.env.MOODLE_ROOT || "https://moodle3.ntnu.edu.tw/",
	)
	.option(
		"-d, --dir <path>",
		"Output directory",
		process.env.MOODLE_DIR || path.resolve("moodle"),
	)
	.action(async (username: string, password: string, opt: { moodle: string; dir: string }) => {
		if (username === undefined || password === undefined) {
			console.error("Missing username or password!");
			return;
		}

		const exporter = new Exporter(opt.moodle, username, password, opt.dir);

		const spinner = ora();
		let progress = 0;
		exporter.on("info", (msg) => spinner.start(`${progress * 100}% ${msg}`));
		exporter.on("success", (msg) => spinner.succeed(msg).start());
		exporter.on("error", (err) => spinner.fail(err.message));
		exporter.on("warn", (msg) => spinner.warn(msg).start());
		exporter.on("progress", (p) => (progress = p));

		await exporter.run();
		spinner.succeed("Done!");
	});

export { program };
