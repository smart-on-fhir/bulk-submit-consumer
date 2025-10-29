import { Identifier }                from "fhir/r4";
import { join }                      from "path";
import { rmdir }                     from "fs";
import { Submission }                from "./Submission";
import { SUBMISSION_LIFETIME_HOURS } from "./config";

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
    SUBMISSIONS.forEach((submission) => {
        // Delete submissions older than SUBMISSION_LIFETIME_HOURS hours
        if (new Date(submission.createdAt) < new Date(Date.now() - SUBMISSION_LIFETIME_HOURS * 60 * 60 * 1000)) {
            const slug = Submission.computeSlug(submission.submissionId, submission.submitter);
            SUBMISSIONS.delete(slug);
            rmdir(join(__dirname, `../jobs/${submission.submissionId}`), { recursive: true }, (err) => {
                if (err) {
                    console.error(`Error deleting submission directory for ${slug}:`, err);
                }
            });
        }
    });

    setTimeout(cleanup, Math.round(SUBMISSION_LIFETIME_HOURS * 60 * 60 * 1000)).unref();
}

// Initial cleanup on startup
cleanup();
