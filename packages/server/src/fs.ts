import { structure } from "core";
import { mount, File, serializer } from "controlled-fs";
import { z } from "zod";
import { DATA_DIR } from "./config";

export const fs = mount(
	DATA_DIR,
	z.record(
		z.string(),
		z.object({
			temp: structure,
			"bundled.zip": File(z.instanceof(Buffer), ...serializer.buffer),
			record: File(
				z.object({
					username: z.string(),
					exported: z.number(),
					downloaded: z.number(),
				}),
				...serializer.json,
			),
		}),
	),
);
