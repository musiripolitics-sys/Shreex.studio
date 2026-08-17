-- Add the "Manager" leadership role.
-- ALTER TYPE ... ADD VALUE must be committed before the value can be used,
-- so the actual Priyanka seed row lives in the next migration (0006).
alter type leader_role add value if not exists 'Manager' before 'Community Lead';
