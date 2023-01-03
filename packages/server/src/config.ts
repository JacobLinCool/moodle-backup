import { config } from "dotenv";

config();

export const PORT = Number(process.env.PORT) || 3000;
export const DATA_DIR = process.env.DATA_DIR || "data";
export const MOODLE_URL = process.env.MOODLE_URL || "https://moodle3.ntnu.edu.tw/";
export const FILE_RETENTION = Number(process.env.FILE_RETENTION) || 1000 * 60 * 30;
export const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY) || 2;
