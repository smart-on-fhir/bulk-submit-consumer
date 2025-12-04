import request   from 'supertest';
import createApp from '../src/app';
import { randomUUID } from 'crypto';
import {
    generateSubmitterParam,
    generateSubmissionIdParam,
    generateOutputFormatParam,
    generateSubmissionStatusParam,
    generateManifestUrlParam,
    generateReplacesManifestUrl
} from './utils'


describe('Bulk Submit Validation', () => {

    it('Invalid body', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit')
          .send('invalid body')
          .expect(400)
          .expect(/Invalid request body/)

        await request(app)
          .post('/$bulk-submit')
          .send({})
          .expect(400)
          .expect(/Invalid request body/)
    });

    it('Missing submitter parameter', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [] })
          .expect(400)
          .expect(/Missing or invalid submitter parameter/);
    });

    it('Missing submissionId parameter', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [generateSubmitterParam()] })
          .expect(400)
          .expect(/Missing or invalid submissionId parameter/);
    });

    it ('Invalid submissionStatus parameter', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              generateSubmitterParam(),
              generateSubmissionIdParam(),
              generateSubmissionStatusParam("invalid-status" as any)
          ]})
          .expect(400)
          .expect(/Invalid submissionStatus parameter. Must be one of in-progress, complete, or aborted./);
    });

    it('Neither submissionStatus nor manifestUrl parameters', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              generateSubmitterParam(),
              generateSubmissionIdParam(),
          ]})
          .expect(400)
          .expect(/Either submissionStatus or manifestUrl SHALL be populated/);
    });

    // Once a request has been submitted with a submissionStatus of aborted or complete,
    // no additional requests may be submitted for that submitter and submissionId combination.
    it ('rejects attempts to start a job that is completed or aborted', async () => {
        const app = createApp();

        const submitterParam    = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        const fhirBaseUrlParam = { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" };
        
        // First, create a job and complete it
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              fhirBaseUrlParam,
              generateManifestUrlParam(),
              generateSubmissionStatusParam('complete')
          ]})
          // .expect(res => console.log(res.body))
          .expect(200);

        // Then, try to start it again
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              fhirBaseUrlParam,
              generateManifestUrlParam(),
              generateSubmissionStatusParam('in-progress')
          ]})
          .expect('content-type', /json/)
          .expect(400, /Submission is already complete or aborted/);
    });
});

