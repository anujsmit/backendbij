import 'dotenv/config';
import { logger } from '../utils/logger';
import { smsQueue, pushQueue } from '../services/queueService';

// Start queue processors
async function startWorkers() {
    logger.info('Starting queue workers...');

    // Check if queues are Bull queues (have .on method) or SimpleQueue
    const isBullQueue = (queue: any): boolean => {
        return queue && typeof queue.on === 'function';
    };

    // Add event listeners only for Bull queues (Redis)
    if (isBullQueue(smsQueue)) {
        smsQueue.on('completed', (job: any) => {
            logger.info(`SMS job ${job.id} completed`);
        });

        smsQueue.on('failed', (job: any, err: Error) => {
            logger.error(`SMS job ${job?.id} failed:`, err);
        });

        smsQueue.on('error', (err: Error) => {
            logger.error('SMS queue error:', err);
        });

        logger.info('SMS queue event listeners registered (Bull/Redis)');
    } else {
        logger.info('SMS queue using in-memory mode (no event listeners)');
    }

    if (isBullQueue(pushQueue)) {
        pushQueue.on('completed', (job: any) => {
            logger.info(`Push job ${job.id} completed`);
        });

        pushQueue.on('failed', (job: any, err: Error) => {
            logger.error(`Push job ${job?.id} failed:`, err);
        });

        pushQueue.on('error', (err: Error) => {
            logger.error('Push queue error:', err);
        });

        logger.info('Push queue event listeners registered (Bull/Redis)');
    } else {
        logger.info('Push queue using in-memory mode (no event listeners)');
    }

    logger.info('Queue workers started successfully');

    // Log queue status every minute
    const intervalId = setInterval(async () => {
        try {
            const getQueueSize = async (queue: any): Promise<number> => {
                if (!queue) return 0;
                if (typeof queue.getWaitingCount === 'function') {
                    return await queue.getWaitingCount();
                }
                return 0;
            };

            const smsSize = await getQueueSize(smsQueue);
            const pushSize = await getQueueSize(pushQueue);

            if (smsSize > 0 || pushSize > 0) {
                logger.debug(`Queue sizes - SMS: ${smsSize}, Push: ${pushSize}`);
            }
        } catch (error) {
            // Silent fail for queue stats
        }
    }, 30000); // Every 30 seconds

    // Store interval ID for cleanup
    return intervalId;
}

// Graceful shutdown
const gracefulShutdown = async (signal: string, intervalId?: NodeJS.Timeout) => {
    logger.info(`${signal} received, closing queues...`);

    // Clear the interval
    if (intervalId) {
        clearInterval(intervalId);
    }

    const closeQueue = async (queue: any, name: string) => {
        if (queue && typeof queue.close === 'function') {
            try {
                await queue.close();
                logger.info(`${name} queue closed`);
            } catch (error) {
                logger.error(`Error closing ${name} queue:`, error);
            }
        }
    };

    await Promise.all([
        closeQueue(smsQueue, 'SMS'),
        closeQueue(pushQueue, 'Push'),
    ]);

    logger.info('Queue workers shut down complete');
    process.exit(0);
};

// Start workers and store interval ID
let intervalId: NodeJS.Timeout | undefined;

startWorkers()
    .then((id) => {
        intervalId = id;

        // Setup signal handlers after workers are started
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM', intervalId));
        process.on('SIGINT', () => gracefulShutdown('SIGINT', intervalId));

        // Handle uncaught errors
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception in queue worker:', error);
            gracefulShutdown('UNCAUGHT_EXCEPTION', intervalId);
        });

        process.on('unhandledRejection', (reason) => {
            logger.error('Unhandled Rejection in queue worker:', reason);
            gracefulShutdown('UNHANDLED_REJECTION', intervalId);
        });
    })
    .catch((error) => {
        logger.error('Failed to start workers:', error);
        process.exit(1);
    });