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

// ============================================
// ENUMS
// ============================================

export const userRoleEnum = pgEnum("user_role", ["admin"]);
export const accountTypeEnum = pgEnum("account_type", ["user", "mistri", "admin"]);
export const serviceTypeEnum = pgEnum("service_type", ["electrician", "plumber"]);
export const locationSourceEnum = pgEnum("location_source", ["gps", "drag", "admin_manual"]);
export const serviceRequestStatusEnum = pgEnum("service_request_status", [
  "pending",
  "assigned",
  "canceled",
  "completed"
]);
export const availabilityStatusEnum = pgEnum("availability_status", ["available", "unavailable", "on_work_available"]);
export const mistriApprovalStatusEnum = pgEnum("mistri_approval_status", ["pending", "approved", "rejected"]);
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
export const staffRoleEnum = pgEnum("staff_role", [
  "super_admin",
  "manager",
  "dispatcher",
  "support",
  "finance",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
  "rejected"
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded"
]);
export const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "paid",
  "cancelled"
]);

// ============================================
// ADMIN TABLE (Only admins)
// ============================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull().default("admin"),
  isActive: boolean("is_active").default(true).notNull(),
  deviceToken: text("device_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  isOnboarded: boolean("is_onboarded").default(true).notNull(),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  roleSelectedAt: timestamp("role_selected_at", { withTimezone: true }),
  defaultLocation: text("default_location"),
  isFlagged: boolean("is_flagged").default(false),
  flagNote: text("flag_note"),
  avatarUrl: text("avatar_url"),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isVerified: boolean("is_verified").default(true).notNull(),
  dob: varchar("dob", { length: 20 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  twoFaSecret: varchar("two_fa_secret", { length: 255 }),
  twoFaEnabled: boolean("two_fa_enabled").default(false),
  twoFaBackupCodes: text("two_fa_backup_codes").array(),
  deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
}, (table) => ({
  phoneIdx: index("idx_users_phone").on(table.phoneNumber),
  roleIdx: index("idx_users_role").on(table.role),
  isActiveIdx: index("idx_users_is_active").on(table.isActive),
  isFlaggedIdx: index("idx_users_is_flagged").on(table.isFlagged),
  deletionScheduledAtIdx: index("idx_users_deletion_scheduled_at").on(table.deletionScheduledAt),
}));

// ============================================
// USER ACCOUNTS TABLE (Customers)
// ============================================

export const userAccounts = pgTable("user_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  accountType: accountTypeEnum("account_type").default("user").notNull(),
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
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  dob: varchar("dob", { length: 20 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  twoFaSecret: varchar("two_fa_secret", { length: 255 }),
  twoFaEnabled: boolean("two_fa_enabled").default(false),
  twoFaBackupCodes: text("two_fa_backup_codes").array(),
  deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
  email: varchar("email", { length: 255 }),
  preferences: jsonb("preferences").default({}),
}, (table) => ({
  phoneIdx: index("idx_user_accounts_phone").on(table.phoneNumber),
  isActiveIdx: index("idx_user_accounts_is_active").on(table.isActive),
  isOnboardedIdx: index("idx_user_accounts_is_onboarded").on(table.isOnboarded),
  isVerifiedIdx: index("idx_user_accounts_is_verified").on(table.isVerified),
  isFlaggedIdx: index("idx_user_accounts_is_flagged").on(table.isFlagged),
  deletionScheduledAtIdx: index("idx_user_accounts_deletion_scheduled_at").on(table.deletionScheduledAt),
}));

// ============================================
// MISTRI ACCOUNTS TABLE (Service Providers)
// ============================================

export const mistriAccounts = pgTable("mistri_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  accountType: accountTypeEnum("account_type").default("mistri").notNull(),
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
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  dob: varchar("dob", { length: 20 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  twoFaSecret: varchar("two_fa_secret", { length: 255 }),
  twoFaEnabled: boolean("two_fa_enabled").default(false),
  twoFaBackupCodes: text("two_fa_backup_codes").array(),
  deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
  email: varchar("email", { length: 255 }),
  preferences: jsonb("preferences").default({}),
}, (table) => ({
  phoneIdx: index("idx_mistri_accounts_phone").on(table.phoneNumber),
  isActiveIdx: index("idx_mistri_accounts_is_active").on(table.isActive),
  isOnboardedIdx: index("idx_mistri_accounts_is_onboarded").on(table.isOnboarded),
  isVerifiedIdx: index("idx_mistri_accounts_is_verified").on(table.isVerified),
  isFlaggedIdx: index("idx_mistri_accounts_is_flagged").on(table.isFlagged),
  deletionScheduledAtIdx: index("idx_mistri_accounts_deletion_scheduled_at").on(table.deletionScheduledAt),
}));

// ============================================
// LOGIN ATTEMPTS (Updated with account_type)
// ============================================

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
  userId: uuid("user_id"),
  accountType: accountTypeEnum("account_type").notNull(),
  attemptType: varchar("attempt_type", { length: 20 }).notNull(),
  success: boolean("success").default(false),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_login_attempts_user_id").on(table.userId),
  phoneIdx: index("idx_login_attempts_phone").on(table.phoneNumber),
  accountTypeIdx: index("idx_login_attempts_account_type").on(table.accountType),
  createdAtIdx: index("idx_login_attempts_created_at").on(table.createdAt),
}));

