-- ============================================================
-- The contact form offers a topic the database refuses.
--
-- "Careers / Job Application" is the sixth option in the dropdown, and it is
-- also what the form fills in by itself when somebody arrives from a job
-- posting. contact_topic has only the other five, so every one of those
-- submissions came back as invalid input for the enum and the person was told
-- to try again. Trying again did not help.
--
-- Adding the value rather than removing the option, because a careers enquiry
-- is worth telling apart from a general one when somebody reads the inbox.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds
-- it, which is why nothing below reads it.
--
-- Idempotent. Safe to run twice.
-- ============================================================

alter type public.contact_topic add value if not exists 'Careers / Job Application';
