import { mount, File, serializer } from "controlled-fs";
import { z } from "zod";

export const structure = z.record(
	z.string(),
	z.record(z.string(), z.record(z.string(), File(z.instanceof(Buffer), ...serializer.buffer))),
);

export const create = (root: string) => mount(root, structure);
