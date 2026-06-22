// backend/src/db/schema.ts

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
  unique,
  numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["user", "mistri", "admin"]);
export const serviceTypeEnum = pgEnum("service_type", ["electrician", "plumber"]);
export const locationSourceEnum = pgEnum("location_source", ["gps", "drag", "admin_manual"]);
export const serviceRequestStatusEnum = pgEnum("service_request_status", [
  "pending_approval",
  "pending",
  "assigned",
  "canceled",
  "completed"
]);
export const availabilityStatusEnum = pgEnum("availability_status", ["available", "unavailable", "on_work_available"]);
export const mistriApprovalStatusEnum = pgEnum("mistri_approval_status", ["pending", "approved", "rejected"]);

// Users table
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: userRoleEnum("role"),
  isActive: boolean("is_active").default(true).notNull(),
  deviceToken: text("device_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  isOnboarded: boolean("is_onboarded").default(false).notNull(),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  roleSelectedAt: timestamp("role_selected_at", { withTimezone: true }),
  defaultLocation: text("default_location"),
  isFlagged: boolean("is_flagged").default(false),
  flagNote: text("flag_note"),
  avatarUrl: text("avatar_url"),
  passwordHash: varchar("password_hash", { length: 255 }),
  isVerified: boolean("is_verified").default(false).notNull(),
  dob: varchar("dob", { length: 20 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  twoFaSecret: varchar("two_fa_secret", { length: 255 }),
  twoFaEnabled: boolean("two_fa_enabled").default(false),
  twoFaBackupCodes: text("two_fa_backup_codes").array(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
  attemptType: varchar("attempt_type", { length: 20 }).notNull(),
  success: boolean("success").default(false),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const otps = pgTable("otps", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 256 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ============================================
// LEVEL 1: SERVICE CATEGORIES
// ============================================

export const serviceCategories = pgTable("service_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  iconUrl: text("icon_url"),
  iconColor: varchar("icon_color", { length: 20 }).default('#1890ff'),
  isActive: boolean("is_active").default(true).notNull(),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  isActiveIdx: index("idx_service_categories_is_active").on(table.isActive),
  displayOrderIdx: index("idx_service_categories_display_order").on(table.displayOrder),
}));

// ============================================
// LEVEL 2: SERVICE SUB-CATEGORIES
// ============================================

export const serviceSubCategories = pgTable("service_sub_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: integer("category_id").notNull().references(() => serviceCategories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true).notNull(),
  isPopular: boolean("is_popular").default(false).notNull(),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueCategoryName: unique("service_sub_categories_category_id_name_unique").on(table.categoryId, table.name),
  categoryIdIdx: index("idx_service_sub_categories_category_id").on(table.categoryId),
  isActiveIdx: index("idx_service_sub_categories_is_active").on(table.isActive),
  isPopularIdx: index("idx_service_sub_categories_is_popular").on(table.isPopular),
}));

// ============================================
// LEVEL 3: SERVICE ITEMS
// ============================================

// backend/src/db/schema.ts

// Level 3: Service Items (under sub-categories)
export const serviceSubCategoryItems = pgTable("service_sub_category_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  subCategoryId: uuid("sub_category_id").notNull().references(() => serviceSubCategories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  durationMinutes: integer("duration_minutes"),
  isActive: boolean("is_active").default(true).notNull(),
  isPopular: boolean("is_popular").default(false).notNull(),
  imageUrl: text("image_url"),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueSubCategoryName: unique("service_sub_category_items_sub_category_id_name_unique").on(table.subCategoryId, table.name),
  subCategoryIdIdx: index("idx_service_sub_category_items_sub_category_id").on(table.subCategoryId),
  isActiveIdx: index("idx_service_sub_category_items_is_active").on(table.isActive),
  isPopularIdx: index("idx_service_sub_category_items_is_popular").on(table.isPopular),
}));

// ============================================
// LEGACY TABLES (Kept for backward compatibility)
// ============================================

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  serviceName: varchar("service_name", { length: 100 }).unique().notNull(),
  description: text("description"),
  mapIconColor: varchar("map_icon_color", { length: 7 }),
  isActive: boolean("is_active").default(true).notNull(),
  iconType: varchar("icon_type", { length: 20 }).default('antd'),
  iconName: varchar("icon_name", { length: 100 }).default('ToolOutlined'),
  customIconUrl: text("custom_icon_url"),
  iconColor: varchar("icon_color", { length: 20 }).default('#1890ff'),
});

export const platformServices = pgTable("platform_services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceId: integer("service_id").notNull().references(() => services.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  duration_minutes: integer("duration_minutes"),
  category: varchar("category", { length: 100 }),
  thumbnail_url: text("thumbnail_url"),
  isPopular: boolean("is_popular").default(false).notNull(),
  is_featured: boolean("is_featured").default(false),
});

export const serviceItems = pgTable("service_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  subCategoryId: uuid("sub_category_id").notNull().references(() => serviceSubCategories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  durationMinutes: integer("duration_minutes"),
  isActive: boolean("is_active").default(true).notNull(),
  isPopular: boolean("is_popular").default(false).notNull(),
  imageUrl: text("image_url"),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueSubCategoryName: unique("service_items_sub_category_id_name_unique").on(table.subCategoryId, table.name),
  subCategoryIdIdx: index("idx_service_items_sub_category_id").on(table.subCategoryId),
  isActiveIdx: index("idx_service_items_is_active").on(table.isActive),
  isPopularIdx: index("idx_service_items_is_popular").on(table.isPopular),
}));

