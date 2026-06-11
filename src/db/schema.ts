import {
  pgTable,
  text,
  varchar,
  uuid,
  pgEnum,
  boolean,
  timestamp,
  serial,
  integer,
  decimal,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["user", "mistri", "admin"]);
export const serviceTypeEnum = pgEnum("service_type", ["electrician", "plumber"]);
export const locationSourceEnum = pgEnum("location_source", ["gps", "drag"]);
export const serviceRequestStatusEnum = pgEnum("service_request_status", ["pending", "assigned", "canceled", "completed"]);
export const availabilityStatusEnum = pgEnum("availability_status", ["available", "unavailable", "on_work_available"]);
export const mistriApprovalStatusEnum = pgEnum("mistri_approval_status", ["pending", "approved", "rejected"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: userRoleEnum("role"), // No default - user must explicitly choose role
  isActive: boolean("is_active").default(true).notNull(),
  deviceToken: text("device_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  isOnboarded: boolean("is_onboarded").default(false).notNull(),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  roleSelectedAt: timestamp("role_selected_at", { withTimezone: true }),
  defaultLocation: text("default_location"),
});

export const otps = pgTable("otps", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 256 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  serviceName: varchar("service_name", { length: 100 }).unique().notNull(),
  description: text("description"),
  mapIconColor: varchar("map_icon_color", { length: 7 }),
  isActive: boolean("is_active").default(true).notNull(),
});

export const mistriProfiles = pgTable("mistri_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => services.id),
  profilePhotoUrl: text("profile_photo_url"),
  bio: text("bio"),
  isAvailable: boolean("is_available").default(true).notNull(),
  availabilityStatus: availabilityStatusEnum("availability_status").default("available").notNull(),
  isFeatured: boolean("is_featured").default(false).notNull(),
  currentLocation: text("current_location"), // geography type would need extension
  averageRating: decimal("average_rating", { precision: 3, scale: 2 }).default("0.00"),
  jobsCompleted: integer("jobs_completed").default(0),
  experienceLevel: varchar("experience_level", { length: 50 }),
  govtIdType: varchar("govt_id_type", { length: 50 }),
  govtIdFrontUrl: text("govt_id_front_url"),
  govtIdBackUrl: text("govt_id_back_url"),
  approvalStatus: mistriApprovalStatusEnum("approval_status").default("pending").notNull(),
  approvalRejectionReason: text("approval_rejection_reason"),
});

export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 100 }).notNull(), // Dynamic service type from services table
  lat: decimal("lat", { precision: 10, scale: 6 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 6 }).notNull(),
  address: text("address").notNull(),
  source: locationSourceEnum("source").notNull(),
  assignedMistriId: uuid("assigned_mistri_id").references(() => users.id, { onDelete: "set null" }),
  status: serviceRequestStatusEnum("status").default("pending").notNull(),
  customerNotes: text("customer_notes"), // Custom description/notes from customer
  preferCallExplanation: boolean("prefer_call_explanation").default(false).notNull(), // Customer prefers to explain in call
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  startedWorkAt: timestamp("started_work_at", { withTimezone: true }), // When mistri actually started working
  completedAt: timestamp("completed_at", { withTimezone: true }),
  unpaid: boolean("unpaid").default(false).notNull(),
  paymentAmount: decimal("payment_amount", { precision: 10, scale: 2 }), // Actual payment amount (calculated from services)
  paidAt: timestamp("paid_at", { withTimezone: true }), // When marked as paid
  payoutId: uuid("payout_id"), // FK -> payouts.id; set when this job's commission is included in a settlement (prevents double-settle)
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'new_request', 'request_accepted', 'request_completed', etc.
  relatedRequestId: uuid("related_request_id").references(() => serviceRequests.id, { onDelete: "cascade" }),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  token: text("token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
}));

