import path from "node:path";
import EventEmitter from "node:events";
import { chromium, Download, Page } from "playwright-core";
import TurndownService from "turndown";
import { create } from "./fs";
import { find_chrome } from "./chrome";

const td = new TurndownService();

export class Exporter extends EventEmitter {
	public options = { snapshot: false };
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

		page.addInitScript(() => {
			// @ts-ignore
			const styles = document.createElement("style");
			styles.innerHTML = ".accesshide { display: none; }";
			// @ts-ignore
			document.head.appendChild(styles);
		});

		try {
			this.emit("info", "Logging in ...");
			await this.login(page);
			this.emit("success", "Logged in!");

			this.emit("info", "Fetching courses ...");
			const courses = await this.courses(page);
			this.emit("success", `Fetched ${courses.length} courses!`);

			const downloads: Promise<void>[] = [];
			let completed = 0;
			for (const [course, id] of courses) {
				this.emit("info", `Fetching index of ${course}!`);
				const sections = (await this.parse_course(page, id)).filter(
					(section) => section.items.length > 0 || section.summary.length > 0,
				);
				this.emit("success", `Fetched index of ${course}!`);

				for (let i = 0; i < sections.length; i++) {
					const section = sections[i];
					const section_name = `${i}. ${section.name}`;
					this.emit(
						"info",
						`[${i + 1} of ${sections.length}] Backuping ${course}/${section.name} ...`,
					);
					this.fs[course][section_name]["README.md"].$data =
						`# ${section.name}\n\n` + section.summary;

					for (const item of section.items) {
						try {
							if (item.type === "assign") {
								const { snapshot, readme, files } = await this.parse_homework(
									page,
									item.id,
								);

								for (const [filename, download] of files) {
									const file =
										this.fs[course][section_name].homeworks[item.name].files[
											filename
										];
									downloads.push(
										download.saveAs(file.$path).then(() => {
											this.emit(
												"success",
												`Downloaded ${filename} to ${file.$path}`,
											);
										}),
									);
								}

								this.fs[course][section_name].homeworks[item.name][
									"snapshot.jpg"
								].$data = Buffer.from([]);
								this.fs[course][section_name].homeworks[item.name][
									"snapshot.jpg"
								].$data = snapshot;
								this.fs[course][section_name].homeworks[item.name][
									"README.md"
								].$data = readme;
							} else if (item.type === "resource") {
								const { filename, download } = await this.parse_resource(
									page,
									item.id,
								);

								const path =
									this.fs[course][section_name].resources[filename].$path;
								downloads.push(
									download.saveAs(path).then(() => {
										this.emit("success", `Downloaded ${filename} to ${path}`);
									}),
								);
							} else if (item.type === "forum") {
								const { discussions } = await this.parse_forum(page, item.id);

								for (const discussion of discussions) {
									this.fs[course][section_name].forums[item.name][
										discussion.name + ".md"
									].$data = discussion.content;
								}
							} else {
								this.emit("warn", `Skipping ${item.type} ${item.name} ...`);
							}
						} catch (err) {
							if (err instanceof Error) {
								this.emit("warn", `${item.name} ${err.message}`);
							}
						}
					}
				}

				this.emit("progress", Math.floor((++completed / courses.length) * 100) / 100);
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
			try {
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
					(await item.getByRole("link", { name: /(.*)/ }).first().getAttribute("href")) ||
					""
				).match(/id=(\d+)/)?.[1];
				if (name && id) {
					courses.push([clear(name), id]);
				}
			} catch (err) {
				if (err instanceof Error) {
					this.emit("warn", `Error parsing course: ${err.message}`);
				}
			}
		}

