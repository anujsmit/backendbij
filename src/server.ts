// backend/src/server.ts
import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import timeout from "connect-timeout";
import statusMonitor from "express-status-monitor";
import { networkInterfaces } from "os";
import { resumeRecentDispatches } from "./services/dispatch";
import { logger, httpLogger } from "./utils/logger";
import { checkDatabaseHealth, closeDatabaseConnections } from "./db";
import { closeQueues, getQueueStats } from "./services/queueService";
import { cacheService } from "./services/cacheService";

// ============================================
// ROUTE IMPORTS
// ============================================

// ✅ Main router aggregator - all routes are now organized here
import routes from "./routes";

const app = express();
const port = process.env.PORT || 5000;
const host = process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';

// Trust proxy (for rate limiting behind nginx)
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : 0);

// Request timeout (30 seconds)
app.use(timeout('30s'));

// Structured logging for HTTP requests
app.use(httpLogger);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Compression
app.use(compression({
  level: 6,
  threshold: 1024, // Compress responses > 1KB
}));

// Performance monitoring
app.use(statusMonitor({
  path: '/status',
  spans: [
    { interval: 1, retention: 60 },
    { interval: 5, retention: 60 },
    { interval: 15, retention: 60 },
  ],
  chartVisibility: {
    cpu: true,
    mem: true,
    load: true,
    responseTime: true,
    rps: true,
    statusCodes: true,
  },
}));

// Helper function for IP key generation
const ipKeyGenerator = (ip: string): string => {
  return ip;
};

// ============================================
// ✅ FIXED: CORS CONFIGURATION
// ============================================

const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase();

// Build allowed origins from environment
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS?.split(',') || [])
    .map((origin: string) => normalizeOrigin(origin))
    .filter(Boolean)
);

// ✅ Add development origins
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:3001');
  allowedOrigins.add('http://localhost:3002');
  allowedOrigins.add('http://localhost:3003');
  allowedOrigins.add('http://127.0.0.1:3000');
  allowedOrigins.add('http://127.0.0.1:3001');
  // ✅ Allow any ngrok URL pattern
  allowedOrigins.add('https://*.ngrok-free.dev');
  allowedOrigins.add('https://*.ngrok.io');
}

console.log('✅ Allowed CORS origins:', Array.from(allowedOrigins));

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      return callback(null, true);
    }

    // ✅ Development: allow all origins
    if (process.env.NODE_ENV !== 'production') {
      // Check if origin is localhost or ngrok
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
      const isNgrok = origin.includes('ngrok-free.dev') || origin.includes('ngrok.io');
      
      if (isLocalhost || isNgrok) {
        console.log(`✅ CORS allowed (dev): ${origin}`);
        return callback(null, true);
      }
      
      // Check against allowed origins
      const normalized = normalizeOrigin(origin);
      if (allowedOrigins.has(normalized)) {
        console.log(`✅ CORS allowed (config): ${origin}`);
        return callback(null, true);
      }
      
      // ⚠️ In development, allow all for debugging (but log it)
      console.log(`⚠️ CORS allowing (dev fallback): ${origin}`);
      return callback(null, true);
    }

    // Production: strict checking
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) {
      return callback(null, true);
    }

    console.warn(`❌ CORS blocked: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  maxAge: 86400, // Cache preflight for 24 hours
}));

// ============================================
// RATE LIMITING
// ============================================

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 200,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminAuthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many admin login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: express.Request) => {
    const ip = ipKeyGenerator(req.ip ?? '');
    const phone = req.body?.phone ? String(req.body.phone).replace(/\s+/g, '') : '';
    return `${ip}:${phone}`;
  },
});

// Apply middleware
app.use('/api/', globalLimiter);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ============================================
// ROUTES REGISTRATION - CLEAN & ORGANIZED
// ============================================
app.use("/api", routes);

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

app.get("/", (_req: express.Request, res: express.Response) => {
  res.json({ 
    service: "ServeX API", 
    status: "ok", 
    timestamp: new Date().toISOString() 
  });
});

app.get("/health", async (_req: express.Request, res: express.Response) => {
  const dbHealthy = await checkDatabaseHealth();
  const cacheHealthy = cacheService.isEnabled();
  
  res.json({
    status: dbHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    components: {
      database: dbHealthy ? "up" : "down",
      cache: cacheHealthy ? "up" : "disabled",
      queues: "up",
    },
  });
});

app.get("/health/queues", async (_req: express.Request, res: express.Response) => {
  const stats = await getQueueStats();
  res.json({ status: "ok", queues: stats });
});

app.get("/health/cache", async (_req: express.Request, res: express.Response) => {
  if (!cacheService.isEnabled()) {
    return res.json({ status: "disabled", message: "Redis not configured" });
  }
  try {
    await cacheService.set("health-check", "ok", 10);
    const value = await cacheService.get("health-check");
    res.json({ status: "ok", redis: value === "ok" ? "connected" : "error" });
  } catch (error) {
    res.status(503).json({ status: "error", message: "Redis connection failed" });
  }
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

// Handle timeout errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.timeout) {
    return res.status(408).json({
      success: false,
      message: 'Request timeout'
    });
  }
  next(err);
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  
  const statusCode = err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({
    success: false,
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

let server: any;

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Close database connections
      await closeDatabaseConnections();
      
      // Close queues
      await closeQueues();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
  }
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// ============================================
// START SERVER
// ============================================

server = app.listen(Number(port), host, () => {
  logger.info(`Server is running on port ${port} in ${process.env.NODE_ENV || 'development'} mode`);
  logger.info(`Host: ${host}`);
  
  // Print network interfaces
  const nets = networkInterfaces();
  logger.debug("Available network interfaces:");
  Object.keys(nets).forEach((name) => {
    nets[name]?.forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) {
        logger.debug(`  ${name}: http://${net.address}:${port}`);
      }
    });
  });
  
  logger.debug(`  localhost: http://localhost:${port}`);
  
  // Resume dispatches
  void resumeRecentDispatches();
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

export default app;