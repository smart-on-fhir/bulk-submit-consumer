import { Identifier }                from "fhir/r4";
import { join }                      from "path";
import { debuglog }                  from "util";
import { rm }                        from "fs";
import { Submission }                from "./Submission";
import {
    PENDING_SUBMISSION_LIFETIME_HOURS,
    COMPLETED_SUBMISSION_LIFETIME_HOURS
} from "./config";


const debug = debuglog("app:db");

/**
 * Used to look up submissions in the in-memory database by submissionId and
 * submitter identifier.
 */
interface SubmissionIdentifier {
    submissionId: string;
    submitter: Identifier;
}

/**
 * In-memory database for submissions and jobs.
 */
const SUBMISSIONS = new Map<string, Submission>();

export const DB = {

    submissions: {

        async getAll(): Promise<Submission[]> {
            return Array.from(SUBMISSIONS.values());
        },

        async add(id: SubmissionIdentifier): Promise<Submission> {
            const slug = Submission.computeSlug(id.submissionId, id.submitter);
            if (SUBMISSIONS.has(slug)) {
                throw new Error(
                    `Submission with id ${slug} already exists`
                );
            }
            const submission = new Submission(id.submissionId, id.submitter);
            SUBMISSIONS.set(slug, submission);
            return submission
        },
        
        async delete(id: string | SubmissionIdentifier): Promise<void> {
            if (typeof id === 'string') {
                SUBMISSIONS.delete(id);
                return;
            }
            const slug = Submission.computeSlug(id.submissionId, id.submitter);
            SUBMISSIONS.delete(slug);
        },
        
        async find(id: string | SubmissionIdentifier): Promise<Submission | null> {
            if (typeof id === 'string') {
                return SUBMISSIONS.get(id) || null;
            }
            const slug = Submission.computeSlug(id.submissionId, id.submitter);
            return SUBMISSIONS.get(slug) || null;
        },
        
        async findOrCreate(id: SubmissionIdentifier): Promise<Submission> {
            let submission = await this.find(id);
            if (!submission) {
                submission = await this.add(id);
            }
            return submission;
        }
    }
};

export default DB;

function cleanup() {
    if (SUBMISSIONS.size > 0) {
        SUBMISSIONS.forEach((submission) => {

            // Different thresholds for completed vs pending submissions
            const threshold = submission.status === 'complete'
                ? new Date(Date.now() - Math.ceil(COMPLETED_SUBMISSION_LIFETIME_HOURS * 60 * 60 * 1000))
                : new Date(Date.now() - Math.ceil(PENDING_SUBMISSION_LIFETIME_HOURS   * 60 * 60 * 1000));

            if (new Date(submission.createdAt) < threshold) {
                debug(`Cleaning up submission ${submission.submissionId} created at ${submission.createdAt}`);
                const slug = Submission.computeSlug(submission.submissionId, submission.submitter);
                SUBMISSIONS.delete(slug);
                rm(join(__dirname, `../jobs/${submission.submissionId}`), { recursive: true }, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        console.error(`Error deleting submission directory for ${slug}:`, err);
                    }
                });
            }
        });
    }
    
    // We may not have any submissions, but still want to clean up old job
    // directories (happens on server restart or after tests run)
    else {
        debug(`Cleaning up all job directories`);
        rm(join(__dirname, `../jobs/`), { recursive: true, maxRetries: 3 }, (err) => {
            if (err && err.code !== 'ENOENT') {
                debug(`Error deleting submissions directory:`, err);
            }
        });
    }

    setTimeout(cleanup, 60 * 1000).unref();
}

// Initial cleanup on startup
cleanup();
