import { NextFunction, Request, Response }         from "express";
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

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
    return function (req: Request, res: Response, next: NextFunction) {
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
