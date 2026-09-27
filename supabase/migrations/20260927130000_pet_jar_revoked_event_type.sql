-- The event an organiser's pet jar revoke writes (20260927130100).
--
-- Separate migration because a new enum value cannot be used in the same
-- transaction that adds it.

alter type event_type add value if not exists 'pet_jar_revoked';