describe('Bulk Submit Requests', () => {

    it('Can make new submission', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              { name: 'submitter', valueIdentifier: { value: randomUUID(), system: 'urn:uuid' } },
              { name: 'submissionId', valueString: randomUUID() },
              { name: 'manifestUrl', valueString: "http://example.com/manifest" },
              { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" },
              {
                name: 'submissionStatus',
                valueCoding: {
                  system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
                  code: "in-progress"
                }
              },
              { name: '_outputFormat', valueString: "application/fhir+ndjson" }
          ]})
          .expect(200);
    });

    describe('Aborting a submission', () => {
        it('Fails if submission is not found', async () => {
            const app = createApp();
            await request(app)
              .post('/$bulk-submit')
              .send({ parameter: [
                  { name: 'submitter', valueIdentifier: { value: randomUUID(), system: 'urn:uuid' } },
                  { name: 'submissionId', valueString: randomUUID() },
                  { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" },
                  // { name: 'manifestUrl', valueString: "http://example.com/manifest" },
                  {
                    name: 'submissionStatus',
                    valueCoding: {
                      system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
                      code: "aborted"
                    }
                  },
                  { name: '_outputFormat', valueString: "application/fhir+ndjson" }
              ]})
              .expect('content-type', /json/)
              .expect(404, /Submission not found for the given submitter and submissionId/);
        });

        it('Can abort but fails if the submission is already aborted', async () => {
            const app = createApp();

            const submitterParam = { name: 'submitter', valueIdentifier: { value: randomUUID(), system: 'urn:uuid' } };
            const submissionIdParam = { name: 'submissionId', valueString: randomUUID() };
            const fhirBaseUrlParam = { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" };

            // Create a job first
            await request(app)
            .post('/$bulk-submit')
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                fhirBaseUrlParam,
                { name: 'manifestUrl', valueString: "http://example.com/manifest" },
                {
                  name: 'submissionStatus',
                  valueCoding: {
                    system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
                    code: "in-progress"
                  }
                },
                { name: '_outputFormat', valueString: "application/fhir+ndjson" }
            ]})
            .expect(200);

            // Abort the job
            await request(app)
              .post('/$bulk-submit')
              .send({ parameter: [
                submitterParam,
                submissionIdParam,
                fhirBaseUrlParam,
                { name: 'manifestUrl', valueString: "http://example.com/manifest" },
                {
                  name: 'submissionStatus',
                  valueCoding: {
                    system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
                    code: "aborted"
                  }
                },
                { name: '_outputFormat', valueString: "application/fhir+ndjson" }
            ]})
            .expect(200);

            // Try to abort again
            await request(app)
              .post('/$bulk-submit')
              .send({ parameter: [
                  submitterParam,
                  submissionIdParam,
                  fhirBaseUrlParam,
                  { name: 'manifestUrl', valueString: "http://example.com/manifest" },
                  {
                    name: 'submissionStatus',
                    valueCoding: {
                      system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
                      code: "aborted"
                    }
                  },
                  { name: '_outputFormat', valueString: "application/fhir+ndjson" }
              ]})
              .expect('content-type', /json/)
              .expect(400, /Submission is already complete or aborted/);
        });
    });

    describe('Completing a submission', () => {
        // it('Fails if the submission is not found', async () => {
        //     const app = createApp();
        //     await request(app)
        //       .post('/$bulk-submit')
        //       .send({ parameter: [
        //           { name: 'submitter', valueIdentifier: { value: randomUUID(), system: 'urn:uuid' } },
        //           { name: 'submissionId', valueString: randomUUID() },
        //           // { name: 'manifestUrl', valueString: "http://example.com/manifest" },
        //           {
        //             name: 'submissionStatus',
        //             valueCoding: {
        //               system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
        //               code: "complete"
        //             }
        //           },
        //           { name: '_outputFormat', valueString: "application/fhir+ndjson" }
        //       ]})
        //       .expect('content-type', /json/)
        //       .expect(404, /Submission not found for the given submitter and submissionId/);
        // });

        it('Can create a submission as completed', async () => {
            const app = createApp();

            const submitterParam = generateSubmitterParam();
            const submissionIdParam = generateSubmissionIdParam();
            const manifestUrlParam = generateManifestUrlParam();
            const outputFormatParam = generateOutputFormatParam();
            const submissionStatusParam = generateSubmissionStatusParam('complete');
            const fhirBaseUrlParam = { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" };

            await request(app)
                .post('/$bulk-submit')
                .send({ parameter: [
                    submitterParam,
                    submissionIdParam,
                    manifestUrlParam,
                    submissionStatusParam,
                    outputFormatParam,
                    fhirBaseUrlParam
                ]})
                .expect(200)
                .expect(/marked as complete/);
        });

        it('Fails if the submission is already complete or aborted', async () => {
            const app = createApp();

            const submitterParam = generateSubmitterParam();
            const submissionIdParam = generateSubmissionIdParam();
            const manifestUrlParam = { name: 'manifestUrl', valueString: "http://example.com/manifest" };
            const outputFormatParam = { name: '_outputFormat', valueString: "application/fhir+ndjson" };
            const fhirBaseUrlParam = { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" };
            const submissionStatusParam = (status: 'in-progress' | 'complete' | 'aborted' | 'failed') => ({
                name: 'submissionStatus',
                valueCoding: {
                  system: "http://hl7.org/fhir/uv/bulkdata/ValueSet/submission-status",
                  code: status
                }
            });
            const submissionStatusInProgressParam = submissionStatusParam('in-progress');
            const submissionStatusCompleteParam = submissionStatusParam('complete');

            // Create a job first
            await request(app)
            .post('/$bulk-submit')
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                manifestUrlParam,
                submissionStatusInProgressParam,
                outputFormatParam,
                fhirBaseUrlParam
            ]})
            .expect(200);

            // Complete the job
            await request(app)
              .post('/$bulk-submit')
              .send({ parameter: [
                submitterParam,
                submissionIdParam,
                manifestUrlParam,
                submissionStatusCompleteParam,
                outputFormatParam,
                fhirBaseUrlParam
            ]})
            .expect(200);

            // Try to complete again
            await request(app)
              .post('/$bulk-submit')
              .send({ parameter: [
                  submitterParam,
                  submissionIdParam,
                  manifestUrlParam,
                  submissionStatusCompleteParam,
                  outputFormatParam,
                  fhirBaseUrlParam
              ]})
              .expect('content-type', /json/)
              .expect(400, /Submission is already complete or aborted/);
        });
    });

    it ('Replace submission manifest', async () => {
        const app = createApp();

        const submitterParam = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        const manifestUrlParam = generateManifestUrlParam('http://example.com/manifest')
        const fhirBaseUrlParam = { name: 'fhirBaseUrl', valueString: "http://example.com/fhir" };

        // Create a submission first
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              manifestUrlParam,
              fhirBaseUrlParam,
              generateSubmissionStatusParam("in-progress"),
              generateOutputFormatParam()
          ]})
          .expect(200);

        // Then try to replace the manifest
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              manifestUrlParam,
              fhirBaseUrlParam,
              generateManifestUrlParam("http://example.com/manifest-2"),
              generateSubmissionStatusParam("in-progress"),
              generateOutputFormatParam(),
              generateReplacesManifestUrl(manifestUrlParam.valueString)
          ]})
          .expect('content-type', /json/)
          // .expect(400, /Manifest replacement is not yet implemented/)
          .expect(200);
    });
});