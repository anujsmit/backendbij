import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
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

const app = express();
const port = process.env.PORT || 3000;

// Trust the first proxy (reverse proxy / load balancer in production)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images from Supabase storage
}));

// CORS configuration
const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase();
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS?.split(',') || [])
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production, check against allowed origins
    if (allowedOrigins.has(normalizeOrigin(origin))) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Global rate limiting - 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production', // Skip in development
});

// Stricter rate limiting for auth endpoints - 20 requests per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
});

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many admin login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.phone ?? '').replace(/\s+/g, '')}`,
});

// Apply global rate limiting
app.use('/api/', globalLimiter);

// Increase JSON payload limit to handle large base64 images
app.use(express.json({ limit: '5mb' }));

// Apply stricter rate limiting for auth routes
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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);

  // Print out all available IP addresses
  const nets = networkInterfaces();
  console.log("\nAvailable network interfaces:");

  Object.keys(nets).forEach((name) => {
    nets[name]?.forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  ${name}: http://${net.address}:${port}`);
      }
    });
  });

  console.log(`  localhost: http://localhost:${port}`);
});
