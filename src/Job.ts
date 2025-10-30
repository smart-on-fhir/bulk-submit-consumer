import { debuglog }   from "util";
import { randomUUID } from "crypto";
import BulkDownloader from "./BulkDownloader";


const debug = debuglog("app:Job")

export interface JobDescriptor {
    submissionId: string;
    outputFormat: string;
    manifestUrl : string;
    kickoffUrl  : string;
}

export class Job {
    readonly jobId: string;
    readonly submissionId: string;
    readonly outputFormat: string;
    readonly manifestUrl: string;
    readonly createdAt: string;

    public status: 'pending' | 'in-progress' | 'complete' | 'failed' | 'aborted';
    public progress: number = 0;
    public error: string | null = null;
 
    constructor({
        submissionId,
        outputFormat,
        manifestUrl,
    }: JobDescriptor) {
        this.jobId        = randomUUID();
        this.submissionId = submissionId;
        this.outputFormat = outputFormat;
        this.manifestUrl  = manifestUrl;
        this.status       = 'pending';
        this.createdAt    = new Date().toISOString();
    }

    /**
     * The job uses a bulk data client instance under the hood. If we have a
     * manifest and the job status is not already in progress begin downloading
     * files
     */
    async start({
        downloadComplete
    }: {
        downloadComplete?: (url: string, count: number) => void;
    } = {}) {
        if (this.status === 'in-progress') {
            throw new Error(`Job ${this.jobId} has already been started.`);
        }
        if (!this.manifestUrl) {
            throw new Error(`Job ${this.jobId} has no manifestUrl.`);
        }

        const downloader = new BulkDownloader();

        downloader.on("progress", async (downloaded: number, total: number) => {
            this.progress = Math.round((downloaded / total) * 100);
            debug(`Job ${this.jobId} progress: ${this.progress}`);
        });

        downloader.on("complete", async () => {
            this.status   = 'complete';
            this.progress = 100;
            debug(`Job ${this.jobId} completed.`);
        });

        downloader.on("error", async (error: Error) => {
            this.status = 'failed';
            this.error  = error.message;
            debug(`Job ${this.jobId} failed: ${error.message}`);
        });

        downloader.on("abort", async () => {
            this.status = 'aborted';
            debug(`Job ${this.jobId} aborted.`);
        });

        downloader.on("start", async () => {
            this.status   = 'in-progress';
            this.progress = 0;
            debug(`Job ${this.jobId} started.`);
        });

        downloader.on("downloadComplete", async (url: string, count: number) => {
            debug(`Job ${this.jobId} downloaded file: ${url}`);
            if (downloadComplete) {
                downloadComplete(url, count);
            }
        });

        downloader.run(this.manifestUrl);
    }
}