export const phoneChangeAttempts = pgTable("phone_change_attempts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  oldPhoneNumber: varchar("old_phone_number", { length: 20 }),
  newPhoneNumber: varchar("new_phone_number", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // 'success', 'failed'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("phone_change_attempts_user_id_idx").on(table.userId),
  createdAtIdx: index("phone_change_attempts_created_at_idx").on(table.createdAt),
}));

// Platform-wide pre-defined services with standard pricing
export const platformServices = pgTable("platform_services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceId: integer("service_id").notNull().references(() => services.id), // Links to service category (plumber/electrician)
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Standard platform price in NPR
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  serviceIdIdx: index("platform_services_service_id_idx").on(table.serviceId),
  isActiveIdx: index("platform_services_is_active_idx").on(table.isActive),
}));

// Mistri-specific services (individual services created by each mistri)
export const mistriServices = pgTable("mistri_services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  mistriId: uuid("mistri_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Price in local currency
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true).notNull(),
  needsApproval: boolean("needs_approval").default(false).notNull(), // For testing, set to false
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mistriIdIdx: index("mistri_services_mistri_id_idx").on(table.mistriId),
  isActiveIdx: index("mistri_services_is_active_idx").on(table.isActive),
}));

// Junction table for service requests and Mistri Home Services (many-to-many) - DEPRECATED
export const serviceRequestServices = pgTable("service_request_services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceRequestId: uuid("service_request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  mistriServiceId: uuid("mistri_service_id").notNull().references(() => mistriServices.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: index("service_request_services_request_id_idx").on(table.serviceRequestId),
  serviceIdIdx: index("service_request_services_service_id_idx").on(table.mistriServiceId),
}));

// Junction table for service requests and Platform Services (many-to-many)
export const serviceRequestPlatformServices = pgTable("service_request_platform_services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceRequestId: uuid("service_request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  platformServiceId: uuid("platform_service_id").notNull().references(() => platformServices.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: index("srps_request_id_idx").on(table.serviceRequestId),
  serviceIdIdx: index("srps_platform_service_id_idx").on(table.platformServiceId),
}));

// Ratings and reviews
export const ratings = pgTable("ratings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceRequestId: uuid("service_request_id").notNull().unique().references(() => serviceRequests.id, { onDelete: "cascade" }), // One rating per request
  customerId: uuid("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mistriId: uuid("mistri_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1-5 stars
  review: text("review"), // Optional text review
  isApproved: boolean("is_approved").default(false).notNull(), // Admin approval status
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }), // Admin who approved
  approvedAt: timestamp("approved_at", { withTimezone: true }), // When approved
  rejectionReason: text("rejection_reason"), // Why rejected (if applicable)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mistriIdIdx: index("ratings_mistri_id_idx").on(table.mistriId),
  customerIdIdx: index("ratings_customer_id_idx").on(table.customerId),
  requestIdIdx: index("ratings_request_id_idx").on(table.serviceRequestId),
  isApprovedIdx: index("ratings_is_approved_idx").on(table.isApproved),
}));

// Audit logs for tracking all important actions
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: varchar("entity_type", { length: 50 }).notNull(), // 'service_request', 'user', 'rating', etc.
  entityId: uuid("entity_id").notNull(), // ID of the entity being modified
  action: varchar("action", { length: 50 }).notNull(), // 'status_change', 'unpaid_toggle', 'cancel', 'decline', etc.
  performedBy: uuid("performed_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  performedByRole: userRoleEnum("performed_by_role").notNull(), // Role at time of action
  oldValue: jsonb("old_value"), // Previous state
  newValue: jsonb("new_value"), // New state
  metadata: jsonb("metadata"), // Additional context (IP, user agent, etc.)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  entityTypeIdx: index("audit_logs_entity_type_idx").on(table.entityType),
  entityIdIdx: index("audit_logs_entity_id_idx").on(table.entityId),
  performedByIdx: index("audit_logs_performed_by_idx").on(table.performedBy),
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
}));

