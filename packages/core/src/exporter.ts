import path from "node:path";
import EventEmitter from "node:events";
import { chromium, Download, Page } from "playwright-core";
import { create } from "./fs";
import { find_chrome } from "./chrome";

export class Exporter extends EventEmitter {
	protected moodle_root: string;
	protected username: string;
	protected password: string;
	protected fs: ReturnType<typeof create>;

	constructor(moodle_root: string, username: string, password: string, dir: string) {
		super();
		this.moodle_root = moodle_root;
		this.username = username;
		this.password = password;
		this.fs = create(path.resolve(dir));
	}

	async run() {
		const browser = await chromium.launch({
			executablePath: find_chrome() || undefined,
			headless: process.env.DEBUG !== "exporter",
		});
		const context = await browser.newContext({
			viewport: { height: 1920, width: 1080 },
		});
		const page = await context.newPage();

		try {
			this.emit("info", "Logging in ...");
			await this.login(page);
			this.emit("success", "Logged in!");

			this.emit("info", "Fetching courses ...");
			const courses = await this.courses(page);
			this.emit("success", `Fetched ${courses.length} courses!`);
			const downloads: Promise<void>[] = [];
			for (const [course, id] of courses) {
				this.emit("info", `Fetching homeworks for ${course} ...`);
				const homeworks = await this.homeworks(page, id);
				this.emit("success", `Fetched ${homeworks.length} homeworks for ${course}!`);

				for (const [homework, id] of homeworks) {
					this.emit("info", `Downloading files for ${course}/${homework} ...`);
					const { snapshot, files } = await this.download(page, id);

					for (const [filename, download] of files) {
						const file = this.fs[course].homeworks[homework].files[filename];
						file.$data = Buffer.from([]);
						downloads.push(
							download.saveAs(file.$path),
							download.failure().then((err) => {
								if (err === null) {
									this.emit("success", `Downloaded ${filename} to ${file.$path}`);
								} else {
									this.emit(
										"error",
										new Error(`Failed to download ${filename}, ${err}`),
									);
								}
							}),
						);
					}

					this.fs[course].homeworks[homework]["snapshot.jpg"].$data = snapshot;
				}
			}

			await Promise.all(downloads);
		} catch (err) {
			if (err instanceof Error) {
				this.emit("error", err);
			} else {
				this.emit("error", new Error("Unknown error"));
			}
		} finally {
			await browser.close();
		}
	}

	protected async login(page: Page): Promise<void> {
		await page.goto(this.moodle_root);
		await page.getByRole("link", { name: "" }).click();
		await page.getByRole("link", { name: "English ‎(en)‎" }).click();
		await page.getByPlaceholder("Username").click();
		await page.getByPlaceholder("Username").fill(this.username);
		await page.getByPlaceholder("Password").click();
		await page.getByPlaceholder("Password").fill(this.password);
		const logged_in = page.waitForNavigation();
		await page.getByRole("button", { name: "Log in" }).click();
		await logged_in;

		if (page.url().includes("login/index.php")) {
			throw new Error("Invalid credentials");
		}

		const language_changed = page.waitForNavigation();
		await page.getByRole("link", { name: "" }).click();
		await page.getByRole("link", { name: "English ‎(en)‎" }).click();
		await language_changed;
	}

	protected async courses(page: Page): Promise<[string, string][]> {
		await page.goto(`${this.moodle_root}/my/`);
		await page.waitForLoadState("networkidle");
		await page.getByRole("button", { name: "Display drop-down menu" }).click();
		await page.getByRole("link", { name: "Switch to list view" }).click();

		const courses: [string, string][] = [];

		const items = page
			.getByRole("complementary", { name: "Course overview" })
			.getByRole("list")
			.getByRole("listitem")
			.all();

		for (const item of await items) {
			const link = item.locator("a.coursename");
			const other_text1 =
				(await link.locator("[data-region='is-favourite']").textContent()) || "";
			const other_text2 = (await link.locator(".sr-only").last().textContent()) || "";
			const name = ((await link.textContent()) || "")
				.replace(other_text1, "")
				.replace(other_text2, "")
				.trim()
				.replace(/\s\s+/g, " ");
			const id = (
				(await item.getByRole("link", { name: /(.*)/ }).first().getAttribute("href")) || ""
			).match(/id=(\d+)/)?.[1];
			if (name && id) {
				courses.push([clear(name), id]);
			}
		}

		return courses;
	}

	protected async homeworks(page: Page, course_id: string): Promise<[string, string][]> {
		await page.goto(`${this.moodle_root}/grade/report/user/index.php?id=${course_id}`);

		const homeworks: [string, string][] = [];

		const items = page.getByRole("cell").getByRole("link").all();
		for (const item of await items) {
			const name = ((await item.textContent()) || "").replace(/\s\s+/g, " ").trim();
			const id = ((await item.getAttribute("href")) || "").match(/id=(\d+)/)?.[1];
			if (name && id) {
				homeworks.push([clear(name), id]);
			}
		}

		return homeworks;
	}

	protected async download(
		page: Page,
		report_id: string,
	): Promise<{ snapshot: Buffer; files: [string, Download][] }> {
		await page.goto(`${this.moodle_root}/mod/assign/view.php?id=${report_id}`);

		const files: [string, Download][] = [];
		const snapshot = await page.getByRole("main").screenshot({ type: "jpeg" });

		const items = page.getByRole("cell").getByRole("cell").locator("a[target=_blank]").all();
		for (const item of await items) {
			const name = ((await item.textContent()) || "").replace(/\s\s+/g, " ").trim();

			const downloaded = page.waitForEvent("download");
			await item.click();
			const download = await downloaded;
			files.push([clear(name || download.suggestedFilename()), download]);
		}

		return { snapshot, files };
	}

	on(event: "info", listener: (message: string) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
	on(event: "success", listener: (message: string) => void): this;
	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	once(event: "info", listener: (message: string) => void): this;
	once(event: "error", listener: (error: Error) => void): this;
	once(event: "success", listener: (message: string) => void): this;
	once(event: string, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	emit(event: "info", message: string): boolean;
	emit(event: "error", error: Error): boolean;
	emit(event: "success", message: string): boolean;
	emit(event: string, ...args: any[]): boolean {
		return super.emit(event, ...args);
	}
}

function clear(text: string): string {
	return text.replace(/[/\\?%*:|"<>]/g, "_");
}
