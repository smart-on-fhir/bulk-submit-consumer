import 'dotenv/config';
import assert from "assert";

export const PORT = process.env.PORT;

export const BASE_URL = process.env.BASE_URL;

export const PENDING_SUBMISSION_LIFETIME_HOURS = process.env.PENDING_SUBMISSION_LIFETIME_HOURS ?
    parseFloat(process.env.PENDING_SUBMISSION_LIFETIME_HOURS) :
    48;

export const COMPLETED_SUBMISSION_LIFETIME_HOURS = process.env.COMPLETED_SUBMISSION_LIFETIME_HOURS ?
    parseFloat(process.env.COMPLETED_SUBMISSION_LIFETIME_HOURS) :
    48;

assert(PORT, "PORT is not defined in environment variables");
assert(BASE_URL, "BASE_URL is not defined in environment variables");
assert(!BASE_URL.endsWith('/'), "BASE_URL must not end with a trailing slash");
