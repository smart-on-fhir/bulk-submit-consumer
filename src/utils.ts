import type Express                                from "express";
import { createHash }                              from "crypto";
import { OperationOutcome, OperationOutcomeIssue } from "fhir/r4";

export function createOperationOutcome({
    severity = 'error',
    code = 'processing',
    diagnostics,
}: {
    /** fatal | error | warning | information | success */
    severity?:  OperationOutcomeIssue["severity"];
    
    /** @see https://hl7.org/fhir/valueset-issue-type.html */
    code: OperationOutcomeIssue["code"];
    
    diagnostics?: OperationOutcomeIssue["diagnostics"]; 
}): OperationOutcome {
    return {
        resourceType: 'OperationOutcome',
        issue: [{
            severity,
            code,
            diagnostics,
        }]
    };
}

export function asyncHandler(fn: (req: Express.Request, res: Express.Response, next: Express.NextFunction) => Promise<any>) {
    return function (req: Express.Request, res: Express.Response, next: Express.NextFunction) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

export function hashString(input: string, algorithm: string = "sha256"): string {
    return createHash(algorithm).update(input).digest("hex");
}

export function roundToPrecision(num: number, precision: number): number {
    const factor = Math.pow(10, precision);
    return Math.round(num * factor) / factor;
}

export function getErrorMessage(err: any, depth = 0, maxDepth = 5, visited = new Set()): string {
    if (depth > maxDepth || !err || visited.has(err)) return '';
    visited.add(err);

    let message = '';

    // Extract the main error message
    if (typeof err === 'string') {
        message = err;
    } else if (err instanceof Error) {
        message = err.message || err.name;
    } else if (typeof err === 'object' && err !== null) {
        message = err.message || err.toString?.() || 'Unknown error';
    } else {
        message = 'Unknown error';
    }

    // Handle AggregateError (e.g., from fetch failures)
    if (err instanceof AggregateError && 'errors' in err && Array.isArray((err as any).errors)) {
        const subMessages = (err as any).errors
            .map((subErr: any) => getErrorMessage(subErr, depth + 1, maxDepth, visited))
            .filter((msg: string) => msg)
            .join('; ');
        if (subMessages) {
            message += ` (errors: ${subMessages})`;
        }
    }

    // Handle nested cause
    if (err.cause) {
        const causeMessage = getErrorMessage(err.cause, depth + 1, maxDepth, visited);
        if (causeMessage) {
            message += ` (caused by: ${causeMessage})`;
        }
    }

    return message;
}

export function headerToObject(headers: Headers | [string, string][] | Record<string, string>): Record<string, string> {
    const headersObj: Record<string, string> = {};
    const headersInit = headers;
    if (headersInit instanceof Headers) {
        headersInit.forEach((value, key) => {
            headersObj[key] = value;
        });
    } else if (Array.isArray(headersInit)) {
        headersInit.forEach(([key, value]) => {
            headersObj[key] = value;
        });
    } else if (headersInit && typeof headersInit === 'object') {
        Object.entries(headersInit).forEach(([key, value]) => {
            headersObj[key] = value as string;
        });
    }
    return headersObj;
}

interface RequestResult {
    res: Response | null
    request: {
        method : string,
        url    : string,
        headers: Record<string, string>,
        body   : any
    } | null,
    response: {
        headers   : Record<string, string>,
        body      : string | any | AsyncGenerator<any>, // text | json | ndjson | null
        status    : number,
        statusText: string,
    } | null
    error: string | null
}

export async function request(
    url: string | URL | Request,
    options: RequestInit & { parse?: boolean } = {}
): Promise<RequestResult> {

    const { parse, ...fetchOptions } = options;
    const _options: RequestInit = {
        ...fetchOptions,
        headers: {
            ...fetchOptions.headers
        }
    };

    let out: RequestResult = {
        res     : null,
        request : null,
        response: null,
        error   : null
    };

    try {
        out.request = {
            method : _options.method || 'GET',
            url    : url.toString(),
            headers: headerToObject(_options.headers || {}),
            body   : _options.body ? JSON.parse(_options.body.toString()) : null
        };

        out.res = await fetch(url, _options);

        out.response = {
            status    : out.res.status,
            statusText: out.res.statusText,
            headers   : headerToObject(out.res.headers),
            body      : null
        };

        // Error response from server
        if (out.response.status >= 400) {
            out.error = `Request to ${url} failed with status ${out.res.status} ${out.res.statusText}`;
        }

        else {
            if (parse) {
                const contentType = out.res.headers.get('content-type') || ''; 
                if (contentType.includes('application/json')) {
                    out.response.body = await out.res.json();
                } else if (contentType.includes('application/ndjson') || contentType.includes('ndjson') || contentType.includes('application/octet-stream')) {
                    out.response.body = streamNDJSON(out.res);
                } else {
                    out.response.body = await out.res.text();
                }
            }
        }

    } catch (err) {
        // console.error(err);
        out.error = `Request to ${url} failed: ${getErrorMessage(err)}`;
    }
    
    return out;
}

/**
 * Given a response with NDJSON content, returns an async generator that yields
 * each parsed JSON object.
 */
export async function *streamNDJSON(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Response body is null");
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last incomplete line
            for (const line of lines) {
                if (line.trim()) {
                    yield JSON.parse(line);
                }
            }
        }
        // Process any remaining complete line in buffer
        if (buffer.trim()) {
            yield JSON.parse(buffer);
        }
    } finally {
        reader.releaseLock();
    }
}