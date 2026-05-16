CREATE INDEX IF NOT EXISTS "service_requests_status_idx"
  ON "service_requests" USING btree ("status");