// ============================================
// OTPS (Updated with account_type)
// ============================================

// backend/src/db/schema.ts

export const otps = pgTable("otps", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 256 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, (table) => ({
  phoneIdx: index("idx_otps_phone").on(table.phone),
  accountTypeIdx: index("idx_otps_account_type").on(table.accountType),
  expiresAtIdx: index("idx_otps_expires_at").on(table.expiresAt),
}));

// ============================================
// REFRESH TOKENS (Updated with account_type)
// ============================================

export const refreshTokens = pgTable("refresh_tokens", {
  token: text("token").primaryKey(),
  userId: uuid("user_id").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
  accountTypeIdx: index("refresh_tokens_account_type_idx").on(table.accountType),
}));

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
  durationMinutes: integer("duration_minutes"),
  category: varchar("category", { length: 100 }),
  thumbnailUrl: text("thumbnail_url"),
  isPopular: boolean("is_popular").default(false).notNull(),
  isFeatured: boolean("is_featured").default(false),
}, (table) => ({
  serviceIdIdx: index("platform_services_service_id_idx").on(table.serviceId),
  isActiveIdx: index("platform_services_is_active_idx").on(table.isActive),
  isPopularIdx: index("platform_services_is_popular_idx").on(table.isPopular),
  isFeaturedIdx: index("platform_services_is_featured_idx").on(table.isFeatured),
}));

// ============================================
// MISTRI PROFILES (Updated to use mistri_id)
// ============================================

export const mistriProfiles = pgTable("mistri_profiles", {
  mistriId: uuid("mistri_id").primaryKey().references(() => mistriAccounts.id, { onDelete: "cascade" }),
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
}, (table) => ({
  serviceIdIdx: index("idx_mistri_profiles_service_id").on(table.serviceId),
  isAvailableIdx: index("idx_mistri_profiles_is_available").on(table.isAvailable),
  isFeaturedIdx: index("idx_mistri_profiles_is_featured").on(table.isFeatured),
  approvalStatusIdx: index("idx_mistri_profiles_approval_status").on(table.approvalStatus),
}));

// ============================================
// SERVICE REQUESTS (Updated references)
// ============================================

export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid("customer_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 100 }).notNull(),
  lat: decimal("lat", { precision: 10, scale: 6 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 6 }).notNull(),
  address: text("address").notNull(),
  source: locationSourceEnum("source").notNull(),
  assignedMistriId: uuid("assigned_mistri_id").references(() => mistriAccounts.id, { onDelete: "set null" }),
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
}, (table) => ({
  statusIdx: index("service_requests_status_idx").on(table.status),
  customerIdIdx: index("service_requests_customer_id_idx").on(table.customerId),
  assignedMistriIdIdx: index("service_requests_assigned_mistri_id_idx").on(table.assignedMistriId),
  createdAtIdx: index("service_requests_created_at_idx").on(table.createdAt),
  payoutIdIdx: index("service_requests_payout_id_idx").on(table.payoutId),
  commissionIdIdx: index("service_requests_commission_id_idx").on(table.commissionId),
}));

// ============================================
// SERVICE REQUEST PLATFORM SERVICES (Junction)
// ============================================

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
// MISTRI COMMISSIONS (Updated references)
// ============================================

