import { randomUUID } from 'crypto';


export function generateSubmitterParam() {
    return { name: 'submitter', valueIdentifier: { value: randomUUID(), system: 'urn:uuid' } };
}

export function generateSubmissionIdParam() {
    return { name: 'submissionId', valueString: randomUUID() };
}

export function generateOutputFormatParam(format = "application/fhir+ndjson") {
    return { name: '_outputFormat', valueString: format };
}

export function generateSubmissionStatusParam(status: 'in-progress' | 'complete' | 'aborted') {
    return {
        name: 'submissionStatus',
        valueCoding: {
            system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
            code: status
        }
    };
}

export function generateManifestUrlParam(manifestUrl: string = `http://example.com/manifest/${randomUUID()}`) {
    return { name: 'manifestUrl', valueString: manifestUrl };
}

export function generateReplacesManifestUrl(manifestUrl: string = `http://example.com/manifest/${randomUUID()}`) {
    return { name: 'replacesManifestUrl', valueString: manifestUrl };
}
