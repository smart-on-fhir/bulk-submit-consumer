import { debuglog }               from "util";
import { Request, Response }      from "express";
import { Identifier, Parameters } from "fhir/r4";
import { createOperationOutcome } from "./utils";
import DB                         from "./db";
import { Job }                    from "./Job";
import { BASE_URL }               from "./config";


const log = debuglog("app:bulkSubmitHandler");

/**
 * System of http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status, code of
 * in-progress (default if parameter is omitted), complete or aborted.
 * Once a request has been submitted with a submissionStatus of aborted or
 * complete, no additional requests may be submitted for that submitter and
 * submissionId combination.
 */
type SubmissionStatus = 'in-progress' | 'complete' | 'aborted';


export default async function bulkSubmitHandler(req: Request, res: Response) {

    // The request body SHALL be a FHIR Parameters resource
    const parameters = req.body as Parameters;

    // Validate parameters
    if (!parameters || !parameters.parameter) {
        res.status(400).send('Invalid request body. Expected a FHIR Parameters resource.');
        return;
    }

    // submitter ---------------------------------------------------------------
    // Validate the submitter parameter (1..1)
    // The submitter must match a system and code specified by the Data Recipient
    // (coordinated out-of-band or in an implementation guide specific to a use case).
    const submitterParam = parameters.parameter.find(p => p.name === 'submitter');
    if (!submitterParam || !submitterParam.valueIdentifier) {
        res.status(400).send('Missing or invalid submitter parameter');
        return;
    }

    // submissionId ------------------------------------------------------------
    // Validate the submissionId parameter (1..1)
    // The value must be unique for the submitter.
    const submissionIdParam = parameters.parameter.find(p => p.name === 'submissionId');
    if (!submissionIdParam || !submissionIdParam.valueString) {
        res.status(400).send('Missing or invalid submissionId parameter');
        return;
    }

    // submissionStatus --------------------------------------------------------
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

    // manifestUrl -------------------------------------------------------------
    // Validate the manifestUrl parameter (0..1)
    // Url pointing to a Bulk Export Manifest with a pre-coordinated FHIR data
    // set. Files in multiple submitted manifests with the same submitter and
    // submissionId SHALL be treated by the Data Recipient as if they were
    // submitted in a single manifest. This parameter MAY be omitted when the
    // operation is being called to set the submissionStatus to complete or
    // aborted.
    const manifestUrlParam = parameters.parameter.find(p => p.name === 'manifestUrl');
    const manifestUrl = manifestUrlParam?.valueString || manifestUrlParam?.valueUri || "";

    // replacesManifestUrl -----------------------------------------------------
    // Validate the replacesManifestUrl parameter (0..1)
    const replacesManifestUrlParam = parameters.parameter.find(p => p.name === 'replacesManifestUrl');
    const replacesManifestUrl = replacesManifestUrlParam?.valueString || replacesManifestUrlParam?.valueUri || "";

    // Constraint: At least one of the submissionStatus and manifestUrl parameters SHALL be populated.
    if (!submissionStatusParam?.valueCoding?.code && !manifestUrl) {
        res.status(400).send('Either submissionStatus or manifestUrl SHALL be populated');
        return;
    }

    // outputFormat ------------------------------------------------------------
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

    // FHIRBaseUrl -------------------------------------------------------------
    const fhirBaseUrlParam = parameters.parameter.find(p => p.name === 'FHIRBaseUrl');
    const FHIRBaseUrl = fhirBaseUrlParam?.valueString || fhirBaseUrlParam?.valueUri || "";
    if (!FHIRBaseUrl && manifestUrl) {
        res.status(400).send('Missing or invalid FHIRBaseUrl parameter');
        return;
    }

    // fileRequestHeader -------------------------------------------------------
    /*
        {
        "parameter": [{
            "name": "fileRequestHeader",
            "part": [{
                "name": "headerName",
                "valueString": "a-headerName"
            },{
                "name": "headerValue",
                "valueString": "a-value"
            }]
        },{
            "name": "fileRequestHeaders",
            "part": [{
            "name": "headerName",
            "valueString": "b-headerName"
            },{
            "name": "headerValue",
            "valueString": "b-value"
            }]
        }] 
        }
    */
    const fileRequestHeaderParams = parameters.parameter.filter(p => p.name === 'fileRequestHeader');
    const fileRequestHeaders = (fileRequestHeaderParams.map(p => {
        const name = p.part?.find(part => part.name === 'headerName')?.valueString;
        const value = p.part?.find(part => part.name === 'headerValue')?.valueString;
        return name && value ? { name, value } : null;
    }).filter(Boolean) as { name: string; value: string }[]).reduce((acc, curr) => {
        acc[curr.name] = curr.value;
        return acc;
    }, {} as Record<string, string>);


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
            FHIRBaseUrl,
            fileRequestHeaders
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
            FHIRBaseUrl,
            fileRequestHeaders
        });
    }

    // -------------------------------------------------------------------------
    // Replace existing Job Manifest
    // -------------------------------------------------------------------------
    if (action === 'replace') {
        return await replaceManifest({
            response: res,
            submitter: submitterParam.valueIdentifier!,
            submissionId: submissionIdParam.valueString!,
            replacesManifestUrl,
            manifestUrl,
            outputFormat,
            FHIRBaseUrl,
            fileRequestHeaders
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
    outputFormat,
    FHIRBaseUrl,
    fileRequestHeaders
}: {
    submitter: Identifier
    submissionId: string
    response: Response
    manifestUrl: string
    outputFormat: string
    FHIRBaseUrl: string
    fileRequestHeaders?: Record<string, string>
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
        FHIRBaseUrl,
        fileRequestHeaders,
        onError: (error) => submission.statusManifest.addError(error as any, manifestUrl)
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
    outputFormat,
    FHIRBaseUrl,
    fileRequestHeaders
}: {
    submitter: Identifier
    submissionId: string
    response: Response
    manifestUrl: string
    outputFormat: string
    FHIRBaseUrl: string
    fileRequestHeaders?: Record<string, string>
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

    // Add job if needed
    if (submission.jobs.size === 0) {
        const job = new Job({
            // submitter,
            submissionId,
            manifestUrl,
            outputFormat,
            kickoffUrl: `${BASE_URL}/$bulk-submit`,
            onError: (error) => submission.statusManifest.addError(error as any, manifestUrl),
            FHIRBaseUrl,
            fileRequestHeaders
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
    response,
    submitter,
    submissionId,
    replacesManifestUrl,
    manifestUrl,
    outputFormat,
    FHIRBaseUrl,
    fileRequestHeaders
}: {
    response: Response
    submitter: Identifier
    submissionId: string
    replacesManifestUrl: string,
    manifestUrl: string
    outputFormat: string
    FHIRBaseUrl: string
    fileRequestHeaders?: Record<string, string>
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

    const jobToReplace = submission.getJobs().find((job) => {
        return job.manifestUrl === replacesManifestUrl;
    });

    if (!jobToReplace) {
        response.status(404).json(createOperationOutcome({
            severity   : 'error',
            code       : 'not-found',
            diagnostics: 'Job not found for the given manifestUrl'
        }));
        return;
    }

    const newJob = new Job({
        submissionId,
        manifestUrl,
        outputFormat,
        kickoffUrl: `${BASE_URL}/$bulk-submit`,
        onError: (error) => submission.statusManifest.addError(error as any, manifestUrl),
        FHIRBaseUrl,
        fileRequestHeaders
    });

    submission.addJob(newJob);

    jobToReplace.abort();

    await submission.statusManifest.removeManifestUrl(replacesManifestUrl);

    response.json(createOperationOutcome({
        severity   : 'information',
        code       : 'informational',
        diagnostics: `Job ${jobToReplace.jobId} replaced successfully with new Job ${newJob.jobId}.`
    }));
}
