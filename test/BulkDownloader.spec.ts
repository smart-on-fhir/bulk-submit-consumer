import { expect }       from "chai";
import nock             from "nock";
import mockFs           from "mock-fs";
import { readFileSync } from "fs";
import BulkDownloader   from "../src/BulkDownloader";


describe('BulkDownloader', () => {

    afterEach(() => {
        nock.cleanAll();
    });

    it('should emit abort event when aborted', (done) => {
        downloader.on('abort', () => { done(); });
        downloader.abort();
    });

    it('should report status correctly', async () => {
        const downloader = new BulkDownloader();
        expect(downloader.status).to.equal('No files to download');

        // Simulate setting total and downloaded files
        (downloader as any).total = 5;
        (downloader as any).downloaded = 2;
        expect(downloader.status).to.equal('Downloaded 2 of 5 files');

        (downloader as any).downloaded = 5;
        expect(downloader.status).to.equal('All files downloaded');

        downloader.abort();
        expect(downloader.status).to.equal('Download aborted');
    });

    it('should download and parse manifest', async () => {
        const mockManifest = {
            transactionTime: "2025-01-01T00:00:00Z",
            request: "http://example.com/export",
            requiresAccessToken: true,
            output: [
                { type: "Patient", url: "http://example.com/files/patients.ndjson", count: 100 }
            ],
            error: [],
            deleted: []
        };

        nock('http://example.com')
            .get('/manifest')
            .reply(200, mockManifest, { 'content-type': 'application/json' });

        const downloader = new BulkDownloader();
        const manifest = await (downloader as any).downloadManifest('http://example.com/manifest');
        expect(manifest).to.deep.equal(mockManifest);
    });

    it('should validate manifest', async () => {
        const downloader = new BulkDownloader();
        const validManifest = {
            transactionTime: "2025-01-01T00:00:00Z",
            request: "http://example.com/export",
            requiresAccessToken: true,
            output: [],
            error: [],
            deleted: []
        };

        expect(() => (downloader as any).validateManifest(validManifest)).to.not.throw();

        // expect(() => (downloader as any).validateManifest({ ...validManifest, deleted: null}))
        //     .to.throw('Manifest deleted must be an array if present');

        // expect(() => (downloader as any).validateManifest({ ...validManifest, error: null}))
        //     .to.throw('Manifest error must be an array');
        
        expect(() => (downloader as any).validateManifest({ ...validManifest, output: null}))
            .to.throw('Manifest output must be an array');

        expect(() => (downloader as any).validateManifest({ ...validManifest, requiresAccessToken: null}))
            .to.throw('Manifest has missing or invalid requiresAccessToken');
        
        // expect(() => (downloader as any).validateManifest({ ...validManifest, request: null}))
        //     .to.throw('Manifest is missing request');

        // expect(() => (downloader as any).validateManifest({ ...validManifest, transactionTime: null}))
        //     .to.throw('Manifest is missing transactionTime');
    });

    it ('downloadFile does nothing if aborted', async () => {
        const downloader = new BulkDownloader();
        downloader.abort();
        await (downloader as any).downloadFile({ file: { url: 'http://example.com/file.ndjson' }, exportType: 'output' });
        expect((downloader as any).downloaded).to.equal(0);
    });

    it ('downloadFile handles errors', async () => {
        nock('http://example.com')
            .get('/file.ndjson')
            .reply(404, { error: 'Not Found' });

        const eventLog: string[] = [];
        const downloader = new BulkDownloader();
        downloader.on('error', () => { eventLog.push("error"); });
        downloader.on('downloadStart', () => { eventLog.push("downloadStart"); });
        downloader.on('downloadComplete', () => { eventLog.push("downloadComplete"); });
        try {
            await (downloader as any).downloadFile({ file: { url: 'http://example.com/file.ndjson' }, exportType: 'output' });
        } catch (error) {
            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.equal('Request to http://example.com/file.ndjson failed with status 404');
            expect((error as any).body).to.deep.equal({ error: 'Not Found' });
        }
        expect(eventLog).to.deep.equal(['downloadStart', 'error', 'downloadComplete']);
    });

    it('downloadFile downloads and validates NDJSON and appends lines to file', async () => {
        const ndjsonData = '{"resourceType":"Patient","id":"1"}\n{"resourceType":"Patient","id":"2"}\n';
        const expectedLines = [
            '{"resourceType":"Patient","id":"1"}',
            '{"resourceType":"Patient","id":"2"}'
        ];

        // Mock the file system
        mockFs({
            'downloads': {
                'output': {}
            }
        });

        nock('http://example.com')
            .get('/patients.ndjson')
            .reply(200, ndjsonData, { 'content-type': 'application/ndjson' });

        const downloader = new BulkDownloader();
        await (downloader as any).downloadFile({ file: { url: 'http://example.com/patients.ndjson' }, exportType: 'output' });

        // Verify the file contents
        const filePath = 'downloads/output/patients.ndjson';
        const fileContents = readFileSync(filePath, 'utf-8');
        const lines = fileContents.trim().split('\n');
        expect(lines).to.deep.equal(expectedLines);

        // Restore the real file system
        mockFs.restore();
    });
});