import { mount, File, serializer } from "controlled-fs";
import { z } from "zod";

export const structure = z.record(
	z.string().describe("Course name"),
	z.record(
		z.string().describe("Section name"),
		z.object({
			"README.md": File(z.string(), ...serializer.string),
			homeworks: z.record(
				z.string().describe("Homework name"),
				z.object({
					"snapshot.jpg": File(z.instanceof(Buffer), ...serializer.buffer),
					"README.md": File(z.string(), ...serializer.string),
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
			resources: z.record(
				z.string().describe("Resource name"),
				File(z.instanceof(Buffer), ...serializer.buffer),
			),
			forums: z.record(
				z.string().describe("Forum name"),
				z.record(
					z.string().describe("Discussion name"),
					File(z.string(), ...serializer.string),
				),
			),
		}),
	),
);

export const create = (root: string) => mount(root, structure);
