-- Nullable for pre-existing quotes. New review requests always populate all three.
ALTER TABLE quotes ADD COLUMN request_id uuid;
ALTER TABLE quotes ADD COLUMN request_actor text;
ALTER TABLE quotes ADD COLUMN request_hash text;
ALTER TABLE quotes ADD CONSTRAINT quotes_request_complete CHECK (
  (request_id IS NULL AND request_actor IS NULL AND request_hash IS NULL) OR
  (request_id IS NOT NULL AND request_actor IS NOT NULL AND request_actor IN ('agent','customer','staff') AND request_hash IS NOT NULL)
);
CREATE UNIQUE INDEX quotes_request_identity ON quotes(session_id,request_actor,request_id);