export const mistriCommissions = pgTable("mistri_commissions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  mistriId: uuid("mistri_id").notNull().references(() => mistriAccounts.id, { onDelete: "cascade" }),
  serviceRequestId: uuid("service_request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  jobAmount: decimal("job_amount", { precision: 10, scale: 2 }).notNull(),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }).notNull(),
  netEarnings: decimal("net_earnings", { precision: 10, scale: 2 }).notNull(),
  status: commissionStatusEnum("status").default("pending").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentMethod: varchar("payment_method", { length: 50 }),
  transactionId: varchar("transaction_id", { length: 100 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueServiceRequest: unique("mistri_commissions_service_request_id_unique").on(table.serviceRequestId),
  mistriIdIdx: index("mistri_commissions_mistri_id_idx").on(table.mistriId),
  statusIdx: index("mistri_commissions_status_idx").on(table.status),
  createdAtIdx: index("mistri_commissions_created_at_idx").on(table.createdAt),
}));

// ============================================
// RATINGS (Updated references)
// ============================================

export const ratings = pgTable("ratings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceRequestId: uuid("service_request_id").notNull().unique().references(() => serviceRequests.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  mistriId: uuid("mistri_id").notNull().references(() => mistriAccounts.id, { onDelete: "cascade" }),
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

// ============================================
// NOTIFICATIONS (Updated with account_type)
// ============================================

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  relatedRequestId: uuid("related_request_id").references(() => serviceRequests.id, { onDelete: "cascade" }),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_notifications_user_id").on(table.userId),
  accountTypeIdx: index("idx_notifications_account_type").on(table.accountType),
  isReadIdx: index("idx_notifications_is_read").on(table.isRead),
  createdAtIdx: index("idx_notifications_created_at").on(table.createdAt),
}));

// ============================================
// NOTIFICATION PREFERENCES (Updated with account_type)
// ============================================

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey(),
  accountType: accountTypeEnum("account_type").notNull(),
  pushEnabled: boolean("push_enabled").default(true).notNull(),
  smsEnabled: boolean("sms_enabled").default(true).notNull(),
  quietHoursStart: varchar("quiet_hours_start", { length: 5 }),
  quietHoursEnd: varchar("quiet_hours_end", { length: 5 }),
  typeSettings: jsonb("type_settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  accountTypeIdx: index("idx_notification_preferences_account_type").on(table.accountType),
}));

// ============================================
// SMS LOGS
// ============================================

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

// ============================================
// PHONE CHANGE ATTEMPTS
// ============================================

export const phoneChangeAttempts = pgTable("phone_change_attempts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  oldPhoneNumber: varchar("old_phone_number", { length: 20 }),
  newPhoneNumber: varchar("new_phone_number", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("phone_change_attempts_user_id_idx").on(table.userId),
  accountTypeIdx: index("phone_change_attempts_account_type_idx").on(table.accountType),
  createdAtIdx: index("phone_change_attempts_created_at_idx").on(table.createdAt),
}));

// ============================================
// AUDIT LOGS
// ============================================

// backend/src/db/schema.ts

// Add a new enum for audit log roles
export const auditRoleEnum = pgEnum("audit_role", ["user", "mistri", "admin"]);

// Update the auditLogs table
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  performedBy: uuid("performed_by").notNull(),
  performedByRole: auditRoleEnum("performed_by_role").notNull(),
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

// ============================================
// HERO BANNERS
// ============================================

export const heroBanners = pgTable("hero_banners", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }),
  subtitle: text("subtitle"),
  imageUrl: text("image_url").notNull(),
  videoUrl: text("video_url"),
  linkUrl: text("link_url"),
  adType: varchar("ad_type", { length: 10 }).default('both'),
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  displayOrderIdx: index("hero_banners_display_order_idx").on(table.displayOrder),
  isActiveIdx: index("hero_banners_is_active_idx").on(table.isActive),
  adTypeIdx: index("hero_banners_ad_type_idx").on(table.adType),
}));

// ============================================
// EXPENSES
// ============================================

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

// ============================================
// APP SETTINGS
// ============================================

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// PAYOUTS (Updated references)
// ============================================

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  mistriId: uuid("mistri_id").notNull().references(() => mistriAccounts.id, { onDelete: "cascade" }),
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

