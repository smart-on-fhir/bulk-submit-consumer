import { debuglog }               from "util";
import { Request, Response }      from "express";
import { Identifier, Parameters } from "fhir/r4";
import { createOperationOutcome } from "./utils";
import DB                         from "./db";
import { Job }                    from "./Job";
import { BASE_URL } from "./config";


const log = debuglog("app:bulkSubmitHandler");

/**
 * System of http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status, code of
 * in-progress (default if parameter is omitted), complete or aborted.
 * Once a request has been submitted with a submissionStatus of aborted or
 * complete, no additional requests may be submitted for that submitter and
 * submissionId combination.
 */
type SubmissionStatus = 'in-progress' | 'complete' | 'aborted';

/*
Bulk Submit Operation Specification (Draft IG: https://hackmd.io/@argonaut/rJoqHZrPle)

## Request
POST [fhir base]/$bulk-submit

The request body SHALL be a FHIR Parameters resource with the following parameters:

| Parameter | Cardinality | Type | Description |
|-----------|-------------|------|-------------|
| FHIRBaseUrl | 1..1 | string (url) | Base url to be used by the Data Recipient when resolving relative references in the submitted resources. |
| fileRequestHeaders | 0..* | part | HTTP headers that the Data Recipient should use when requesting a data file from the Data Sender. |
| → headerName | 1..1 | string |  |
| → headerValue | 1..1 | string |  |
| oauthMetadataUrl | 0..* | string (url) | Location that a Data Recipient can use to obtain the information needed to retrieve files protected using OAuth 2.0. The url SHALL be the path to a FHIR Authorization Endpoint and Capabilities Discovery file or another OAuth 2.0 Protected Resource Metadata file that is registered in the IANA Well-Known URIs Registry. |
| fileEncryptionKey | 0..1 | part |  |
| → coding | 0..1 | Coding | If omitted, defaults to a system of http://hl7.org/fhir/uv/bulkdata/ValueSet/file-encryption-type and code of jwe |
| → value | 1..1 | string | For the system of file-encryption-type and code of jwe populate with the JSON Web Encryption structure to deliver a Content Encryption Key for the Data Recipient to decrypt retrieved data files from the Data Provider. Experimental, looking for feedback on the draft specification |
| metadata | 0..1 | part | Child parameters can be added under this parameter to pass pre-coordinated data relevant to the submission from the Data Provider to the Data Recipient. Each child parameter name SHALL be an absolute URL. |
| import | 0..1 | part | Child parameters can be added under this parameter to pass pre-coordinated options relevant to how the data will be processed from the Data Provider to the Data Recipient. For example, a Data Recipient may allow the Data Provider to specify whether or not existing data should be replaced with the data in the submission. Each child parameter name SHALL be an absolute URL. |


## Security
The Data Recipient SHOULD implement OAuth 2.0 access management in accordance with the SMART Backend Services Authorization Profile. When SMART Backend Services Authorization is used, the Data Provider SHALL use a token with a scope of system/bulk-submit when kicking off the bulk-submit operation.

If the oauthMetadataUrl parameter in the request is populated, the Data Recipient SHALL obtain and use a valid token when retrieving the manifest at the manifestUrl.

If the fileEncryptionKey parameter is set, the Data Provider SHALL use the key to encrypt files, and the Data Recipient SHALL decrypt them.

If fileRequestHeaders is included, the Data Recipient SHALL provide the listed headers when requesting files.

## Manifest
When populated, the manifestUrl parameter SHALL contain a url pointing to a valid Bulk Data Manifest. The manifest MAY contain a link field for additional manifests.

## Response - Success
- HTTP Status Code of 200 OK
- Optionally, a FHIR OperationOutcome resource in the body

## Response - Error
- HTTP Status Code of 4XX or 5XX
- The body SHALL be a FHIR OperationOutcome resource

If rate limiting, respond with 429 Too Many Requests and Retry-After header.
*/


