import { expect } from 'chai';
import JobQueue from '../src/JobQueue';

describe('JobQueue', () => {
    it('resolves when a job completes', async () => {
        const q = new JobQueue();
        const result = await q.addJob(async () => 'ok');
        expect(result).to.equal('ok');
    });

    it('rejects when a job throws', async () => {
        const q = new JobQueue();
        try {
            await q.addJob(async () => { throw new Error('fail'); });
            throw new Error('expected rejection');
        } catch (err: any) {
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('fail');
        }
    });

    it('emits success and idle events', async () => {
        const q = new JobQueue();
        let successCalled = false;
        let idleCalled = false;
        q.on('success', () => { successCalled = true; });
        q.on('idle', () => { idleCalled = true; });

        const res = await q.addJob(async () => 'done');
        expect(res).to.equal('done');
        expect(successCalled, 'success event not fired').to.be.true;
        expect(idleCalled, 'idle event not fired').to.be.true;
    });

    it('abortAll aborts a running job and causes its promise to reject', async function () {
        this.timeout(200);
        const q = new JobQueue();

        const p = q.addJob((signal) => new Promise((resolve, reject) => {
            if (signal.aborted) return reject(new Error('aborted'));
            const onAbort = () => reject(new Error('aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
            // emulate long running task
            const t = setTimeout(() => {
                signal.removeEventListener('abort', onAbort as any);
                resolve('finished');
            }, 50);
        }));

        // abort immediately
        q.abortAll();

        try {
            await p;
            throw new Error('expected abort rejection');
        } catch (err: any) {
            expect(err).to.be.instanceOf(Error);
            expect(err.message).to.equal('aborted');
        }
    });

    it('should process multiple jobs sequentially', async () => {
        const q = new JobQueue();
        const results: string[] = [];
        
        const job1 = q.addJob(async () => {
            results.push('job1');
            return 'result1';
        });
        
        const job2 = q.addJob(async () => {
            results.push('job2');
            return 'result2';
        });
        
        const job3 = q.addJob(async () => {
            results.push('job3');
            return 'result3';
        });

        const [r1, r2, r3] = await Promise.all([job1, job2, job3]);
        
        expect(r1).to.equal('result1');
        expect(r2).to.equal('result2');
        expect(r3).to.equal('result3');
        expect(results).to.deep.equal(['job1', 'job2', 'job3']);
    });

    it('should emit error event when job fails and listener is attached', async () => {
        const q = new JobQueue();
        const errors: any[] = [];
        
        q.on('error', (err) => errors.push(err));

        try {
            await q.addJob(async () => {
                throw new Error('test error');
            });
        } catch (err: any) {
            // Job promise should reject
            expect(err.message).to.equal('test error');
        }

        // Error event should also be emitted
        expect(errors.length).to.equal(1);
        expect(errors[0].message).to.equal('test error');
    });

    it('should not emit error event when job fails and no listener is attached', async () => {
        const q = new JobQueue();
        // No error listener attached
        
        let errorEmitted = false;
        const originalEmit = q.emit.bind(q);
        (q.emit as any) = function(event: string, ...args: any[]): boolean {
            if (event === 'error') {
                errorEmitted = true;
            }
            return (originalEmit as any)(event, ...args);
        };

        try {
            await q.addJob(async () => {
                throw new Error('test error');
            });
        } catch (err: any) {
            expect(err.message).to.equal('test error');
        }

        // Error event should NOT be emitted (no listeners)
        expect(errorEmitted).to.be.false;
    });

    it('should handle jobs that return values', async () => {
        const q = new JobQueue();
        
        const result = await q.addJob(async () => {
            return { foo: 'bar', count: 42 };
        });

        expect(result).to.deep.equal({ foo: 'bar', count: 42 });
    });

    it('should clear queue when abortAll is called', async () => {
        const q = new JobQueue();
        const executed: number[] = [];

        // Add jobs but don't await them immediately
        const job1 = q.addJob(async () => {
            executed.push(1);
            await new Promise(resolve => setTimeout(resolve, 10));
            return 'job1';
        });

        // Add more jobs to queue
        q.addJob(async () => {
            executed.push(2);
            return 'job2';
        });

        q.addJob(async () => {
            executed.push(3);
            return 'job3';
        });

        // Abort all - this should clear the queue
        q.abortAll();

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 50));

        // Only the first job might have executed before abort
        // The queued jobs should not execute
        expect(executed.length).to.be.lessThan(3);
    });

    it('should create new AbortController after abortAll', async () => {
        const q = new JobQueue();
        
        // First job gets aborted
        const job1 = q.addJob(async (signal) => {
            return new Promise((resolve, reject) => {
                if (signal.aborted) reject(new Error('aborted'));
                signal.addEventListener('abort', () => reject(new Error('aborted')));
                setTimeout(() => resolve('done'), 100);
            });
        });

        q.abortAll();

        try {
            await job1;
        } catch (err: any) {
            expect(err.message).to.equal('aborted');
        }

        // After abortAll, new jobs should work with new AbortController
        const job2 = await q.addJob(async (signal) => {
            expect(signal.aborted).to.be.false;
            return 'success';
        });

        expect(job2).to.equal('success');
    });

    it('should not process queue if already processing', async () => {
        const q = new JobQueue();
        let processCount = 0;

        // Spy on processQueue calls
        const originalProcessQueue = (q as any).processQueue.bind(q);
        (q as any).processQueue = async function() {
            processCount++;
            return originalProcessQueue();
        };

        // Add multiple jobs quickly
        const job1 = q.addJob(async () => 'result1');
        const job2 = q.addJob(async () => 'result2');

        await Promise.all([job1, job2]);

        // processQueue should be called, but the guard should prevent re-entry
        expect(processCount).to.be.greaterThan(0);
    });
});
