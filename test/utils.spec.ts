import { expect }  from "chai";
import nock        from "nock";
import { request } from "../src/utils";


describe('Utils', () => {

    afterEach(() => {
        nock.cleanAll();
    });
    
    it ('request catches errors', async () => {
        nock('http://example.com')
            .get('/error')
            .replyWithError('Something went wrong');
            
        const { error } = await request('http://example.com/error');
        expect(error).to.equal('Request to http://example.com/error failed: Something went wrong');
    });

    it ('request handles error responses', async () => {
        nock('http://example.com')
            .get('/error')
            .reply(404, { error: 'Not Found' });

        const { error } = await request('http://example.com/error');
        expect(error).to.equal('Request to http://example.com/error failed with status 404 Not Found');
    });

    it ('request - response.body is null if parse is not true', async () => {
        nock('http://example.com')
            .get('/raw')
            .reply(200, 'Raw response', { 'content-type': 'text/plain' });

        const result = await request('http://example.com/raw');
        expect(result.res).to.be.instanceOf(Response);
        expect(result.response!.body).to.be.null;
    });

    it ('request handles text responses', async () => {
        nock('http://example.com')
            .get('/text')
            .reply(200, 'Plain text response', { 'content-type': 'text/plain' });

        const result = await request('http://example.com/text', { parse: true });
        expect(result.response!.body).to.equal('Plain text response');
    });

    it ('request handles json responses', async () => {
        nock('http://example.com')
            .get('/json')
            .reply(200, { message: 'Hello, world!' }, { 'content-type': 'application/json' });

        const result = await request('http://example.com/json', { parse: true });
        expect(result.response!.body).to.deep.equal({ message: 'Hello, world!' });
    });

    it ('request handles ndjson responses', async () => {
        nock('http://example.com')
            .get('/ndjson')
            .reply(200, '{"resourceType":"Patient","id":"1"}\n{"resourceType":"Patient","id":"2"}\n', { 'content-type': 'application/ndjson' });
        
        const expected = [
            { resourceType: "Patient", id: "1" },
            { resourceType: "Patient", id: "2" }
        ];

        const result = await request('http://example.com/ndjson', { parse: true });
        const results = [];
        for await (const obj of result.response!.body) {
            results.push(obj);
        }
        expect(results).to.deep.equal(expected);
    });

    it ('handles empty ndjson files', async () => {
        nock('http://example.com')
            .get('/empty.ndjson')
            .reply(200, '', { 'content-type': 'application/ndjson' });

        const result = await request('http://example.com/empty.ndjson', { parse: true });
        const results = [];
        for await (const obj of result.response!.body) {
            results.push(obj);
        }
        expect(results).to.deep.equal([]);
    });
});
