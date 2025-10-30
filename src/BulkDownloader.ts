import { createWriteStream } from "fs"
import { mkdir }             from "fs/promises"
import { basename, join }    from "path"
import { EventEmitter }      from "events"
import { request }           from "./utils"
import { Resource }          from "fhir/r4"
import { FhirResources }     from "./FhirResources"
import CustomError           from "./CustomError"


EventEmitter.defaultMaxListeners = 30;

export interface BulkDownloaderEvents {
    "abort"           : (this: BulkDownloader) => void;
    "error"           : (this: BulkDownloader, error: Error) => void;
    "start"           : (this: BulkDownloader) => void;

    /**
     * Emitted when the manifest and all the files have been downloaded.
     */
    "complete": (this: BulkDownloader) => void;

    /**
     * Emitted after a file is downloaded to report overall progress (how many
     * files have been downloaded out of total files to download).
     */
    "progress": (this: BulkDownloader, downloaded: number, total: number) => void;

    /**
     * Emitted when a file download starts.
     */
    "downloadStart": (this: BulkDownloader, url: string) => void;

    /**
     * Emitted when a file download completes (even in error cases).
     */
    "downloadComplete": (this: BulkDownloader, url: string, count: number) => void;
}

interface BulkDownloader {
    on<U extends keyof BulkDownloaderEvents>(event: U, listener: BulkDownloaderEvents[U]): this;
    emit<U extends keyof BulkDownloaderEvents>(event: U, ...args: Parameters<BulkDownloaderEvents[U]>): boolean;
}

class BulkDownloader extends EventEmitter
{
    private abortController: AbortController;
    private total: number = 0;
    private downloaded: number = 0;
    private destinationDir: string;

    constructor({ destinationDir }: { destinationDir: string }) {
        super();
        this.destinationDir = destinationDir;
        this.abortController = new AbortController();
        this.abortController.signal.addEventListener("abort", () => {
            this.emit("abort")
        });
    }

    get status() {
        if (this.abortController.signal.aborted) {
            return 'Download aborted';
        }
        if (this.total === 0) {
            return 'No files to download';
        }
        if (this.downloaded === this.total) {
            return 'All files downloaded';
        }
        return `Downloaded ${this.downloaded} of ${this.total} files`;
    }

    public abort() {
        this.abortController.abort()
    }

    private async downloadManifest(url: string) {
        const { error, response, request: requestResult } = await request(url, { parse: true });
        if (error) {
            const customError = new CustomError(`Failed to download manifest: ${error}`, {
                request : requestResult,
                response: response,
                issueType: "not-found"
            });
            this.emit("error", customError);
            throw customError;
        }
        return response?.body;
    }

    private validateManifest(manifest: ExportManifest) {
        if (!manifest.transactionTime) {
            throw new Error("Manifest is missing transactionTime");
        }
        // if (!manifest.request) {
        //     throw new Error("Manifest is missing request");
        // }
        if (typeof manifest.requiresAccessToken !== 'boolean') {
            throw new Error("Manifest has missing or invalid requiresAccessToken");
        }
        if (!Array.isArray(manifest.output)) {
            throw new Error("Manifest output must be an array");
        }
        // if (!Array.isArray(manifest.error)) {
        //     throw new Error("Manifest error must be an array");
        // }
        if (manifest.deleted !== undefined && !Array.isArray(manifest.deleted)) {
            throw new Error("Manifest deleted must be an array if present");
        }
    }
    
    async run(manifestUrl: string) {
        this.emit("start");
        try {
            const manifest = await this.downloadManifest(manifestUrl);
            this.validateManifest(manifest);
            await this.downloadAllFiles(manifest);
            // TODO: Check for more manifests (pagination)
            // this.emit("complete");
        } catch (error) {
            this.emit("error", error as Error);
        }
        this.emit("complete");
    }


    private async downloadAllFiles(manifest: ExportManifest){
        // this.emit("start");
        const queue: (() => Promise<any>)[] = [];
        (manifest.output  || []).forEach(file => queue.push(() => this.downloadFile({ file, exportType: "output"  })));
        (manifest.deleted || []).forEach(file => queue.push(() => this.downloadFile({ file, exportType: "deleted" })));
        (manifest.error   || []).forEach(file => queue.push(() => this.downloadFile({ file, exportType: "error"   })));
        this.total = queue.length;
        for (const task of queue) {
            await task();
            this.emit("progress", ++this.downloaded, this.total);
        }
        // this.emit("complete");
    }

    /**
     * We need to download the files but they can be large so we will stream
     * them. Then parse each line as JSON to verify they are valid JSON and
     * append those lines to a local file.
     */
    private async downloadFile({
        file,
        exportType
    }: {
        file: ExportManifestFile;
        exportType: "output" | "deleted" | "error";
    }) {
        if (this.abortController.signal.aborted) {
            return;
        }
        let count = 0;
        this.emit("downloadStart", file.url);

        let filepath = '';
        let requestResult: RequestResult | null = null;
        let currentResource: Resource | null = null;
        let issueType = 'processing';

        try {
            const filename  = basename(new URL(file.url).pathname);
            const subfolder = `${this.destinationDir}/${exportType}`;
            const dir       = join(__dirname, '..', subfolder);
            filepath        = join(dir, filename);
            await mkdir(dir, { recursive: true });
            requestResult = await request(file.url, { parse: true, signal: this.abortController.signal });
            const { error, response } = requestResult;
            if (error) throw new Error(error);
            const generator = response?.body as AsyncGenerator<any>;
            const writeStream = createWriteStream(filepath, { flags: 'a' }); // Append mode
            for await (const obj of generator) {
                currentResource = obj;
                issueType = 'processing';
                try {
                    this.validateResource(obj);
                } catch (validationError) {
                    issueType = 'invalid';
                    throw validationError
                }
                writeStream.write(JSON.stringify(obj) + '\n');
                count++;
            }
            writeStream.end();
            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', reject);
            });
            this.emit("downloadComplete", file.url, count);
        } catch (error) {
            const customError = new CustomError(`Failed to download file ${basename(file.url)}: ${(error as Error).message}`, {
                filePath    : filepath,
                request     : requestResult?.request,
                response    : requestResult?.response,
                resource    : currentResource,
                lineNumber  : currentResource ? count + 1 : undefined,
                issueType
            });
            this.emit("error", customError);
        }
    }

    private validateResource(resource: Resource) {
        if (typeof resource !== 'object' || resource === null) {
            throw new Error("Resource is not an object");
        }
        if (!FhirResources.includes(resource.resourceType)) {
            throw new Error(`Invalid FHIR resourceType: ${resource.resourceType}`);
        }
        if (!resource.id || typeof resource.id !== 'string') {
            throw new Error("Resource ID is missing or invalid");
        }
    }
}

export default BulkDownloader;