export default async function bulkSubmitHandler(req: Request, res: Response) {

    // The request body SHALL be a FHIR Parameters resource
    const parameters = req.body as Parameters;

    // Validate parameters
    if (!parameters || !parameters.parameter) {
        res.status(400).send('Invalid request body. Expected a FHIR Parameters resource.');
        return;
    }

    // Validate the submitter parameter (1..1)
    // The submitter must match a system and code specified by the Data Recipient
    // (coordinated out-of-band or in an implementation guide specific to a use case).
    const submitterParam = parameters.parameter.find(p => p.name === 'submitter');
    if (!submitterParam || !submitterParam.valueIdentifier) {
        res.status(400).send('Missing or invalid submitter parameter');
        return;
    }

    // Validate the submissionId parameter (1..1)
    // The value must be unique for the submitter.
    const submissionIdParam = parameters.parameter.find(p => p.name === 'submissionId');
    if (!submissionIdParam || !submissionIdParam.valueString) {
        res.status(400).send('Missing or invalid submissionId parameter');
        return;
    }

    // Validate the submissionStatus parameter (0..1)
    // coding - System of http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status,
    // code of in-progress (default if parameter is omitted), complete or aborted.
    // Once a request has been submitted with a submissionStatus of aborted or
    // complete, no additional requests may be submitted for that submitter and
    // submissionId combination.
    const submissionStatusParam = parameters.parameter.find(p => p.name === 'submissionStatus');
    const validStatuses: SubmissionStatus[] = ['in-progress', 'complete', 'aborted'];
    const submissionStatus = (submissionStatusParam?.valueCoding?.code || 'in-progress') as SubmissionStatus;
    if (!validStatuses.includes(submissionStatus)) {
        res.status(400).send('Invalid submissionStatus parameter. Must be one of in-progress, complete, or aborted.');
        return;
    }

    // Validate the manifestUrl parameter (0..1)
    // Url pointing to a Bulk Export Manifest with a pre-coordinated FHIR data
    // set. Files in multiple submitted manifests with the same submitter and
    // submissionId SHALL be treated by the Data Recipient as if they were
    // submitted in a single manifest. This parameter MAY be omitted when the
    // operation is being called to set the submissionStatus to complete or
    // aborted.
    const manifestUrlParam = parameters.parameter.find(p => p.name === 'manifestUrl');
    const manifestUrl = manifestUrlParam?.valueString || manifestUrlParam?.valueUri || "";

    // Validate the replacesManifestUrl parameter (0..1)
    const replacesManifestUrlParam = parameters.parameter.find(p => p.name === 'replacesManifestUrl');
    const replacesManifestUrl = replacesManifestUrlParam?.valueString || replacesManifestUrlParam?.valueUri || "";

    // Constraint: At least one of the submissionStatus and manifestUrl parameters SHALL be populated.
    if (!submissionStatusParam?.valueCoding?.code && !manifestUrl) {
        res.status(400).send('Either submissionStatus or manifestUrl SHALL be populated');
        return;
    }

    // outputFormat parameter (0..1) string (MIME-type)
    // Could also look like "application/fhir+json; fhirVersion=4.0"
    const outputFormatParam = parameters.parameter.find(p => p.name === 'outputFormat');
    const outputFormat = outputFormatParam?.valueString || 'application/fhir+ndjson';
    if (!outputFormat.startsWith('application/fhir+ndjson') &&
        !outputFormat.startsWith('application/ndjson') &&
        !outputFormat.startsWith('ndjson')) {
        res.status(400).send('Invalid outputFormat parameter. Only ndjson formats are supported by this server.');
        return;

    }

    const action = getRequestedAction({
        submissionStatus,
        replacesManifestUrl
    });

    log(
        `Requested action: %j for submitter "%s|%s", submissionId %j`,
        action,
        submitterParam.valueIdentifier?.system,
        submitterParam.valueIdentifier?.value,
        submissionIdParam.valueString
    );

    // -------------------------------------------------------------------------
    // Abort Submission (abort all Jobs)
    // -------------------------------------------------------------------------
    if (action === 'abort') {
        return await abortSubmission({
            submitter: submitterParam.valueIdentifier!,
            submissionId: submissionIdParam.valueString!,
            response: res
        });
    }

    // -------------------------------------------------------------------------
    // Mark Submission Complete (commit all Jobs)
    // -------------------------------------------------------------------------
    if (action === 'complete') {
        return await completeSubmission({
            submitter: submitterParam.valueIdentifier!,
            submissionId: submissionIdParam.valueString!,
            response: res,
            manifestUrl,
            outputFormat,
        });
    }
    
    // -------------------------------------------------------------------------
    // Start new Job
    // -------------------------------------------------------------------------
    if (action === 'start') {
        return await startNewJob({
            submitter: submitterParam.valueIdentifier!,
            submissionId: submissionIdParam.valueString!,
            response: res,
            manifestUrl,
            outputFormat,
        });
    }

    // -------------------------------------------------------------------------
    // Replace existing Job Manifest
    // -------------------------------------------------------------------------
    if (action === 'replace') {
        return await replaceManifest({
            response: res
        });
    }
}

