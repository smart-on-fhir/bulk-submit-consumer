import { expect } from 'chai';
import nock from 'nock';
import mockFs from 'mock-fs';
import { Job } from '../src/Job';

describe('Job', () => {

    afterEach(() => {
        nock.cleanAll();
        mockFs.restore();
    });

    describe('Constructor', () => {
        it('should create a job with required fields', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(job.jobId).to.be.a('string');
            expect(job.submissionId).to.equal('sub-123');
            expect(job.outputFormat).to.equal('ndjson');
            expect(job.manifestUrl).to.equal('http://example.com/manifest');
            expect(job.status).to.equal('pending');
            expect(job.progress).to.equal(0);
            expect(job.error).to.be.null;
            expect(job.createdAt).to.be.a('string');
            expect(job.downloader).to.exist;
        });

        it('should accept optional fileRequestHeaders', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com',
                fileRequestHeaders: {
                    'Authorization': 'Bearer token123'
                }
            });

            expect(job).to.exist;
        });

        it('should accept optional onError callback', () => {
            const errorCallback = (err: Error) => {
                // error handler
            };

            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com',
                onError: errorCallback
            });

            expect(job.onError).to.equal(errorCallback);
        });
    });

    describe('start()', () => {
        it('should throw error if job is already in progress', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            // Manually set status to in-progress
            job.status = 'in-progress';

            expect(() => job.start()).to.throw(`Job ${job.jobId} has already been started.`);
        });

        it('should throw error if manifestUrl is missing', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: '',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(() => job.start()).to.throw(`Job ${job.jobId} has no manifestUrl.`);
        });

        it('should start job and set status to in-progress', () => {
            mockFs({
                'jobs': {}
            });

            const mockManifest = {
                transactionTime: "2025-01-01T00:00:00Z",
                request: "http://example.com/export",
                requiresAccessToken: true,
                output: [],
                error: [],
                deleted: []
            };

            nock('http://example.com')
                .get('/manifest')
                .reply(200, mockManifest, { 'content-type': 'application/json' });

            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            // Start event should fire and change status
            job.downloader.on('start', () => {
                expect(job.status).to.equal('in-progress');
            });

            job.start();
        });
    });

    describe('Event Handlers', () => {
        it('should bind all event handlers properly', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            // Check that all event handlers are bound methods
            expect((job as any).progressEventHandler).to.be.a('function');
            expect((job as any).completeEventHandler).to.be.a('function');
            expect((job as any).errorEventHandler).to.be.a('function');
            expect((job as any).abortEventHandler).to.be.a('function');
            expect((job as any).startEventHandler).to.be.a('function');
            expect((job as any).downloadEventHandler).to.be.a('function');
        });

        it('should update progress when progressEventHandler is called', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(job.progress).to.equal(0);
            
            // Call the progress handler directly
            (job as any).progressEventHandler(50, 100);
            expect(job.progress).to.equal(50);

            (job as any).progressEventHandler(100, 100);
            expect(job.progress).to.equal(100);
        });

        it('should set status to complete when completeEventHandler is called', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(job.status).to.equal('pending');
            
            (job as any).completeEventHandler();
            
            expect(job.status).to.equal('complete');
            expect(job.progress).to.equal(100);
        });

        it('should set status to failed and call onError when errorEventHandler is called', () => {
            let errorCallbackCalled = false;
            let capturedError: Error | null = null;

            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com',
                onError: (err) => {
                    errorCallbackCalled = true;
                    capturedError = err;
                }
            });

            const testError = new Error('Test error');
            (job as any).errorEventHandler(testError);

            expect(job.status).to.equal('failed');
            expect(job.error).to.equal('Test error');
            expect(errorCallbackCalled).to.be.true;
            expect(capturedError).to.equal(testError);
        });

        it('should set status to aborted when abortEventHandler is called', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(job.status).to.equal('pending');
            
            (job as any).abortEventHandler();
            
            expect(job.status).to.equal('aborted');
        });

        it('should set status to in-progress when startEventHandler is called', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(job.status).to.equal('pending');
            expect(job.progress).to.equal(0);
            
            (job as any).startEventHandler();
            
            expect(job.status).to.equal('in-progress');
            expect(job.progress).to.equal(0);
        });

        it('should handle downloadEventHandler calls', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            // downloadEventHandler just logs, no state changes to test
            // Just verify it doesn't throw
            expect(() => {
                (job as any).downloadEventHandler('http://example.com/file.ndjson', 100);
            }).to.not.throw();
        });
    });

    describe('abort()', () => {
        it('should abort the downloader and cleanup event listeners', () => {
            mockFs({
                'jobs': {}
            });

            const mockManifest = {
                transactionTime: "2025-01-01T00:00:00Z",
                request: "http://example.com/export",
                requiresAccessToken: true,
                output: [],
                error: [],
                deleted: []
            };

            nock('http://example.com')
                .get('/manifest')
                .reply(200, mockManifest, { 'content-type': 'application/json' });

            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            job.start();
            
            // Get initial listener count
            const initialListenerCount = job.downloader.listenerCount('progress');
            expect(initialListenerCount).to.be.greaterThan(0);

            job.abort();

            // After abort, listeners should be removed
            expect(job.downloader.listenerCount('progress')).to.equal(0);
            expect(job.downloader.listenerCount('complete')).to.equal(0);
            expect(job.downloader.listenerCount('error')).to.equal(0);
        });

        it('should call undoAll on the downloader', (done) => {
            mockFs({
                'jobs': {}
            });

            const mockManifest = {
                transactionTime: "2025-01-01T00:00:00Z",
                request: "http://example.com/export",
                requiresAccessToken: true,
                output: [],
                error: [],
                deleted: []
            };

            nock('http://example.com')
                .get('/manifest')
                .times(2) // Once for start, once for undoAll
                .reply(200, mockManifest, { 'content-type': 'application/json' });

            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            // Spy on undoAll
            let undoAllCalled = false;
            const originalUndoAll = job.downloader.undoAll.bind(job.downloader);
            job.downloader.undoAll = async function(manifestUrl: string) {
                undoAllCalled = true;
                return originalUndoAll(manifestUrl);
            };

            job.start();
            
            setTimeout(() => {
                job.abort();
                
                // Wait a bit for undoAll to be called
                setTimeout(() => {
                    expect(undoAllCalled).to.be.true;
                    done();
                }, 50);
            }, 10);
        });
    });

    describe('Progress Calculation', () => {
        it('should calculate progress as percentage', () => {
            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            expect(job.progress).to.equal(0);

            // Test progress calculation
            (job as any).progressEventHandler(25, 100);
            expect(job.progress).to.equal(25);

            (job as any).progressEventHandler(50, 100);
            expect(job.progress).to.equal(50);

            (job as any).progressEventHandler(75, 100);
            expect(job.progress).to.equal(75);

            (job as any).progressEventHandler(100, 100);
            expect(job.progress).to.equal(100);
        });
    });

    describe('Download Event Handler', () => {
        it('should be called when files are downloaded', (done) => {
            mockFs({
                'jobs': {}
            });

            const mockManifest = {
                transactionTime: "2025-01-01T00:00:00Z",
                request: "http://example.com/export",
                requiresAccessToken: true,
                output: [
                    { type: "Patient", url: "http://example.com/patients.ndjson" }
                ],
                error: [],
                deleted: []
            };

            const ndjsonData = '{"resourceType":"Patient","id":"1"}\n';

            nock('http://example.com')
                .get('/manifest')
                .reply(200, mockManifest, { 'content-type': 'application/json' });

            nock('http://example.com')
                .get('/patients.ndjson')
                .reply(200, ndjsonData, { 'content-type': 'application/ndjson' });

            const job = new Job({
                submissionId: 'sub-123',
                outputFormat: 'ndjson',
                manifestUrl: 'http://example.com/manifest',
                kickoffUrl: 'http://example.com/kickoff',
                FHIRBaseUrl: 'http://example.com'
            });

            let downloadCompleteCalled = false;
            job.downloader.on('downloadComplete', (url, count) => {
                downloadCompleteCalled = true;
                expect(url).to.be.a('string');
                expect(count).to.be.a('number');
            });

            job.downloader.on('complete', () => {
                expect(downloadCompleteCalled).to.be.true;
                done();
            });

            job.start();
        });
    });
});
