import fs from "node:fs";

export function find_chrome(): string {
	const chrome_path = process.env.CHROME_PATH;
	if (chrome_path) {
		return chrome_path;
	}

	const candidates: Partial<Record<typeof process.platform, string[]>> = {
		win32: [
			"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files (x86)\\Google\\Chrome\\chrome.exe",
			"C:\\Program Files\\Google\\Chrome\\chrome.exe",
		],
		darwin: [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
		],
		linux: [
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/usr/bin/google-chrome-unstable",
			"/usr/bin/google-chrome-beta",
			"/usr/bin/google-chrome-dev",
			"/usr/bin/chromium-browser",
			"/usr/bin/chromium",
		],
	};

	let location = "";

	if (candidates[process.platform]) {
		for (const candidate of candidates[process.platform] as string[]) {
			if (fs.existsSync(candidate)) {
				location = candidate;
				break;
			}
		}
	}

	return location;
}
