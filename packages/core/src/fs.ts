import { mount, File, serializer } from "controlled-fs";
import { z } from "zod";

export const structure = z.record(
	z.string().describe("Course name"),
	z.object({
		homeworks: z.record(
			z.string().describe("Homework name"),
			z.object({
				"snapshot.jpg": File(z.instanceof(Buffer), ...serializer.buffer),
				attachments: z.record(
					z.string().describe("Instruction attachment"),
					File(z.instanceof(Buffer), ...serializer.buffer),
				),
				files: z.record(
					z.string().describe("Your uploaded file"),
					File(z.instanceof(Buffer), ...serializer.buffer),
				),
			}),
		),
		materials: z.record(
			z.string().describe("Material name"),
			File(z.instanceof(Buffer), ...serializer.buffer),
		),
	}),
);

export const create = (root: string) => mount(root, structure);
