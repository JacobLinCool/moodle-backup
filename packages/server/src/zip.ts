import fs from "node:fs";
import archiver from "archiver";

export async function zip(dir: string, output: string) {
	const archive = archiver("zip", { zlib: { level: 9 } });
	const stream = fs.createWriteStream(output);

	return new Promise<void>((resolve, reject) => {
		archive
			.directory(dir, false)
			.on("error", (err) => reject(err))
			.pipe(stream);

		stream.on("close", () => resolve());
		archive.finalize();
	});
}
