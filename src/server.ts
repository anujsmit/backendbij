import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import timeout from "connect-timeout";
// @ts-ignore - express-status-monitor has no types
import statusMonitor from "express-status-monitor";
import authRoutes from "./routes/auth";
import serviceRequestRoutes from "./routes/serviceRequest";
import mistriRoutes from "./routes/mistri";
import notificationRoutes from "./routes/notifications";
import servicesRoutes from "./routes/services";
import platformServicesRoutes from "./routes/platformServices";
import ratingsRoutes from "./routes/ratings";
import configRoutes from "./routes/config";
import notificationPreferencesRoutes from "./routes/notificationPreferences";
import adminRoutes from "./routes/admin";
import heroBannerRoutes from "./routes/heroBanners";
import { networkInterfaces } from "os";
import { resumeRecentDispatches } from "./services/dispatch";
import { logger, httpLogger } from "./utils/logger";
import { checkDatabaseHealth, closeDatabaseConnections } from "./db";
import { closeQueues, getQueueStats } from "./services/queueService";
import { cacheService } from "./services/cacheService";
import publicRoutes from "./routes/public";
const app = express();
const port = process.env.PORT || 3000;
import publicServicesRoutes from "./routes/publicServices";
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

// CORS configuration
const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase();
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS?.split(',') || [])
    .map((origin: string) => normalizeOrigin(origin))
    .filter(Boolean)
);

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (allowedOrigins.has(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
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

// Routes
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/admin/auth", adminAuthLimiter);
app.use("/api/service-requests", serviceRequestRoutes);
app.use("/api/mistri", mistriRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/platform-services", platformServicesRoutes);
app.use("/api/ratings", ratingsRoutes);
app.use("/api/config", configRoutes);
app.use("/api/notification-preferences", notificationPreferencesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/hero-banners", heroBannerRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/public", publicServicesRoutes);
// Health check endpoints
app.get("/", (_req: express.Request, res: express.Response) => {
  res.json({ service: "ServeX API", status: "ok", timestamp: new Date().toISOString() });
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

// Graceful shutdown handler
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

// Start server
server = app.listen(Number(port), process.env.NODE_ENV === 'production' ? "127.0.0.1" : "0.0.0.0", () => {
  logger.info(`Server is running on port ${port} in ${process.env.NODE_ENV || 'development'} mode`);
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