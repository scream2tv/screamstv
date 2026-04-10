import { Router } from 'express';
import agentsRouter from './agents.js';
import streamsRouter from './streams.js';
import chatRouter from './chat.js';
import tipsRouter from './tips.js';

const router = Router();

router.use('/agents', agentsRouter);
router.use('/streams', streamsRouter);

// Chat and tips are nested under /streams/:streamKey but defined as separate routers
router.use('/streams', chatRouter);
router.use('/streams', tipsRouter);

export default router;
