-- migrations/036_audit_retention_policy.sql
CREATE OR REPLACE FUNCTION clean_old_audit_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '365 days';
  DELETE FROM error_logs WHERE resolved = true AND resolved_at < NOW() - INTERVAL '90 days';
  DELETE FROM user_sessions WHERE created_at < NOW() - INTERVAL '180 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
