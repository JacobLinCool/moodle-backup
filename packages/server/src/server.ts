import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Exporter } from "moodle-backup-core";
import express from "express";
import { Server, Socket } from "socket.io";
import debug from "debug";
import { PORT, MOODLE_URL, FILE_RETENTION, MAX_CONCURRENCY } from "./config";
import { fs } from "./fs";
import { zip } from "./zip";
import { Lock } from "./lock";

const log = debug("server");

const download_lock = new Lock(MAX_CONCURRENCY);
const export_lock = new Lock(MAX_CONCURRENCY);

const frontend = readFileSync(path.join(__dirname, "..", "frontend", "index.html"), "utf8");

const app = express()
	.get("/", (req, res) => {
		res.send(frontend);
	})
	.get("/bundled/:id", async (req, res) => {
		const id = req.params.id;
		if (!fs[id]["bundled.zip"].$exists) {
			res.status(404).json({ message: "Not found" });
			return;
		}
		await download_lock.lock();
		res.download(fs[id]["bundled.zip"].$path, () => {
			download_lock.unlock();
		});
		const record = fs[id].record.$data;
		fs[id].record.$data = {
			username: record?.username || "",
			exported: record?.exported || 0,
			downloaded: (record?.downloaded || 0) + 1,
		};
	});

const exporters = new Map<
	string,
	[exporter: Exporter, state: "waiting" | "running", sockets: Socket[]]
>();

const server = app.listen(PORT, () => {
	log(`Server listening on port ${PORT}`);
});
const io = new Server(server);
io.on("connection", (socket) => {
	log("Client connected");
	socket.on("export", async (data: { username: string; password: string }) => {
		const id = hash(MOODLE_URL, data.username, data.password);
		log(`Exporting for ${id} (${MOODLE_URL}, ${data.username})`);

		if (fs[id]["bundled.zip"].$exists) {
			socket.emit("message", { id, state: "done", message: "Done" });
			return;
		}
		if (exporters.has(id)) {
			const [_, state, sockets] = exporters.get(id)!;
			socket.emit("message", { id, state, message: "Triggered" });
			sockets.push(socket);
			return;
		}

		await export_lock.lock();
		const record = fs[id].record.$data;
		fs[id].record.$data = {
			username: data.username,
			exported: (record?.exported || 0) + 1,
			downloaded: record?.downloaded || 0,
		};

		let failed = false;
		const exporter = new Exporter(MOODLE_URL, data.username, data.password, fs[id].temp.$path);
		exporters.set(id, [exporter, "waiting", [socket]]);
		broadcast(id, "message", { id, state: "waiting", message: "Waiting ..." });

		let progress = 0;
		exporter.on("progress", (p) => (progress = p * 100));
		exporter.on("info", (message) => {
			message = progress + "% " + message.replace(fs[id].temp.$path, "");
			broadcast(id, "message", { id, state: "running", message });
			log(id, "[info]", message);
		});
		exporter.on("success", (message) => {
			message = progress + "% " + message.replace(fs[id].temp.$path, "");
			broadcast(id, "message", { id, state: "running", message });
			log(id, "[success]", message);
		});
		exporter.on("warn", (message) => {
			message = progress + "% " + message.replace(fs[id].temp.$path, "");
			broadcast(id, "message", { id, state: "running", message });
			log(id, "[warn]", message);
		});
		exporter.on("error", (error) => {
			broadcast(id, "message", {
				id,
				state: "running",
				message: error.message.replace(fs[id].temp.$path, ""),
			});
			log(id, "[error]", error);
			exporters.delete(id);
			failed = true;
		});

		await exporter.run();
		if (failed) {
			return;
		}
		broadcast(id, "message", { id, state: "running", message: "Compressing ..." });
		await zip(fs[id].temp.$path, fs[id]["bundled.zip"].$path);
		broadcast(id, "message", { id, state: "done", message: "Done" });
		exporters.delete(id);
		log(id, "[done]");
		fs[id].temp.$remove();
		export_lock.unlock();
		setTimeout(() => fs[id]["bundled.zip"].$remove(), FILE_RETENTION);
	});
});

function hash(...args: string[]): string {
	const hex = createHash("sha256").update(args.join("")).digest("hex");
	const int = BigInt("0x" + hex);
	return int.toString(36).slice(0, 10);
}

function broadcast(id: string, event: string, ...args: any[]) {
	const sockets = exporters.get(id)?.[2];
	if (sockets) {
		sockets.forEach((socket) => socket.emit(event, ...args));
	}
}

process.on("SIGINT", () => {
	log("SIGINT");
	server.close();
	process.exit();
});

process.on("SIGTERM", () => {
	log("SIGTERM");
	server.close();
	process.exit();
});