function getRequestedAction({
    submissionStatus,
    replacesManifestUrl
}: {
    submissionStatus: SubmissionStatus
    replacesManifestUrl?: string
}): 'abort' | 'complete' | 'start' | 'replace' {
    if (submissionStatus === 'aborted') {
        return 'abort';
    } else if (submissionStatus === 'complete') {
        return 'complete';
    } else {
        return replacesManifestUrl ? 'replace' : 'start';
    }
}

async function startNewJob({
    submitter,
    submissionId,
    response,
    manifestUrl,
    outputFormat
}: {
    submitter: Identifier
    submissionId: string
    response: Response
    manifestUrl: string
    outputFormat: string
}) {
    const submission = await DB.submissions.findOrCreate({ submissionId, submitter });

    // Once a request has been submitted with a submissionStatus of aborted or
    // complete, no additional requests may be submitted for that submitter and
    // submissionId combination.
    if (submission && (submission.status === 'aborted' || submission.status === 'complete')) {
        response.status(400).json(createOperationOutcome({
            severity   : 'error',
            code       : 'invalid',
            diagnostics: 'Submission is already complete or aborted'
        }));
        return;
    }

    const job = new Job({
        // submitter,
        submissionId,
        manifestUrl,
        outputFormat,
        kickoffUrl  : `${BASE_URL}/$bulk-submit`,
    });

    submission.addJob(job);

    await submission.start();

    response.json(createOperationOutcome({
        severity   : 'information',
        code       : 'informational',
        diagnostics: `Job ${job.jobId} started successfully! Submission: ${submission.slug}`
    }));
}

async function completeSubmission({
    submitter,
    submissionId,
    response,
    manifestUrl,
    outputFormat
}: {
    submitter: Identifier
    submissionId: string
    response: Response
    manifestUrl: string
    outputFormat: string
}) {
    const submission = await DB.submissions.findOrCreate({ submissionId, submitter });

    if (submission.status === 'complete' || submission.status === 'aborted') {
        response.status(400).json(createOperationOutcome({
            severity   : 'error',
            code       : 'invalid',
            diagnostics: 'Submission is already complete or aborted'
        }));
        return;
    }

    // TODO: Add job if needed
    if (submission.jobs.size === 0) {
        const job = new Job({
            // submitter,
            submissionId,
            manifestUrl,
            outputFormat,
            kickoffUrl: `${BASE_URL}/$bulk-submit`,
            onError: (error) => submission.statusManifest.addError(error as any, manifestUrl)
        });
    
        submission.addJob(job);

        await submission.start();
        await submission.complete();

        response.json(createOperationOutcome({
            severity   : 'information',
            code       : 'informational',
            diagnostics: `Job ${job.jobId} started successfully and marked as complete. Submission: ${submission.slug}`
        }));
    }

    else {
        await submission.complete();
        response.json(createOperationOutcome({
            severity: 'information',
            code: 'informational',
            diagnostics: `Submission ${submission.slug} marked as complete`
        }));
    }
}

async function abortSubmission({
    submitter,
    submissionId,
    response
}: {
    submitter: Identifier
    submissionId: string
    response: Response
}) {

    const submission = await DB.submissions.find({ submissionId, submitter });
    
    if (!submission) {
        response.status(404).json(createOperationOutcome({
            severity   : 'error',
            code       : 'not-found',
            diagnostics: 'Submission not found for the given submitter and submissionId'
        }));
        return;
    }

    if (submission.status === 'complete' || submission.status === 'aborted') {
        response.status(400).json(createOperationOutcome({
            severity   : 'error',
            code       : 'invalid',
            diagnostics: 'Submission is already complete or aborted'
        }));
        return;
    }

    await submission.abort();

    response.json(createOperationOutcome({
        severity: 'information',
        code: 'informational',
        diagnostics: `Submission ${submission.slug} marked as aborted`
    }));
}

async function replaceManifest({
    response
}: {
    response: Response
    // submitter: Identifier
    // submissionId: string
    // replacesManifestId: string
}) {
    response.status(400).json(createOperationOutcome({
        severity   : 'error',
        code       : 'not-supported',
        diagnostics: 'Manifest replacement is not yet implemented.'
    }));
}
