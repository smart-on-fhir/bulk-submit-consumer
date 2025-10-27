import 'dotenv/config';
import assert from "assert";

export const PORT = process.env.PORT;

export const BASE_URL = process.env.BASE_URL;

export const SUBMISSION_LIFETIME_HOURS = process.env.SUBMISSION_LIFETIME_HOURS ?
    parseInt(process.env.SUBMISSION_LIFETIME_HOURS) :
    48;

assert(PORT, "PORT is not defined in environment variables");
assert(BASE_URL, "BASE_URL is not defined in environment variables");
assert(!BASE_URL.endsWith('/'), "BASE_URL must not end with a trailing slash");
