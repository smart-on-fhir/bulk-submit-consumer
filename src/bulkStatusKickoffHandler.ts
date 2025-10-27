import { Request, Response }      from "express";
import { Parameters }             from "fhir/r4";
import { createOperationOutcome } from "./utils";
import { BASE_URL }               from "./config";
import DB                         from "./db";


export default async function bulkStatusKickoffHandler(req: Request, res: Response): Promise<void> {
  
    // The request body SHALL be a FHIR Parameters resource
    const parameters = req.body as Parameters;

    // Validate the required parameters
    if (!parameters || !parameters.parameter) {
        res.status(400).json(createOperationOutcome({
            diagnostics: 'Invalid request body. Expected a FHIR Parameters resource.',
            severity   : 'error',
            code       : 'invalid'
        }));
        return;
    }

    // Validate the submitter parameter
    // The submitter must match a system and code specified by the Data Recipient
    // (coordinated out-of-band or in an implementation guide specific to a use case).
    const submitterParam = parameters.parameter.find(p => p.name === 'submitter');
    if (!submitterParam || !submitterParam.valueIdentifier) {
        res.status(400).json(createOperationOutcome({
            diagnostics: 'Missing or invalid submitter parameter',
            severity   : 'error',
            code       : 'invalid'
        }));
        return;
    }

    // Validate the submissionId parameter
    // The value must be unique for the submitter.
    const submissionIdParam = parameters.parameter.find(p => p.name === 'submissionId');
    if (!submissionIdParam || !submissionIdParam.valueString) {
        res.status(400).json(createOperationOutcome({
            diagnostics: 'Missing or invalid submissionId parameter',
            severity   : 'error',
            code       : 'invalid'
        }));
        return;
    }

    // Validate the _outputFormat parameter - the format for the generated bulk
    // data files used to return OperationOutcome resources related to the
    // submission status and, when applicable, other resources. Currently,
    // ndjson must be supported, though servers may choose to also support other
    // output formats. Servers SHALL support the full content type of
    // application/fhir+ndjson as well as abbreviated representations including
    // application/ndjson and ndjson. Defaults to application/fhir+ndjson.
    const outputFormatParam = parameters.parameter.find(p => p.name === '_outputFormat');
    const outputFormat = outputFormatParam?.valueString || 'application/fhir+ndjson';
    if (!['application/fhir+ndjson', 'application/ndjson', 'ndjson'].includes(outputFormat)) {
        res.status(400).json(createOperationOutcome({
            diagnostics: 'Invalid _outputFormat parameter. Only ndjson formats are supported by this server.',
            severity   : 'error',
            code       : 'invalid'
        }));
        return;
    }

    // Accept Header
    // Specifies the format of the optional FHIR OperationOutcome resource
    // response to the kick-off request. Currently, only application/fhir+json
    // is supported. A client SHOULD provide this header. If omitted, the server
    // MAY return an error or MAY process the request as if application/fhir+json
    // was supplied.
    const acceptHeader = req.header('Accept') || 'application/fhir+json';
    if (acceptHeader !== 'application/fhir+json') {
        res.status(400).json(createOperationOutcome({
            diagnostics: 'Invalid Accept header. Only application/fhir+json is supported by this server.',
            severity   : 'error',
            code       : 'invalid'
        }));
        return;
    }

    // Prefer Header
    // Specifies whether the response is immediate or asynchronous. Currently,
    // only a value of respond-async is supported. A client SHOULD provide this
    // header. If omitted, the server MAY return an error or MAY process the
    // request as if respond-async was supplied.
    const preferHeader = req.header('Prefer') || 'respond-async';
    if (preferHeader !== 'respond-async') {
        res.status(400).json(createOperationOutcome({
            diagnostics: 'Invalid Prefer header. Only respond-async is supported by this server.',
            severity   : 'error',
            code       : 'invalid'
        }));
        return;
    }

    // End of parameter validation
    // -------------------------------------------------------------------------

    // Find submission
    const submission = await DB.submissions.find({
        submissionId: submissionIdParam.valueString,
        submitter   : submitterParam.valueIdentifier
    });
    if (!submission) {
        res.status(404).json(createOperationOutcome({
            diagnostics: 'No submission found for the given submitter and submissionId',
            severity   : 'error',
            code       : 'not-found'
        }));
        return;
    }

    const statusUrl = `${BASE_URL}/$bulk-submit-status/${submission.slug}`;
    res.setHeader('Content-Location', statusUrl);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(202).json(createOperationOutcome({
        severity   : 'information',
        code       : 'informational',
        diagnostics: `Check job status at ${statusUrl}`
    }));
}
