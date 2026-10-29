CREATE INDEX "car_ratings_created_idx" ON "car_ratings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "spot_ratings_created_idx" ON "spot_ratings" USING btree ("created_at");