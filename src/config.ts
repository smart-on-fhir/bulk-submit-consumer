import 'dotenv/config';
import assert from "assert";
import { Algorithm } from 'jsonwebtoken';

export const PORT = process.env.PORT;

export const BASE_URL = process.env.BASE_URL;

export const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_TO_A_RANDOM_SECRET_FOR_PRODUCTION_USE";

export const ACCESS_TOKEN_LIFETIME = process.env.ACCESS_TOKEN_LIFETIME ?
    parseInt(process.env.ACCESS_TOKEN_LIFETIME) :
    300; // 5 minutes in seconds

export const PENDING_SUBMISSION_LIFETIME_HOURS = process.env.PENDING_SUBMISSION_LIFETIME_HOURS ?
    parseFloat(process.env.PENDING_SUBMISSION_LIFETIME_HOURS) :
    48;

export const COMPLETED_SUBMISSION_LIFETIME_HOURS = process.env.COMPLETED_SUBMISSION_LIFETIME_HOURS ?
    parseFloat(process.env.COMPLETED_SUBMISSION_LIFETIME_HOURS) :
    48;

export const MIME_URLENCODED               = "application/x-www-form-urlencoded";
export const GRANT_TYPE_CLIENT_CREDENTIALS = "client_credentials";
export const ASSERTION_TYPE_JWT_BEARER     = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
export const SUPPORTED_ALGORITHMS          = ["RS384", "RS512", "ES384", "ES512"] as Algorithm[];

assert(PORT, "PORT is not defined in environment variables");
assert(BASE_URL, "BASE_URL is not defined in environment variables");
assert(!BASE_URL.endsWith('/'), "BASE_URL must not end with a trailing slash");
