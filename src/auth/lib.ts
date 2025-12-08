import { NextFunction, Request, RequestHandler, Response } from "express";
import jwt                                                 from "jsonwebtoken";
import { InvalidGrantError, InvalidRequestError }          from "./OAuthError";
import { MIME_URLENCODED, JWT_SECRET }                     from "../config";

/**
 * Creates and returns a route-wrapper function that allows for using an async
 * route handlers without try/catch.
 */
export function asyncRouteWrap(
    fn: (req: Request, res: Response, next: NextFunction) => any
): RequestHandler {
    return (req, res, next) => {
        try {
            Promise.resolve(fn(req, res, next)).catch(next);
        } catch (err) {
            next(err);
        }
    };
}

/**
 * Given a request object, returns its base URL
 */
export function getRequestBaseURL(req: Request) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return protocol + "://" + host;
}

export async function getPublicKeys({ jwks_url, jwks, kid }: {
    jwks_url?: string
    jwks    ?: { keys: any[] }
    kid      : string
}) {
    const keys = [];

    if (jwks_url) {
        try {
            const keySet = await fetchJwksUrl(jwks_url)
            keys.push(...keySet.keys)
        } catch (ex) {
            throw new InvalidRequestError(
                `Unable to obtain public keys from ${jwks_url}: '${(ex as Error).message}'`
            );
        }
    }
    else if (jwks?.keys) {
        keys.push(...jwks.keys)
    }

    // Filter the potential keys to retain only those where the `kid` matches
    // the value supplied in the client's JWK header.
    var publicKeys = keys.filter((key: JsonWebKey) => {
        if (!Array.isArray(key.key_ops) || key.key_ops.indexOf("verify") === -1) {
            return false;
        }
        // return (key.kid === kid && key.kty === header.kty);
        // @ts-ignore
        return key.kid === kid;
    });

    if (!publicKeys.length) {
        throw new InvalidGrantError(
            `No public keys found in the JWKS with "kid" equal to "${kid}" and "verify" key_ops.`
        );
    }

    return publicKeys;
}

export async function fetchJson(input: string | URL | globalThis.Request, options?: RequestInit) {
    return fetch(input, options).then(res => res.json())
}

export async function fetchJwksUrl(input: string | URL | globalThis.Request, options?: RequestInit) {
    return fetchJson(input, options).then(json => {
        if (!Array.isArray(json.keys)) {
            throw new Error("The remote jwks object has no keys array.")
        }
        return json
    })
}

export function negotiateScopes(list: string) {
    const scopes = list.trim().split(/\s+/);
    return scopes.filter(s => s === "system/bulk-submit");
}

export function uInt(x: any, defaultValue = 0) {
    x = parseInt(x + "", 10);
    if (isNaN(x) || !isFinite(x) || x < 0) {
        x = uInt(defaultValue, 0);
    }
    return x;
}

export function requireUrlEncodedPost(req: Request) {
    // Require "application/x-www-form-urlencoded" POSTs
    if (!req.headers["content-type"] || req.headers["content-type"].indexOf(MIME_URLENCODED) !== 0) {
        throw new InvalidRequestError("Invalid request content-type header (must be '" + MIME_URLENCODED + "')");
    }
}

export function checkAuth(req: Request, res: Response, next: NextFunction) {
    if (req.headers.authorization) {
        const [authType, credentials] = req.headers.authorization.split(" ");
        try {
            // Authenticating with JWT token. In this case, the token contains
            // the registered client.
            if (authType.toLowerCase() === "bearer") {
                // Handle Bearer token
                var token = jwt.verify(
                    credentials,
                    JWT_SECRET,
                    { algorithms: ["HS256"] } // We use HS256 for signing access tokens
                ) as any;
                const client = jwt.decode(token.client_id);
                (req as any).registeredClient = client;
            }
            else {
                throw new Error("Unsupported authorization type");
            }
        } catch (e) {
            /* istanbul ignore next */
            if (process.env.NODE_ENV !== "test") {
                console.error(e); // Log the error for debugging unless in test mode
            }
            res.status(401).send("Unauthorized! Invalid authentication: " + (e as Error).message);
            return;
        }
    }

    next();
}