// Hero banners shown on customer home screen
export const heroBanners = pgTable("hero_banners", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }),
  subtitle: text("subtitle"),
  imageUrl: text("image_url").notNull(),
  linkUrl: text("link_url"),
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  displayOrderIdx: index("hero_banners_display_order_idx").on(table.displayOrder),
  isActiveIdx: index("hero_banners_is_active_idx").on(table.isActive),
}));

// SMS log — one row per outbound SMS sent (or attempted)
export const smsTypeEnum = pgEnum("sms_type", [
  "otp_login",
  "otp_phone_change",
  "otp_account_deletion",
  "otp_admin",
  "service_accepted",
  "service_completed",
  "mistri_approved",
]);

export const smsLogs = pgTable("sms_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  to: varchar("to", { length: 20 }).notNull(),
  type: smsTypeEnum("type").notNull(),
  status: varchar("status", { length: 10 }).notNull(), // 'success' | 'failed'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  typeIdx: index("sms_logs_type_idx").on(table.type),
  statusIdx: index("sms_logs_status_idx").on(table.status),
  createdAtIdx: index("sms_logs_created_at_idx").on(table.createdAt),
}));

// Business operating expenses recorded by admin (rent, salaries, marketing, etc.)
// Category is a curated varchar set (validated in the app) — kept flexible to avoid enum migrations.
export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 40 }).default("misc").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // NPR
  paidTo: varchar("paid_to", { length: 255 }), // vendor / payee
  paymentMethod: varchar("payment_method", { length: 30 }), // cash | bank | wallet | online
  note: text("note"),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).defaultNow().notNull(), // business date of the expense
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  categoryIdx: index("expenses_category_idx").on(table.category),
  incurredAtIdx: index("expenses_incurred_at_idx").on(table.incurredAt),
  createdAtIdx: index("expenses_created_at_idx").on(table.createdAt),
}));

// Platform key/value settings (e.g. commission_rate). Small, app-managed.
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Provider commission settlements. In ServeX's cash flow the mistri collects the
// full job amount and OWES the platform its commission; a payout batches a set of
// completed+paid jobs and records the commission the platform collects from them.
export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  mistriId: uuid("mistri_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobsCount: integer("jobs_count").notNull(),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(), // sum of job payment amounts
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull(), // % snapshot at settlement time
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).notNull(), // platform's cut (collected from mistri)
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull(), // gross - commission (mistri keeps this)
  status: varchar("status", { length: 20 }).default("pending").notNull(), // 'pending' | 'collected'
  note: text("note"),
  periodEnd: timestamp("period_end", { withTimezone: true }), // latest job paidAt included
  settledAt: timestamp("settled_at", { withTimezone: true }), // when marked collected
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mistriIdIdx: index("payouts_mistri_id_idx").on(table.mistriId),
  statusIdx: index("payouts_status_idx").on(table.status),
  createdAtIdx: index("payouts_created_at_idx").on(table.createdAt),
}));

// Notification preferences for users
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").default(true).notNull(), // Push notifications enabled
  smsEnabled: boolean("sms_enabled").default(true).notNull(), // SMS notifications enabled
  quietHoursStart: varchar("quiet_hours_start", { length: 5 }), // "22:00" format (HH:mm)
  quietHoursEnd: varchar("quiet_hours_end", { length: 5 }), // "08:00" format (HH:mm)
  typeSettings: jsonb("type_settings"), // Per-notification-type settings { "new_request": { push: true, sms: true }, ... }
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Admin-panel team members (RBAC). An "employee" is a users row with
// role='admin' PLUS this profile carrying their staff role + permission set.
// An admin WITHOUT a profile is treated as super-admin (legacy full access).
export const staffRoleEnum = pgEnum("staff_role", [
  "super_admin",
  "manager",
  "dispatcher",
  "support",
  "finance",
]);

export const employeeProfiles = pgTable("employee_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  staffRole: staffRoleEnum("staff_role").default("support").notNull(),
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(), // explicit permission keys; ['*'] = all
  designation: varchar("designation", { length: 100 }), // optional job title
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  staffRoleIdx: index("employee_profiles_staff_role_idx").on(table.staffRole),
}));