// ============================================
// EMPLOYEE PROFILES
// ============================================

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
// ORDERS SYSTEM (Updated references)
// ============================================

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  assignedMistriId: uuid("assigned_mistri_id").references(() => mistriAccounts.id),
  serviceRequestId: uuid("service_request_id").references(() => serviceRequests.id),
  status: orderStatusEnum("status").default("pending").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").default("pending"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  address: text("address").notNull(),
  city: varchar("city", { length: 100 }),
  zipCode: varchar("zip_code", { length: 20 }),
  latitude: varchar("latitude", { length: 50 }),
  longitude: varchar("longitude", { length: 50 }),
  customerNotes: text("customer_notes"),
  adminNotes: text("admin_notes"),
  paymentMethod: varchar("payment_method", { length: 50 }).default("cash"),
  paymentDetails: jsonb("payment_details"),
  scheduledDate: timestamp("scheduled_date"),
  scheduledTime: varchar("scheduled_time", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
  assignedAt: timestamp("assigned_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
}, (table) => ({
  customerIdIdx: index("idx_orders_customer_id").on(table.customerId),
  assignedMistriIdIdx: index("idx_orders_assigned_mistri_id").on(table.assignedMistriId),
  statusIdx: index("idx_orders_status").on(table.status),
  createdAtIdx: index("idx_orders_created_at").on(table.createdAt),
}));

// ============================================
// ORDER ITEMS
// ============================================

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  serviceItemId: uuid("service_item_id").notNull().references(() => serviceItems.id),
  categoryId: integer("category_id").references(() => services.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  durationMinutes: integer("duration_minutes"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orderIdIdx: index("idx_order_items_order_id").on(table.orderId),
}));

// ============================================
// ORDER TIMELINE
// ============================================

export const orderTimeline = pgTable("order_timeline", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status: orderStatusEnum("status").notNull(),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orderIdIdx: index("idx_order_timeline_order_id").on(table.orderId),
}));

// ============================================
// SUB-ORDERS (Updated references)
// ============================================

export const subOrders = pgTable("sub_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => services.id),
  categoryName: varchar("category_name", { length: 100 }).notNull(),
  assignedMistriId: uuid("assigned_mistri_id").references(() => mistriAccounts.id),
  status: orderStatusEnum("status").default("pending").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  adminNotes: text("admin_notes"),
  assignedAt: timestamp("assigned_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orderIdIdx: index("idx_sub_orders_order_id").on(table.orderId),
  categoryIdIdx: index("idx_sub_orders_category_id").on(table.categoryId),
  assignedMistriIdIdx: index("idx_sub_orders_assigned_mistri_id").on(table.assignedMistriId),
  statusIdx: index("idx_sub_orders_status").on(table.status),
}));

// ============================================
// SUB-ORDER ITEMS
// ============================================

export const subOrderItems = pgTable("sub_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  subOrderId: uuid("sub_order_id").notNull().references(() => subOrders.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
  serviceItemId: uuid("service_item_id").notNull().references(() => serviceItems.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  durationMinutes: integer("duration_minutes"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  subOrderIdIdx: index("idx_sub_order_items_sub_order_id").on(table.subOrderId),
}));

// ============================================
// SUB-ORDER TIMELINE
// ============================================

export const subOrderTimeline = pgTable("sub_order_timeline", {
  id: uuid("id").defaultRandom().primaryKey(),
  subOrderId: uuid("sub_order_id").notNull().references(() => subOrders.id, { onDelete: "cascade" }),
  status: orderStatusEnum("status").notNull(),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  subOrderIdIdx: index("idx_sub_order_timeline_sub_order_id").on(table.subOrderId),
}));

// ============================================
// CART SYSTEM (Updated references)
// ============================================

export const carts = pgTable("carts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_carts_user_id").on(table.userId),
}));

export const cartItems = pgTable("cart_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
  serviceItemId: uuid("service_item_id").notNull().references(() => serviceItems.id, { onDelete: "cascade" }),
  quantity: integer("quantity").default(1).notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCartItem: unique("cart_items_cart_id_service_item_id_unique").on(table.cartId, table.serviceItemId),
  cartIdIdx: index("idx_cart_items_cart_id").on(table.cartId),
  serviceItemIdIdx: index("idx_cart_items_service_item_id").on(table.serviceItemId),
}));

// ============================================
// CONSULTATIONS (Updated references)
// ============================================

export const consultations = pgTable("consultations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => userAccounts.id, { onDelete: "set null" }),
  categoryId: integer("category_id").notNull(),
  categoryName: text("category_name").notNull(),
  location: text("location").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  details: text("details"),
  preferredDate: timestamp("preferred_date"),
  preferredTime: text("preferred_time"),
  urgency: text("urgency").default("normal").notNull(),
  status: text("status").default("pending").notNull(),
  assignedTo: uuid("assigned_to").references(() => mistriAccounts.id, { onDelete: "set null" }),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  userIdIdx: index("idx_consultations_user_id").on(table.userId),
  statusIdx: index("idx_consultations_status").on(table.status),
  categoryIdIdx: index("idx_consultations_category_id").on(table.categoryId),
  assignedToIdx: index("idx_consultations_assigned_to").on(table.assignedTo),
  createdAtIdx: index("idx_consultations_created_at").on(table.createdAt),
  urgencyIdx: index("idx_consultations_urgency").on(table.urgency),
}));

