import { Request, Response } from "express"
import jwt                   from "jsonwebtoken"
import jwkToPem              from "jwk-to-pem"
import {
    asyncRouteWrap,
    getPublicKeys,
    getRequestBaseURL,
    negotiateScopes,
    requireUrlEncodedPost
} from "./lib";
import {
    InvalidGrantError,
    InvalidRequestError,
    InvalidScopeError,
    UnsupportedGrantTypeError
} from "./OAuthError";
import {
    ACCESS_TOKEN_LIFETIME,
    ASSERTION_TYPE_JWT_BEARER,
    GRANT_TYPE_CLIENT_CREDENTIALS,
    JWT_SECRET,
    SUPPORTED_ALGORITHMS
} from "../config";


function validateTokenRequest(req: Request): void {
    
    requireUrlEncodedPost(req);

    const { grant_type, client_assertion_type, client_assertion } = req.body;

    // grant_type --------------------------------------------------------------
    if (!grant_type) {
        throw new InvalidGrantError("Missing grant_type parameter");
    }

    if (grant_type != GRANT_TYPE_CLIENT_CREDENTIALS) {
        throw new UnsupportedGrantTypeError(
            `The grant_type parameter should equal '${GRANT_TYPE_CLIENT_CREDENTIALS}'`
        );
    }

    // client_assertion_type ---------------------------------------------------
    if (!client_assertion_type) {
        throw new InvalidRequestError("Missing client_assertion_type parameter");
    }

    if (client_assertion_type !== ASSERTION_TYPE_JWT_BEARER) {
        throw new InvalidRequestError(
            `Invalid client_assertion_type parameter. Must be '${ASSERTION_TYPE_JWT_BEARER}'.`
        );
    }

    // client_assertion must be a token ----------------------------------------
    if (!client_assertion) {
        throw new InvalidRequestError("Missing client_assertion parameter");
    }
}

function getAuthToken(client_assertion: string, req: Request) {
    const authenticationToken = jwt.decode(client_assertion, { complete: true, json: true });
    
    if (!authenticationToken) {
        // client_assertion must be a token
        throw new InvalidRequestError("Invalid registration token");
    }
    
    const  { kid, jku }       = authenticationToken.header;
    const { sub, iss, aud }   = authenticationToken.payload as jwt.JwtPayload;

    if (!kid) {
        throw new InvalidRequestError(
            "The registration token header must have a kid header"
        );
    }

    // The client_id must be a token -------------------------------------------
    if (!sub || sub !== iss) {
        throw new InvalidRequestError(
            "The client ID must be set at both the iss and sub claims of the " +
            "registration token"
        );
    }

    // -------------------------------------------------------------------------
    // Get the client
    // -------------------------------------------------------------------------
    const client = jwt.decode(sub as string, { json: true });
    if (!client) {
        throw new InvalidRequestError("Invalid client ID");
    }

    // Validate authenticationToken.aud (must equal this url) ------------------
    const baseUrl = getRequestBaseURL(req)
    const tokenUrl = baseUrl + req.originalUrl;
    if (tokenUrl.replace(/^https?/, "") !== String(aud).replace(/^https?/, "")) {
        throw new InvalidGrantError(`Invalid token 'aud' claim. Must be '${tokenUrl}'.`);
    }

    // If the jku header is present, verify that the jku is whitelisted
    // (i.e., that it matches the value supplied at registration time for
    // the specified `client_id`). If the jku header is not whitelisted, the
    // signature verification fails.
    if (jku && jku !== client.jwks_url) {
        throw new InvalidGrantError(
            `The provided jku '${jku}' is different than the one used at ` +
            `registration time (${client.jwks_url})`
        );
    }

    return {
        payload: authenticationToken.payload as jwt.JwtPayload,
        header: authenticationToken.header as jwt.JwtHeader,
        client
    };
}

// Attempt to verify the token using each public key until one succeeds
function verifyJwk(token: string, publicKeys: any[]) {
    if (publicKeys.some(key => {
        try {
            jwt.verify(token, jwkToPem(key), { algorithms: SUPPORTED_ALGORITHMS })
            return true
        } catch {
            return false
        }
    })) return true;

    throw new InvalidGrantError(
        "Unable to verify the token with any of the public keys found for this client"
    );
}

export const tokenHandler = asyncRouteWrap(async (req: Request, res: Response) => {

    validateTokenRequest(req);

    const { client_assertion, scope } = req.body;

    const {
        payload: authenticationTokenPayload,
        header : authenticationTokenHeaders,
        client
    } = getAuthToken(client_assertion, req);

    // Get the "kid" from the authentication token headers
    let kid = authenticationTokenHeaders.kid!;

    const publicKeys = await getPublicKeys({
        kid,
        jwks_url: client.jwks_url,
        jwks    : client.jwks
    });

    // Attempt to verify the JWK using each key in the potential keys list.
    verifyJwk(client_assertion, publicKeys);

    if (!scope) {
        throw new InvalidRequestError("Missing scope parameter");
    }

    const grantedScopes = negotiateScopes(scope)
        
    if (!grantedScopes.length) {
        throw new InvalidScopeError(
            `No access could be granted for scopes "${scope}".`
        );
    }

    res.json(createAccessToken({
        authenticationToken: authenticationTokenPayload,
        grantedScopes
    }));
});


function createAccessToken({
    authenticationToken,
    grantedScopes
}: {
    authenticationToken: jwt.JwtPayload
    grantedScopes: string[]
}) {
    const tokenBody: any = {
        // Fixed value: bearer
        token_type: "bearer",

        // Scope of access authorized. Note that this can be different from
        // the scopes requested by the app.
        scope: grantedScopes.join(" "),

        // 
        client_id: authenticationToken.sub,
        
        // The lifetime in seconds of the access token. The recommended
        // value is 300, for a five-minute token lifetime.
        expires_in: ACCESS_TOKEN_LIFETIME
    };

    tokenBody.access_token = jwt.sign(
        tokenBody,
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_LIFETIME }
    );

    return tokenBody;
}
