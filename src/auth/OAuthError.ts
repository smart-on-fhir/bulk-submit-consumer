
type OAuthErrorType =

    /**
     * The request is missing a required parameter, includes an unsupported
     * parameter value (other than grant type), repeats a parameter,
     * includes multiple credentials, utilizes more than one mechanism for
     * authenticating the client, or is otherwise malformed.
     */
    "invalid_request" |

    /**
     * Client authentication failed (e.g., unknown client, no client
     * authentication included, or unsupported authentication method). The
     * authorization server MAY return an HTTP 401 (Unauthorized) status
     * code to indicate which HTTP authentication schemes are supported. If
     * the client attempted to authenticate via the "Authorization" request
     * header field, the authorization server MUST respond with an HTTP 401
     * (Unauthorized) status code and include the "WWW-Authenticate"
     * response header field matching the authentication scheme used by the
     * client.
     */
    "invalid_client" |

    /**
     * The provided authorization grant (e.g., authorization code, resource
     * owner credentials) or refresh token is invalid, expired, revoked,
     * does not match the redirection URI used in the authorization request,
     * or was issued to another client.
     */
    "invalid_grant" |

    /**
     * The authenticated client is not authorized to use this authorization
     * grant type.
     */
    "unauthorized_client" |

    /**
     * The authorization grant type is not supported by the authorization
     * server.
     */
    "unsupported_grant_type" |

    /**
     * The requested scope is invalid, unknown, malformed, or exceeds the
     * scope granted by the resource owner.
     */
    "invalid_scope";


export class OAuthError extends Error {
    type: OAuthErrorType;
    code: number;

    constructor(type: OAuthErrorType, message: string, code: number) {
        super(message);
        this.type = type;
        this.code = code;
    }
}

export class UnsupportedGrantTypeError extends OAuthError {
    constructor(message: string) {
        super("unsupported_grant_type", message, 400);
    }
}

export class UnauthorizedClientError extends OAuthError {
    constructor(message: string) {
        super("unauthorized_client", message, 403);
    }
}

export class InvalidGrantError extends OAuthError {
    constructor(message: string) {
        super("invalid_grant", message, 403);
    }
}

export class InvalidScopeError extends OAuthError {
    constructor(message: string) {
        super("invalid_scope", message, 403);
    }
}

export class InvalidRequestError extends OAuthError {
    constructor(message: string) {
        super("invalid_request", message, 400);
    }
}

export class InvalidClientError extends OAuthError {
    constructor(message: string) {
        super("invalid_client", message, 401);
    }
}
