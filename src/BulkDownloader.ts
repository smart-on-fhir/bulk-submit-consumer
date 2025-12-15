import { createWriteStream, existsSync } from "fs"
import { mkdir, unlink }                 from "fs/promises"
import { basename, dirname, join }                from "path"
import { EventEmitter }                  from "events"
import { Resource }                      from "fhir/r4"
import { request }                       from "./utils"
import { FhirResources }                 from "./FhirResources"
import CustomError                       from "./CustomError"
import JobQueue                          from "./JobQueue"


EventEmitter.defaultMaxListeners = 30;

export interface BulkDownloaderEvents {
    /**
     * Emitted when the download is aborted.
     */
    "abort": (this: BulkDownloader) => void;

    /**
     * Emitted when an error occurs during downloading or processing.
     */
    "error": (this: BulkDownloader, error: Error) => void;

    /**
     * Emitted when the download starts.
     */
    "start": (this: BulkDownloader) => void;

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
    private fhirBaseUrl: string;
    private fileRequestHeaders: Record<string, string>;
    private queue: JobQueue = new JobQueue();
    private isAborted: boolean = false;

    constructor({
        destinationDir,
        fhirBaseUrl,
        fileRequestHeaders = {}
    }: {
        destinationDir: string,
        fhirBaseUrl: string,
        fileRequestHeaders?: Record<string, string>
    }) {
        super();
        this.destinationDir = destinationDir;
        this.fhirBaseUrl = fhirBaseUrl;
        this.fileRequestHeaders = fileRequestHeaders;
        this.abortController = new AbortController();
        this.abortController.signal.addEventListener("abort", () => {
            this.emit("abort")
        });

        // Make sure we have at least one listener for "error" to avoid
        // uncaught exceptions from EventEmitter
        this.on("error", () => { /* noop */ });
    }

