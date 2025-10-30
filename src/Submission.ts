import { Identifier }                   from "fhir/r4";
import { hashString, roundToPrecision } from "./utils";
import { Job }                          from "./Job";
import StatusManifest                   from "./StatusManifest";
import { BASE_URL }                     from "./config";


export class Submission {
    slug: string;
    submissionId: string
    submitter: Identifier;
    readonly createdAt: string;
    jobs: Map<string, Job>;
    private _status: 'in-progress' | 'complete' | 'aborted';
    readonly statusManifest: StatusManifest;
    

    constructor(submissionId: string, submitter: Identifier) {
        this.submissionId   = submissionId;
        this.submitter      = submitter;
        this.slug           = Submission.computeSlug(submissionId, submitter);
        this.createdAt      = new Date().toISOString();
        this._status        = 'in-progress';
        this.jobs           = new Map();
        this.statusManifest = new StatusManifest(BASE_URL + `/status/${this.slug}`);
    }

    toString() {
        return `Submission(${this.submissionId}, ${this.submitter.system}|${this.submitter.value})`;
    }

    toJSON() {
        return {
            slug         : this.slug,
            submissionId : this.submissionId,
            submitter    : this.submitter,
            createdAt    : this.createdAt,
            status       : this.status,
            progress     : this.progress,
            jobs         : Array.from(this.jobs.values()).map(job => ({
                jobId      : job.jobId,
                status     : job.status,
                progress   : job.progress,
                error      : job.error,
            })),
        };
    }

    get status() {
        return this._status;
    }

    get progress(): number {
        if (this.jobs.size === 0) {
            return 0;
        }
        
        let totalJobs = this.jobs.size;
        let total = 0;
        
        this.jobs.forEach((job) => {
            total += job.progress;
        });

        return roundToPrecision(total / totalJobs, 2);
    }

    addJob(job: Job) {
        this.jobs.set(job.jobId, job);
    }

    removeJob(jobId: string) {
        this.jobs.delete(jobId);
    }

    getJobs(): Job[] {
        return Array.from(this.jobs.values());
    }

    async start() {
        // this._status = 'in-progress';
        // TODO: Also mark all associated jobs as in-progress?
        this.jobs.forEach((job) => {
            if (job.status === 'pending' || job.status === 'failed' || job.status === 'aborted') {
                job.start({
                    downloadComplete: (url, count) => this.statusManifest.addOutputFile(url, count)
                }).catch(console.error);
            }
        });
    }

    async complete() {
        this._status = 'complete';
        // TODO: Also mark all associated jobs as complete?
    }

    async abort() {
        this._status = 'aborted';
        // TODO: Also mark all associated jobs as aborted?
    }

    static computeSlug(submissionId: string, submitter: Identifier): string {
        return hashString(`${submitter.system}|${submitter.value}:${submissionId}`);
    }
}
