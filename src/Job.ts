import { debuglog }   from "util";
import { randomUUID } from "crypto";
import BulkDownloader from "./BulkDownloader";


const debug = debuglog("app:Job")

export interface JobDescriptor {
    submissionId: string;
    outputFormat: string;
    manifestUrl : string;
    kickoffUrl  : string;
    onError?: (error: Error) => void;
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

    public readonly downloader: BulkDownloader;
    public readonly onError?: (error: Error) => void;


    constructor({
        submissionId,
        outputFormat,
        manifestUrl,
        onError
    }: JobDescriptor) {
        this.jobId        = randomUUID();
        this.submissionId = submissionId;
        this.outputFormat = outputFormat;
        this.manifestUrl  = manifestUrl;
        this.status       = 'pending';
        this.onError      = onError;
        this.createdAt    = new Date().toISOString();
        this.downloader   = new BulkDownloader({
            destinationDir: `jobs/${submissionId}/downloads/${this.jobId}`
        });

        this.progressEventHandler = this.progressEventHandler.bind(this);
        this.completeEventHandler = this.completeEventHandler.bind(this);
        this.downloadEventHandler = this.downloadEventHandler.bind(this);
        this.errorEventHandler    = this.errorEventHandler.bind(this);
        this.abortEventHandler    = this.abortEventHandler.bind(this);
        this.startEventHandler    = this.startEventHandler.bind(this);
    }

    private progressEventHandler(downloaded: number, total: number) {
        this.progress = Math.round((downloaded / total) * 100);
        debug(`Job ${this.jobId} progress: ${this.progress}`);
    }

    private completeEventHandler() {
        this.status   = 'complete';
        this.progress = 100;
        debug(`Job ${this.jobId} completed.`);
    }

    private errorEventHandler(error: Error) {
        this.status = 'failed';
        this.error  = error.message;
        debug(`Job ${this.jobId} failed: ${error.message}`);
        this.onError?.(error);
    }

    private abortEventHandler() {
        this.status = 'aborted';
        debug(`Job ${this.jobId} aborted.`);
    }

    private startEventHandler() {
        this.status   = 'in-progress';
        this.progress = 0;
        debug(`Job ${this.jobId} started.`);
    }

    private downloadEventHandler(url: string, count: number) {
        debug(`Job ${this.jobId} downloaded file: ${url} (${count})`);
    }

    /**
     * The job uses a bulk data client instance under the hood. If we have a
     * manifest and the job status is not already in progress begin downloading
     * files
     */
    start() {

        // Jobs can only be started once
        if (this.status === 'in-progress') {
            throw new Error(`Job ${this.jobId} has already been started.`);
        }

        // Jobs need a manifest URL to start
        if (!this.manifestUrl) {
            throw new Error(`Job ${this.jobId} has no manifestUrl.`);
        }

        this.downloader.on("progress"        , this.progressEventHandler);
        this.downloader.on("complete"        , this.completeEventHandler);
        this.downloader.on("abort"           , this.abortEventHandler   );
        this.downloader.on("start"           , this.startEventHandler   );
        this.downloader.on("downloadComplete", this.downloadEventHandler);
        this.downloader.on("error"           , this.errorEventHandler   );
        this.downloader.run(this.manifestUrl);
    }

    abort() {
        this.downloader.abort();
        this.downloader.off('progress'        , this.progressEventHandler);
        this.downloader.off('complete'        , this.completeEventHandler);
        this.downloader.off('abort'           , this.abortEventHandler   );
        this.downloader.off('start'           , this.startEventHandler   );
        this.downloader.off('downloadComplete', this.downloadEventHandler);
        this.downloader.off('error'           , this.errorEventHandler   );
    }
}
