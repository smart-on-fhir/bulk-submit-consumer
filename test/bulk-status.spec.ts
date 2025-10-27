import request        from 'supertest';
import createApp      from '../src/app';
import { Submission } from '../src/Submission';
import {
    generateSubmitterParam,
    generateSubmissionIdParam,
    generateOutputFormatParam,
    generateSubmissionStatusParam,
    generateManifestUrlParam
} from './utils'
import DB from '../src/db';


describe('Status Kick-off Validation', () => {

    it('Invalid body', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .send('invalid body')
          .expect('Content-Type', /json/)
          .expect(400, /Invalid request body/)

        await request(app)
          .post('/$bulk-submit-status')
          .send({})
          .expect('Content-Type', /json/)
          .expect(400, /Invalid request body/)
    });

    it('Missing submitter parameter', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .send({ parameter: [] })
          .expect('Content-Type', /json/)
          .expect(400, /Missing or invalid submitter parameter/);
    });

    it('Missing submissionId parameter', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .send({ parameter: [generateSubmitterParam()] })
          .expect('Content-Type', /json/)
          .expect(400, /Missing or invalid submissionId parameter/);
    });

    it('Invalid _outputFormat parameter', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .send({ parameter: [
              generateSubmitterParam(),
              generateSubmissionIdParam(),
              generateOutputFormatParam("invalid/format")
          ]})
          .expect('Content-Type', /json/)
          .expect(400, /Invalid _outputFormat parameter\. Only ndjson formats are supported by this server\./);
    });

    it('Invalid Accept header', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .set('Accept', 'invalid/accept')
          .send({ parameter: [
              generateSubmitterParam(),
              generateSubmissionIdParam(),
              generateOutputFormatParam()
          ]})
          .expect('Content-Type', /json/)
          .expect(400, /Invalid Accept header. Only application\/fhir\+json is supported by this server./);
    });

    it('Invalid Prefer header', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .set('Prefer', 'invalid/prefer')
          .send({ parameter: [
              generateSubmitterParam(),
              generateSubmissionIdParam(),
              generateOutputFormatParam()
          ]})
          .expect('Content-Type', /json/)
          .expect(400, /Invalid Prefer header. Only respond-async is supported by this server./);
    });

    it ('Valid request but missing job', async () => {
        const app = createApp();
        await request(app)
          .post('/$bulk-submit-status')
          .send({ parameter: [
              generateSubmitterParam(),
              generateSubmissionIdParam(),
              generateOutputFormatParam()
          ]})
          .expect('Content-Type', /json/)
          .expect(404, /No submission found for the given submitter and submissionId/);
    });

    it ('Valid request and existing job', async () => {
        const app = createApp();

        const submitterParam = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        
        // First, create a job via $bulk-submit
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              { name: 'manifestUrl', valueString: "http://example.com/manifest" },
              generateSubmissionStatusParam('in-progress'),
              generateOutputFormatParam()
          ]})
          .expect(200);

        const slug = Submission.computeSlug(
            submissionIdParam.valueString,
            submitterParam.valueIdentifier
        );
        
        // Now, do the status kick-off request
        await request(app)
          .post('/$bulk-submit-status')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              generateOutputFormatParam()
          ]})
          .expect(202)
          .expect('content-location', /^https?:\/\/.+/)
          .expect('content-location', new RegExp(`/${slug}$`));
    });
});

describe('Status Requests', () => {
    it ('returns 404 for non-existing submission', async () => {
        const app = createApp();
        await request(app)
          .get('/$bulk-submit-status/non-existing-submission-id')
          .expect('Content-Type', /json/)
          .expect(404, /No submission found for the given id/);
    });

    it ('returns 500 for aborted submissions', async () => {
        const app = createApp();

        const submitterParam    = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        
        // First, create a job via $bulk-submit
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              generateManifestUrlParam()
          ]})
          .expect(200);
        
        const slug = Submission.computeSlug(
            submissionIdParam.valueString,
            submitterParam.valueIdentifier
        );

        // Abort the submission
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              generateSubmissionStatusParam('aborted')
          ]})
          .expect(200)
          .expect(/marked as aborted/);
        
        // Finally, do the status request
        await request(app)
          .get(`/$bulk-submit-status/${slug}`)
          .expect('Content-Type', /json/)
          .expect(500, /The submission has been aborted/);
    });

    it ('should return 202 on the initial request', async () => {
        const app = createApp();

        const submitterParam    = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        const outputFormatParam = generateOutputFormatParam();
        
        // First, create a job via $bulk-submit
        await request(app)
          .post('/$bulk-submit')
          .send({ parameter: [
              submitterParam,
              submissionIdParam,
              outputFormatParam,
              generateManifestUrlParam()
          ]})
          .expect(200);
        
        // Then do the status kick-off
        const res = await request(app)
            .post('/$bulk-submit-status')
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                outputFormatParam
            ]})
            .expect(202);

          // Now get the status location
          const location = new URL(res.headers['content-location']).pathname;

          // Finally, do the status request
          await request(app)
              .get(location)
              .expect(202)
              .expect('X-Progress', /processed/);
    });

    it ('should return 202 for completed jobs which are still processing', async () => {
        const app = createApp();

        const submitterParam    = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        const outputFormatParam = generateOutputFormatParam();

        // First, create a job via $bulk-submit
        await request(app)
            .post('/$bulk-submit')
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                outputFormatParam,
                generateManifestUrlParam(),
                generateSubmissionStatusParam('complete')
            ]})
            .expect(200);
        
        // Then do the status kick-off
        const res = await request(app)
            .post('/$bulk-submit-status')
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                outputFormatParam
            ]})
            .expect(202);

        // Now get the status location
        const location = new URL(res.headers['content-location']).pathname;

        // Finally, do the status request
        await request(app)
            .get(location)
            .expect(202)
            .expect('X-Progress', /processed/);
    });

    it ('should return 200 with manifest for complete jobs', async () => {
        const app = createApp();

        const submitterParam    = generateSubmitterParam();
        const submissionIdParam = generateSubmissionIdParam();
        const outputFormatParam = generateOutputFormatParam();
        
        // First, create a job via $bulk-submit
        await request(app)
            .post('/$bulk-submit')
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                outputFormatParam,
                generateManifestUrlParam(),
                generateSubmissionStatusParam('complete')
            ]})
            .expect(200);
        
        // Get the submission and mark it as complete
        const submission = await DB.submissions.find({
            submissionId: submissionIdParam.valueString,
            submitter   : submitterParam.valueIdentifier
        });

        if (submission) {
            const jobs = submission.getJobs();
            jobs[0].progress = 100;
        }
        
        // Then do the status kick-off
        await request(app)
            .get(`/$bulk-submit-status/${submission!.slug}`)
            .send({ parameter: [
                submitterParam,
                submissionIdParam,
                outputFormatParam
            ]})
            .expect('Content-Type', /json/)
            .expect(/"output"\:/)
            .expect(200);
    });
});