// ============================================
// RELATIONS
// ============================================

// Service Categories Relations
export const serviceCategoriesRelations = relations(serviceCategories, ({ many }) => ({
  subCategories: many(serviceSubCategories),
}));

// Service Sub-Categories Relations
export const serviceSubCategoriesRelations = relations(serviceSubCategories, ({ one, many }) => ({
  category: one(serviceCategories, {
    fields: [serviceSubCategories.categoryId],
    references: [serviceCategories.id],
  }),
  items: many(serviceItems),
}));

// Service Items Relations
export const serviceItemsRelations = relations(serviceItems, ({ one }) => ({
  subCategory: one(serviceSubCategories, {
    fields: [serviceItems.subCategoryId],
    references: [serviceSubCategories.id],
  }),
}));

// Mistri Profiles Relations
export const mistriProfilesRelations = relations(mistriProfiles, ({ one }) => ({
  mistri: one(mistriAccounts, {
    fields: [mistriProfiles.mistriId],
    references: [mistriAccounts.id],
  }),
}));

// Service Requests Relations
export const serviceRequestsRelations = relations(serviceRequests, ({ one, many }) => ({
  customer: one(userAccounts, {
    fields: [serviceRequests.customerId],
    references: [userAccounts.id],
  }),
  assignedMistri: one(mistriAccounts, {
    fields: [serviceRequests.assignedMistriId],
    references: [mistriAccounts.id],
  }),
  platformServices: many(serviceRequestPlatformServices),
}));

// Orders Relations
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(userAccounts, {
    fields: [orders.customerId],
    references: [userAccounts.id],
  }),
  assignedMistri: one(mistriAccounts, {
    fields: [orders.assignedMistriId],
    references: [mistriAccounts.id],
  }),
  serviceRequest: one(serviceRequests, {
    fields: [orders.serviceRequestId],
    references: [serviceRequests.id],
  }),
  items: many(orderItems),
  subOrders: many(subOrders),
  timeline: many(orderTimeline),
}));

// Order Items Relations
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  serviceItem: one(serviceItems, {
    fields: [orderItems.serviceItemId],
    references: [serviceItems.id],
  }),
}));

// Sub-Orders Relations
export const subOrdersRelations = relations(subOrders, ({ one, many }) => ({
  order: one(orders, {
    fields: [subOrders.orderId],
    references: [orders.id],
  }),
  assignedMistri: one(mistriAccounts, {
    fields: [subOrders.assignedMistriId],
    references: [mistriAccounts.id],
  }),
  items: many(subOrderItems),
  timeline: many(subOrderTimeline),
}));

// Cart Relations
export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(userAccounts, {
    fields: [carts.userId],
    references: [userAccounts.id],
  }),
  items: many(cartItems),
}));

// Cart Items Relations
export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, {
    fields: [cartItems.cartId],
    references: [carts.id],
  }),
  serviceItem: one(serviceItems, {
    fields: [cartItems.serviceItemId],
    references: [serviceItems.id],
  }),
}));

// Consultations Relations
export const consultationsRelations = relations(consultations, ({ one }) => ({
  user: one(userAccounts, {
    fields: [consultations.userId],
    references: [userAccounts.id],
  }),
  assignedMistri: one(mistriAccounts, {
    fields: [consultations.assignedTo],
    references: [mistriAccounts.id],
  }),
}));

// ============================================
// TYPES
// ============================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserAccount = typeof userAccounts.$inferSelect;
export type NewUserAccount = typeof userAccounts.$inferInsert;
export type MistriAccount = typeof mistriAccounts.$inferSelect;
export type NewMistriAccount = typeof mistriAccounts.$inferInsert;
export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type ServiceSubCategory = typeof serviceSubCategories.$inferSelect;
export type ServiceItem = typeof serviceItems.$inferSelect;
export type MistriProfile = typeof mistriProfiles.$inferSelect;
export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Consultation = typeof consultations.$inferSelect;
export type NewConsultation = typeof consultations.$inferInsert;
export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;