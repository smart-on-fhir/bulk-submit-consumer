import { NextFunction, Request, Response }          from "express"
import jwt                                          from "jsonwebtoken"
import { getRequestBaseURL, requireUrlEncodedPost } from "./lib"
import { InvalidRequestError }                      from "./OAuthError";
import { JWT_SECRET }                               from "../config";


function respond(req: Request, res: Response, next: NextFunction, context: any): void {
    if (req.headers.accept && req.accepts('text/html')) {
        res.render('register', context);
    } else {
        if (context.error) {
            next(context.error);
        } else {
            res.type('text/plain').end(context.token);
        }
    }
}

/**
 * Register and get a client_id, which in our case is also a JWT token.
 * The client should either provide a `jwks_url` (preferred) or a `jwks`.
 */
export function register(req: Request, res: Response, next: NextFunction): void {

    let jwks     = String(req.body.jwks     || "").trim();
    let jwks_url = String(req.body.jwks_url || "").trim();

    const context: {
        jwks     ?: string
        jwks_url ?: string
        error    ?: Error
        token    ?: string
        token_url : string
    } = {
        jwks,
        jwks_url,
        token_url: getRequestBaseURL(req) + '/token'
    }

    try {
        requireUrlEncodedPost(req);
    } catch (ex) {
        context.error = new InvalidRequestError((ex as Error).message);
        return respond(req, res, next, context);
    }
    
    if (!jwks && !jwks_url) {
        context.error = new InvalidRequestError("Either jwks or jwks_url is required");
        return respond(req, res, next, context);
    }

    if (jwks_url && jwks) {
        context.error = new InvalidRequestError("Provide either jwks or jwks_url, not both");
        return respond(req, res, next, context);
    }

    if (jwks_url) {
        try {
            new URL(jwks_url);
        } catch (ex) {
            context.error = new InvalidRequestError("Invalid jwks_url: " + (ex as Error).message);
            return respond(req, res, next, context);
        }
    }

    try {
        var jwksJSON = jwks ? JSON.parse(jwks) : undefined
    } catch (ex) {
        context.error = new InvalidRequestError("Cannot parse jwks as JSON: " + (ex as Error).message);
        return respond(req, res, next, context);
    }

    if (jwksJSON && (!jwksJSON.keys || !Array.isArray(jwksJSON.keys))) {
        context.error = new InvalidRequestError("The jwks must be a JSON object with a 'keys' array.");
        return respond(req, res, next, context);
    }

    // Build the result token
    let jwtToken: Record<string, any> = {
        jwks    : jwksJSON,
        jwks_url: jwks_url || undefined
    };

    const token = jwt.sign(jwtToken, JWT_SECRET);
    
    context.token = token;
    return respond(req, res, next, context);
};
