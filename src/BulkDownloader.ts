import { createWriteStream } from "fs"
import { mkdir }             from "fs/promises"
import { basename, join }    from "path"
// import { debuglog }          from "util"
import { EventEmitter }      from "events"


EventEmitter.defaultMaxListeners = 30;

// const debug = debuglog("app:BulkDownloader")

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

    constructor()
    {
        super();
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
        return await this.request(url, { parse: true });
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

    private async request(uri: string | URL, options: RequestInit & { parse?: boolean } = {}): Promise<Response | any> {
        const { parse, ...fetchOptions } = options;
        const _options: RequestInit = {
            ...fetchOptions,
            signal: this.abortController.signal,
            headers: {
                ...fetchOptions.headers
            }
        }

        let response: Response;
        try {
            response = await fetch(uri, _options);
        } catch (error) {
            // Network or other fetch-related error
            const err: any = new Error(`Request to ${uri} failed: ${(error as Error).message}`);
            err.code = (error as any).code;
            throw err;
        }

        // Error response from server
        if (response.status >= 400) {
            const err: any = new Error(`Request to ${uri} failed with status ${response.status}`);
            err.code = response.status;
            err.responseHeaders = response.headers;
            const text = await response.text();
            // debug(`Response body: ${text}`);
            err.body = text;
            if (response.headers.get("content-type")?.match(/\bjson\b/)) {
                const json = JSON.parse(text);
                // debug(`Response JSON: ${JSON.stringify(json)}`);
                err.body = json;
            }
            // debug(`Request error: %s`, err.message);
            throw err;
        }

        if (parse) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                return await response.json();
            } else if (contentType.includes('application/ndjson') || contentType.includes('ndjson')) {
                return this.streamNDJSON(response);
            } else {
                return await response.text();
            }
        }

        return response;
    }

    private async *streamNDJSON(response: Response) {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Response body is null");
        }

        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep the last incomplete line
                for (const line of lines) {
                    if (line.trim()) {
                        yield JSON.parse(line);
                    }
                }
            }
            // Process any remaining complete line in buffer
            if (buffer.trim()) {
                yield JSON.parse(buffer);
            }
        } finally {
            reader.releaseLock();
        }
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
        try {
            const filename  = basename(new URL(file.url).pathname);
            const subfolder = `downloads/${exportType}`;
            const dir       = join(process.cwd(), subfolder);
            const filepath  = join(dir, filename);
            await mkdir(dir, { recursive: true });
            const generator = await this.request(file.url, { parse: true });
            const writeStream = createWriteStream(filepath, { flags: 'a' }); // Append mode
            for await (const obj of generator) {
                writeStream.write(JSON.stringify(obj) + '\n');
                count++;
            }
            writeStream.end();
            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', reject);
            });
            // debug(`Downloaded and parsed ${file.url} to ${filepath}`);
            this.emit("downloadComplete", file.url, count);
        } catch (error) {
            // debug(`Error downloading file ${file.url}: ${(error as Error).message}`);
            this.emit("error", error as Error);
            this.emit("downloadComplete", file.url, count);
            throw error
        }
        // this.emit("downloadComplete", file.url, count);
    }
}

export default BulkDownloader;