export const mistriProfiles = pgTable("mistri_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => services.id),
  profilePhotoUrl: text("profile_photo_url"),
  bio: text("bio"),
  isAvailable: boolean("is_available").default(true).notNull(),
  availabilityStatus: availabilityStatusEnum("availability_status").default("available").notNull(),
  isFeatured: boolean("is_featured").default(false).notNull(),
  currentLocation: text("current_location"),
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
  type: varchar("type", { length: 100 }).notNull(),
  lat: decimal("lat", { precision: 10, scale: 6 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 6 }).notNull(),
  address: text("address").notNull(),
  source: locationSourceEnum("source").notNull(),
  assignedMistriId: uuid("assigned_mistri_id").references(() => users.id, { onDelete: "set null" }),
  status: serviceRequestStatusEnum("status").default("pending").notNull(),
  customerNotes: text("customer_notes"),
  adminNotes: text("admin_notes"),
  scheduledTime: timestamp("scheduled_time", { withTimezone: true }),
  preferCallExplanation: boolean("prefer_call_explanation").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  startedWorkAt: timestamp("started_work_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  unpaid: boolean("unpaid").default(false).notNull(),
  paymentAmount: decimal("payment_amount", { precision: 10, scale: 2 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  payoutId: uuid("payout_id"),
  commissionId: uuid("commission_id"),
});

export const serviceRequestPlatformServices = pgTable("service_request_platform_services", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceRequestId: uuid("service_request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  platformServiceId: uuid("platform_service_id").notNull().references(() => platformServices.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: index("srps_request_id_idx").on(table.serviceRequestId),
  serviceIdIdx: index("srps_platform_service_id_idx").on(table.platformServiceId),
}));

// ============================================
// OTHER TABLES (Notifications, Ratings, etc.)
// ============================================

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
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
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("phone_change_attempts_user_id_idx").on(table.userId),
  createdAtIdx: index("phone_change_attempts_created_at_idx").on(table.createdAt),
}));

export const ratings = pgTable("ratings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceRequestId: uuid("service_request_id").notNull().unique().references(() => serviceRequests.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mistriId: uuid("mistri_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  review: text("review"),
  isApproved: boolean("is_approved").default(false).notNull(),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mistriIdIdx: index("ratings_mistri_id_idx").on(table.mistriId),
  customerIdIdx: index("ratings_customer_id_idx").on(table.customerId),
  requestIdIdx: index("ratings_request_id_idx").on(table.serviceRequestId),
  isApprovedIdx: index("ratings_is_approved_idx").on(table.isApproved),
}));

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  performedBy: uuid("performed_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  performedByRole: userRoleEnum("performed_by_role").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  entityTypeIdx: index("audit_logs_entity_type_idx").on(table.entityType),
  entityIdIdx: index("audit_logs_entity_id_idx").on(table.entityId),
  performedByIdx: index("audit_logs_performed_by_idx").on(table.performedBy),
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
}));

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
  adType: varchar("ad_type", { length: 10 }).default('both'),
  videoUrl: text("video_url"),
}, (table) => ({
  displayOrderIdx: index("hero_banners_display_order_idx").on(table.displayOrder),
  isActiveIdx: index("hero_banners_is_active_idx").on(table.isActive),
  adTypeIdx: index("hero_banners_ad_type_idx").on(table.adType),
}));

export const smsTypeEnum = pgEnum("sms_type", [
  "otp_login",
  "otp_phone_change",
  "otp_account_deletion",
  "otp_admin",
  "service_accepted",
  "service_completed",
  "mistri_approved",
  "broadcast",
]);

export const smsLogs = pgTable("sms_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  to: varchar("to", { length: 20 }).notNull(),
  type: smsTypeEnum("type").notNull(),
  status: varchar("status", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  typeIdx: index("sms_logs_type_idx").on(table.type),
  statusIdx: index("sms_logs_status_idx").on(table.status),
  createdAtIdx: index("sms_logs_created_at_idx").on(table.createdAt),
}));

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 40 }).default("misc").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paidTo: varchar("paid_to", { length: 255 }),
  paymentMethod: varchar("payment_method", { length: 30 }),
  note: text("note"),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  categoryIdx: index("expenses_category_idx").on(table.category),
  incurredAtIdx: index("expenses_incurred_at_idx").on(table.incurredAt),
  createdAtIdx: index("expenses_created_at_idx").on(table.createdAt),
}));

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  mistriId: uuid("mistri_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobsCount: integer("jobs_count").notNull(),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).notNull(),
  netAmount: decimal("net_amount", { precision: 12, scale: 2 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  note: text("note"),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  mistriIdIdx: index("payouts_mistri_id_idx").on(table.mistriId),
  statusIdx: index("payouts_status_idx").on(table.status),
  createdAtIdx: index("payouts_created_at_idx").on(table.createdAt),
}));

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").default(true).notNull(),
  smsEnabled: boolean("sms_enabled").default(true).notNull(),
  quietHoursStart: varchar("quiet_hours_start", { length: 5 }),
  quietHoursEnd: varchar("quiet_hours_end", { length: 5 }),
  typeSettings: jsonb("type_settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
  designation: varchar("designation", { length: 100 }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  staffRoleIdx: index("employee_profiles_staff_role_idx").on(table.staffRole),
}));

// ============================================
// RELATIONS
// ============================================

export const serviceCategoriesRelations = relations(serviceCategories, ({ many }) => ({
  subCategories: many(serviceSubCategories),
}));

export const serviceSubCategoriesRelations = relations(serviceSubCategories, ({ one, many }) => ({
  category: one(serviceCategories, {
    fields: [serviceSubCategories.categoryId],
    references: [serviceCategories.id],
  }),
  items: many(serviceItems),
}));

export const serviceItemsRelations = relations(serviceItems, ({ one }) => ({
  subCategory: one(serviceSubCategories, {
    fields: [serviceItems.subCategoryId],
    references: [serviceSubCategories.id],
  }),
}));