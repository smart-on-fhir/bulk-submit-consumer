import express, { NextFunction, Request, Response } from 'express';
import cors                                         from 'cors';
import { asyncHandler, createOperationOutcome }     from './utils';
import bulkSubmitHandler        from './bulkSubmitHandler';
import bulkStatusHandler        from './bulkStatusHandler';
import bulkStatusKickoffHandler from './bulkStatusKickoffHandler';
import bulkStatusFileHandler    from './bulkStatusFileHandler';


export default function createApp() {
    const app = express();

    app.disable('x-powered-by');

    app.use(cors());
    app.use(express.json({ limit: '1mb' }));

    app.post('/$bulk-submit'               , asyncHandler(bulkSubmitHandler));
    app.post('/$bulk-submit-status'        , asyncHandler(bulkStatusKickoffHandler));
    app.get ('/$bulk-submit-status/:id'    , asyncHandler(bulkStatusHandler));
    app.get ('/jobs/:jobId/files/:fileName', bulkStatusFileHandler);

    // Global express error handler
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error(err.stack);
        res.status(500).json(createOperationOutcome({
            diagnostics: err.message,
            severity   : 'error',
            code       : 'exception'
        }));
    });

    return app;
}