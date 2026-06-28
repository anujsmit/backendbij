// backend/src/server.ts
import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import timeout from "connect-timeout";
// @ts-ignore - express-status-monitor has no types
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

// Auth Routes
import authRoutes from "./routes/auth";

// Admin Routes
import adminRoutes from "./routes/admin/admin";

// Mistri Routes
import mistriRoutes from "./routes/mistri";

// User Routes
import userRoutes from "./routes/auth/userAuth";

// Public Routes
import publicRoutes from "./routes/public";
import publicServicesRoutes from "./routes/publicServices";

// Feature Routes
import serviceRequestRoutes from "./routes/serviceRequest";
import notificationRoutes from "./routes/notifications";
import notificationPreferencesRoutes from "./routes/notificationPreferences";
import servicesRoutes from "./routes/services";
import platformServicesRoutes from "./routes/platformServices";
import ratingsRoutes from "./routes/ratings";
import configRoutes from "./routes/config";
import heroBannerRoutes from "./routes/heroBanners";
import orderRoutes from "./routes/orderRoutes";
import cartRoutes from "./routes/users/cartRoutes";
import consultationRoutes from "./routes/users/consultationRoutes";

const app = express();
const port = process.env.PORT || 3000;

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
    if (allowedOrigins.has(origin)) {
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

// ============================================
// ROUTES REGISTRATION
// ============================================

// ─── AUTH ROUTES ──────────────────────────
// Mount auth routes at /api/auth
// This handles: /api/auth/admin/*, /api/auth/mistri/*, /api/auth/user/*
app.use("/api/auth", authLimiter, authRoutes);

// ─── ADMIN ROUTES ────────────────────────
// Mount admin routes at /api/admin
// All admin routes are protected by authenticateAdmin + requireAdmin middleware
app.use("/api/admin", adminRoutes);

// ─── MISTRI ROUTES ──────────────────────
// Mount mistri routes at /api/mistri
// All mistri routes are protected by authenticateMistri middleware
app.use("/api/mistri", mistriRoutes);

// ─── USER ROUTES ────────────────────────
// Mount user routes at /api/user
// All user routes are protected by authenticateUser middleware
app.use("/api/user", userRoutes);

// ─── PUBLIC ROUTES ──────────────────────
// Public routes - no authentication required
app.use("/api/public", publicRoutes);
app.use("/api/public", publicServicesRoutes);

// ─── FEATURE ROUTES ──────────────────────
app.use("/api/service-requests", serviceRequestRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/notification-preferences", notificationPreferencesRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/platform-services", platformServicesRoutes);
app.use("/api/ratings", ratingsRoutes);
app.use("/api/config", configRoutes);
app.use("/api/hero-banners", heroBannerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/consultations", consultationRoutes);

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