import { EventEmitter } from 'events';

type Job = (signal: AbortSignal) => Promise<any>;

type QueueItem = {
    job: Job;
    resolve: (v?: any) => void;
    reject: (e?: any) => void;
};

export default class JobQueue extends EventEmitter {
    private queue: QueueItem[] = [];
    private isProcessing = false;
    private abortController = new AbortController();

    // Typed `on` overloads for consumers
    on(event: 'success', listener: (result: any) => void): this;
    on(event: 'error', listener: (err: any) => void): this;
    on(event: 'idle', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    // Typed `emit` overloads for internal use
    emit(event: 'success', result: any): boolean;
    emit(event: 'error', err: any): boolean;
    emit(event: 'idle'): boolean;
    emit(event: string, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    // Add a job and return a Promise that resolves/rejects when the job finishes
    addJob(job: Job): Promise<any> {
        let resolveFn: (v?: any) => void;
        let rejectFn: (err?: any) => void;

        const completionPromise = new Promise<any>((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
        });

        this.queue.push({ job, resolve: resolveFn!, reject: rejectFn! });
        // start processing if not already
        this.processQueue();
        return completionPromise;
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            if (item) {
                try {
                    const result = await item.job(this.abortController.signal);
                    this.emit('success', result);
                    // Resolve the promise after emitting so listeners see the event first
                    item.resolve(result);
                } catch (error) {
                    // Reject the job promise first to avoid throwing when no 'error' listeners are attached
                    item.reject(error);
                    if (this.listenerCount('error') > 0) {
                        this.emit('error', error);
                    }
                }
            }
        }

        this.isProcessing = false;
        this.emit('idle');
    }

    public abortAll() {
        this.queue = [];
        this.abortController.abort();
        this.abortController = new AbortController();
    }
}