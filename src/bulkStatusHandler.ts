import { Request, Response }      from "express";
import { createOperationOutcome } from "./utils";
import DB                         from "./db";


export default async function bulkStatusHandler(req: Request, res: Response): Promise<void> {
    const submission = await DB.submissions.find(req.params.id);
    
    // If no submission found, return 404
    if (!submission) {
        res.status(404).json(createOperationOutcome({
            severity   : 'error',
            code       : 'not-found',
            diagnostics: 'No submission found for the given id. Perhaps it expired and was cleaned up.'
        }));
        return;
    }

    // For aborted submissions, return an error as OperationOutcome
    if (submission.status === 'aborted') {
        res.status(500).json(createOperationOutcome({
            diagnostics: 'The submission has been aborted',
            severity   : 'error',
            code       : 'exception'
        }));
        return;
    }

    // Only return a manifest when the submission is in "complete" status and
    // all files have been processed (i.e. progress === 100) 
    if (submission.status === 'complete' && submission.progress === 100) {
        res.status(200).json(submission.statusManifest.toJSON());
        return;
    }

    // If submission is marked as in-progress, report the progress and exit,
    // even if the progress is 100%! Also, a submission can be marked as
    // complete even if it is still processing files (i.e. progress < 100%).
    res.status(202).header("X-Progress", submission.progress + '% processed').send();
}