		return courses;
	}

	protected async parse_course(
		page: Page,
		course_id: string,
	): Promise<
		{
			name: string;
			summary: string;
			items: {
				name: string;
				type: string; // "assign" | "forum" | "resource" | "url" | "page" | ...
				id: string;
				description: string;
			}[];
		}[]
	> {
		await page.goto(`${this.moodle_root}/course/view.php?id=${course_id}`);

		const results: {
			name: string;
			summary: string;
			items: { name: string; type: string; id: string; description: string }[];
		}[] = [];

		const main = page.getByRole("main");
		const sections = await main.getByRole("region").all();

		for (const section of sections) {
			const name = (await section.getByRole("heading").first().textContent()) || "";
			const summary = td.turndown((await section.locator(".summary").textContent()) || "");
			const items: { name: string; type: string; id: string; description: string }[] = [];

			const activities = await section.locator(".activity").all();
			for (const activity of activities) {
				try {
					const link = activity.locator(".activityinstance > a");
					const name = (await link.textContent({ timeout: 20 })) || "";
					const sufix =
						(await link.locator(".accesshide").textContent({ timeout: 20 })) || "";
					const href = (await link.getAttribute("href", { timeout: 20 })) || "";
					const type = href.match(/mod\/(\w+)\//)?.[1];
					const id = href.match(/id=(\d+)/)?.[1];
					const description =
						(await activity
							.locator(".contentafterlink")
							.textContent({ timeout: 20 })
							.catch(() => "")) || "";

					if (type && id) {
						items.push({
							name: clear(name.replace(new RegExp(sufix + "$"), "")),
							type,
							id,
							description: td.turndown(description),
						});
					}
				} catch {}
			}

			results.push({ name: clear(name), summary: clear(summary), items });
		}

		return results;
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

	protected async parse_homework(
		page: Page,
		report_id: string,
	): Promise<{ snapshot?: Buffer; readme: string; files: [string, Download][] }> {
		await page.goto(`${this.moodle_root}/mod/assign/view.php?id=${report_id}`);

		const files: [string, Download][] = [];
		let snapshot: Buffer | undefined;
		if (this.options.snapshot) {
			snapshot = await page.getByRole("main").screenshot({ type: "jpeg" });
		}
		const readme = td.turndown(await page.locator("#intro").innerHTML());

		const items = page.getByRole("cell").getByRole("cell").locator("a[target=_blank]").all();
		for (const item of await items) {
			const name = ((await item.textContent()) || "").replace(/\s\s+/g, " ").trim();

			const downloaded = page.waitForEvent("download");
			await item.click();
			const download = await downloaded;
			files.push([clear(name || download.suggestedFilename()), download]);
		}

		return { snapshot, readme, files };
	}

	protected async parse_resource(
		page: Page,
		resource_id: string,
	): Promise<{
		filename: string;
		download: Download;
	}> {
		const downloaded = page.waitForEvent("download", { timeout: 10000 }).catch(() => undefined);
		const redirected = await page.evaluate(async (url: string) => {
			// @ts-ignore
			const res = await fetch(url);
			if (res.redirected === false) {
				return false;
			}
			const link = res.url;
			// @ts-ignore
			const a = document.createElement("a");
			a.href = link + "?forcedownload=1";
			a.click();
			return true;
		}, `${this.moodle_root}/mod/resource/view.php?id=${resource_id}`);
		if (redirected === false) {
			throw new Error("Resource is not downloadable: " + resource_id);
		}

		const download = (await downloaded) as Download;

		return {
			filename: download.suggestedFilename(),
			download,
		};
	}

	protected async parse_forum(
		page: Page,
		forum_id: string,
	): Promise<{
		discussions: { name: string; content: string }[];
	}> {
		await page.goto(`${this.moodle_root}/mod/forum/view.php?id=${forum_id}`);

		const discussions: { name: string; content: string }[] = [];

		const items = await Promise.all(
			(
				await page.getByRole("row").locator(".topic").getByRole("link").all()
			).map(async (item) => ({
				name: clear((await item.textContent()) || ""),
				href: await item.getAttribute("href"),
			})),
		);
		for (const item of items) {
			if (!item.href) {
				continue;
			}

			await page.goto(item.href);

			const content = td.turndown(
				await page.getByRole("main").locator("article").first().innerHTML(),
			);
			discussions.push({ name: item.name, content });
		}

		return { discussions };
	}

	on(event: "info", listener: (message: string) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
	on(event: "success", listener: (message: string) => void): this;
	on(event: "warn", listener: (message: string) => void): this;
	on(event: "progress", listener: (percent: number) => void): this;
	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	once(event: "info", listener: (message: string) => void): this;
	once(event: "error", listener: (error: Error) => void): this;
	once(event: "success", listener: (message: string) => void): this;
	once(event: "warn", listener: (message: string) => void): this;
	once(event: "progress", listener: (percent: number) => void): this;
	once(event: string, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	emit(event: "info", message: string): boolean;
	emit(event: "error", error: Error): boolean;
	emit(event: "success", message: string): boolean;
	emit(event: "warn", message: string): boolean;
	emit(event: "progress", percent: number): boolean;
	emit(event: string, ...args: any[]): boolean {
		return super.emit(event, ...args);
	}
}

function clear(text: string): string {
	return text.trim().replace(/[/\\?%*:|"<>]/g, "-");
}
