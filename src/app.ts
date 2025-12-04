import cors                                         from 'cors';
import path                                         from 'path';
import express, { NextFunction, Request, Response } from 'express';
import serveIndex                                   from 'serve-index';
import { asyncHandler, createOperationOutcome }     from './utils';
import bulkSubmitHandler                            from './bulkSubmitHandler';
import bulkStatusHandler                            from './bulkStatusHandler';
import bulkStatusKickoffHandler                     from './bulkStatusKickoffHandler';
import { register }                                 from './auth/register';
import { OAuthError }                               from './auth/OAuthError';
import { tokenHandler }                             from './auth/token';


export default function createApp() {
    const app = express();

    app.disable('x-powered-by');

    app.use(cors());
    app.use(express.json({ limit: '1mb' }));

    // Set the view engine to Pug
    app.set('view engine', 'pug');
    app.set('views', path.join(__dirname, 'views'));

    // Define routes for the frontend
    app.get('/', (req, res) => { res.render('index'); });

    app.get('/register', (req, res) => { res.render('register'); });

    app.post('/$bulk-submit'               , asyncHandler(bulkSubmitHandler));
    app.post('/$bulk-submit-status'        , asyncHandler(bulkStatusKickoffHandler));
    app.get ('/$bulk-submit-status/:id'    , asyncHandler(bulkStatusHandler));
    // app.get ('/jobs/:jobId/files/:fileName', bulkStatusFileHandler);

    app.post('/register', express.urlencoded({ extended: false }), register);
    app.post('/token'   , express.urlencoded({ extended: false }), tokenHandler);

    app.use('/jobs', express.static('jobs', { dotfiles: 'deny', index: false  }));
    app.use('/jobs', serveIndex('jobs', { icons: true, view: 'details' }));

    // Global express error handler
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        // console.error(err.stack);

        if (err instanceof OAuthError) {
            res.status(err.code).json({
                "error": err.type,
                "error_description": err.message
            });
            return;
        }

        res.status((err as any).code || 500).json(createOperationOutcome({
            diagnostics: err.message,
            severity   : 'error',
            code       : 'exception'
        }));
    });

    return app;
}