    get status() {
        if (this.isAborted) {
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
        if (this.abortController.signal.aborted) {
            return;
        }
        this.isAborted = true;
        this.abortController.abort();
        // Also abort the queue
        this.queue.abortAll();
        // Create a new abort controller for potential future operations
        this.abortController = new AbortController();
        this.abortController.signal.addEventListener("abort", () => {
            this.emit("abort")
        });
    }

    private async downloadManifest(url: string) {
        const { error, response, request: requestResult } = await request(url, {
            parse: true,
            headers: this.fileRequestHeaders,
            signal: this.abortController.signal
        });
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
        this.isAborted = false;
        this.emit("start");
        try {
            const manifest = await this.downloadManifest(manifestUrl);
            this.validateManifest(manifest);
            await this.downloadAllFiles(manifest, manifestUrl);
        } catch (error) {
            this.emit("error", error as Error);
        }
        this.emit("complete");
    }

    async undoAll(manifestUrl: string) {
        const manifest: ExportManifest = await this.downloadManifest(manifestUrl);
        this.validateManifest(manifest);
        const queue: (() => Promise<any>)[] = [];
        (manifest.output  || []).forEach(file => queue.push(() => this.undoFile({ file, exportType: "output"  })));
        (manifest.deleted || []).forEach(file => queue.push(() => this.undoFile({ file, exportType: "deleted" })));
        (manifest.error   || []).forEach(file => queue.push(() => this.undoFile({ file, exportType: "error"   })));
        this.total = queue.length;
        for (const task of queue) {
            await task();
        }
    }

    async undoFile({
        file,
        exportType
    }: {
        file: ExportManifestFile;
        exportType: "output" | "deleted" | "error";
    }) {
        try {
            const filename  = basename(new URL(file.url).pathname);
            const subfolder = `${this.destinationDir}/${exportType}`;
            const filepath  = join(__dirname, '..', subfolder, filename);
            if (existsSync(filepath)) {
                await unlink(filepath);
            }
        } catch (error) {
            this.emit("error", error as Error);
        }
    }

    private async downloadAllFiles(manifest: ExportManifest, manifestUrl: string) {

        // Abort any ongoing downloads and reset the queue
        this.queue.abortAll();

        // Reset downloaded counter
        this.downloaded = 0;

        // Compute total files to download
        this.total =
            (manifest.output  || []).length +
            (manifest.deleted || []).length +
            (manifest.error   || []).length;

        return new Promise<void>((resolve) => {

            this.queue.on("success", () => {
                this.emit("progress", ++this.downloaded, this.total);
            });

            this.queue.on("idle", () => {
                if (this.downloaded === this.total) {
                    this.queue.removeAllListeners();
                    resolve();
                }
            });

            // Download output files
            (manifest.output || []).forEach(
                file => this.queue.addJob(
                    (signal) => this.downloadFile({ file, exportType: "output", signal, manifestUrl })
                )
            );

            // Download deleted files
            (manifest.deleted || []).forEach(
                file => this.queue.addJob(
                    (signal) => this.downloadFile({ file, exportType: "deleted", signal, manifestUrl })
                )
            );

            // Download error files
            (manifest.error || []).forEach(
                file => this.queue.addJob(
                    (signal) => this.downloadFile({ file, exportType: "error", signal, manifestUrl })
                )
            );
        });
    }

    /**
     * We need to download the files but they can be large so we will stream
     * them. Then parse each line as JSON to verify they are valid JSON and
     * append those lines to a local file.
     */
    private async downloadFile({
        file,
        exportType,
        signal = this.abortController.signal,
        manifestUrl
    }: {
        file: ExportManifestFile;
        exportType: "output" | "deleted" | "error";
        signal?: AbortSignal;
        manifestUrl: string;
    }) {
        if (this.isAborted) {
            return;
        }
        let count = 0;
        this.emit("downloadStart", file.url);

        let filepath = '';
        let requestResult: RequestResult | null = null;
        let currentResource: Resource | null = null;
        let issueType = 'processing';

        try {
            // Create the necessary directories
            const fileUrl   = new URL(file.url, manifestUrl);
            const filename  = basename(fileUrl.pathname);
            const subfolder = `${this.destinationDir}/${exportType}`;
            const dir       = join(__dirname, '..', subfolder);
            filepath        = join(dir, filename);
            await mkdir(dir, { recursive: true });

            // Download the file
            requestResult = await request(fileUrl, {
                signal,
                parse: true,
                headers: this.fileRequestHeaders
            });
            const { error, response } = requestResult;
            if (error) throw new Error(error);

            // Stream the response body to a file
            const generator = response?.body as AsyncGenerator<any>;
            const writeStream = createWriteStream(filepath, { flags: 'a' }); // Append mode
            for await (const obj of generator) {
                currentResource = obj;
                issueType = 'processing';
                try {
                    this.validateResource(obj, file);
                } catch (validationError) {
                    issueType = 'invalid';
                    throw validationError
                }
                writeStream.write(JSON.stringify(obj) + '\n');
                count++;

                // If the resource is DocumentReference, download the actual document too
                if (obj.resourceType === 'DocumentReference') {
                    await this.downloadDocumentReferenceAttachments(obj, subfolder, fileUrl.href);
                }
            }
            writeStream.end();
            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', reject);
            });

            // Check resource count if expected count is provided
            if (file.count !== undefined && file.count !== count) {
                throw new Error(`File ${file.url} expected ${file.count} resources but got ${count}`);
            }

            // Emit download complete event
            this.emit("downloadComplete", file.url, count);
        } catch (error) {
            if (this.isAborted) {
                return;
            }

            // Create and emit a custom error
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

    /**
     * Downloads all attachments from a DocumentReference resource.
     * DocumentReference can have multiple content entries, each with one or more attachments.
     */
    private async downloadDocumentReferenceAttachments(documentReference: any, subfolder: string, fileUrl: string) {
        if (!documentReference.content || !Array.isArray(documentReference.content)) {
            return;
        }

        for (const content of documentReference.content) {
            // Check if aborted before processing each attachment
            if (this.isAborted) {
                return;
            }

            const attachment = content.attachment;
            if (!attachment) continue;

            // Download the attachment if it has a URL
            if (attachment.url) {
                await this.downloadAttachment(attachment.url, documentReference.id, subfolder, fileUrl);
            }
            // Save inline base64 data if present
            else if (attachment.data) {
                await this.saveInlineAttachment(attachment, documentReference.id, subfolder);
            }
        }
    }

    /**
     * Saves inline base64-encoded attachment data to a file.
     * Saves it to a "documents" subdirectory within the subfolder.
     */
    private async saveInlineAttachment(attachment: any, documentReferenceId: string, subfolder: string) {
        // Check if aborted before starting
        if (this.isAborted) {
            return;
        }

        try {
            // Decode the base64 data
            const base64Data = attachment.data;
            const buffer = Buffer.from(base64Data, 'base64');

            // Create a filename based on the document reference ID and content type
            const ext = this.getExtensionFromContentType(attachment.contentType);
            const filename = `${documentReferenceId}${ext}`;
            const documentsDir = join(__dirname, '..', subfolder, 'documents');
            const filepath = join(documentsDir, filename);

            // Create the documents directory if it doesn't exist
            await mkdir(documentsDir, { recursive: true });

            // Write the buffer to file
            const writeStream = createWriteStream(filepath);
            writeStream.write(buffer);
            writeStream.end();

            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', reject);
            });
        } catch (error) {
            // Emit error but don't fail the entire download process
            const customError = new CustomError(
                `Failed to save inline attachment for DocumentReference ${documentReferenceId}: ${(error as Error).message}`,
                {
                    issueType: 'processing',
                    resource: { resourceType: 'DocumentReference', id: documentReferenceId }
                }
            );
            this.emit("error", customError);
        }
    }

    /**
     * Gets file extension from MIME content type.
     */
    private getExtensionFromContentType(contentType?: string): string {
        if (!contentType) return '';
        
        const mimeToExt: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/bmp': '.bmp',
            'image/svg+xml': '.svg',
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'text/plain': '.txt',
            'text/html': '.html',
            'application/xml': '.xml',
            'text/xml': '.xml',
            'application/json': '.json',
            'text/csv': '.csv',
        };

        return mimeToExt[contentType] || '';
    }

    /**
     * Downloads a single attachment file from a URL.
     * Saves it to a "documents" subdirectory within the subfolder.
     */
    private async downloadAttachment(url: string, documentReferenceId: string, subfolder: string, fileUrl: string) {
        // Check if aborted before starting
        if (this.isAborted) {
            return;
        }

        try {
            // Resolve relative URLs:
            // - URLs starting with '/' are relative to fhirBaseUrl
            // - URLs starting with '.' are relative to the DocumentReference file URL
            // - Absolute URLs (starting with 'http') are used as-is
            let absoluteUrl: string;
            if (url.startsWith('http')) {
                absoluteUrl = url;
            } else if (url.startsWith('/')) {
                // Remove trailing slash from fhirBaseUrl if present
                const baseUrl = this.fhirBaseUrl.replace(/\/$/, '');
                absoluteUrl = `${baseUrl}${url}`;
            } else if (url.startsWith('.')) {
                // Relative to the DocumentReference file URL
                const fileBase = new URL(fileUrl);
                absoluteUrl = new URL(url, fileBase.href).href;
            } else {
                // Default: treat as relative to fhirBaseUrl
                const baseUrl = this.fhirBaseUrl.replace(/\/$/, '');
                absoluteUrl = `${baseUrl}/${url}`;
            }
            
            // Create a safe filename based on the document reference ID and URL
            const urlObj = new URL(absoluteUrl);
            const originalFilename = basename(urlObj.pathname) || `document-${documentReferenceId}`;
            const documentsDir = join(__dirname, '..', subfolder, 'documents');
            const filepath = join(documentsDir, originalFilename);

            // Create the documents directory if it doesn't exist
            await mkdir(documentsDir, { recursive: true });

            // Download the file
            const { error, res } = await request(absoluteUrl, {
                headers: this.fileRequestHeaders,
                signal: this.abortController.signal
            });

            if (error || !res || !res.body) {
                throw new Error(error || 'Failed to download attachment');
            }

            // Stream the response body to file
            const writeStream = createWriteStream(filepath);
            const reader = res.body.getReader();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    writeStream.write(value);
                }
                writeStream.end();

                await new Promise<void>((resolve, reject) => {
                    writeStream.on('finish', () => resolve());
                    writeStream.on('error', reject);
                });
            } finally {
                reader.releaseLock();
            }
        } catch (error) {
            if (this.isAborted) {
                return;
            }
            // Emit error but don't fail the entire download process
            const customError = new CustomError(
                `Failed to download attachment from ${url}: ${(error as Error).message}`,
                {
                    issueType: 'processing',
                    resource: { resourceType: 'DocumentReference', id: documentReferenceId }
                }
            );
            this.emit("error", customError);
        }
    }

    private validateResource(resource: Resource, file: ExportManifestFile) {
        if (typeof resource !== 'object' || resource === null) {
            throw new Error("Resource is not an object");
        }
        if (!FhirResources.includes(resource.resourceType)) {
            throw new Error(`Invalid FHIR resourceType: ${resource.resourceType}`);
        }
        if (!resource.id || typeof resource.id !== 'string') {
            throw new Error("Resource ID is missing or invalid");
        }
        if (file?.type && resource.resourceType !== file.type) {
            throw new Error(`Resource type ${resource.resourceType} does not match expected type ${file.type}`);
        }
    }
}

export default BulkDownloader;
