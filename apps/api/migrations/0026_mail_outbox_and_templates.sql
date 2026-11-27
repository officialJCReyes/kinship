-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- 0026: what sending email needs (docs/decisions/0041-email-foundation.md).
--
--   * mail_outbox              every message goes here first; a job in the api sends it, with retries, so a slow or down
--                              provider never slows a request and a restart loses nothing. The address, subject and body are
--                              personal data and a body can hold a one-time link (a credential): the subject and body are
--                              cleared as soon as the message is sent, given up or cancelled (a CHECK makes that a rule), and
--                              the job deletes finished rows after 30 days. Backups leave its rows out (the table itself is in the dump).
--                              No secret is ever stored here: provider keys and passwords live only in the environment.
--                              The app role cannot read or write it directly; it queues a message through
--                              kinship_mail_enqueue() and the SuperAdmin's status page reads counts through
--                              kinship_mail_status(). The sending job runs as the owner role.
--   * mail_template_overrides  the subject and text blocks an admin changed, per template. Missing row or missing key: the
--                              built-in default. Not secret: any request may read it (a message can be queued with nobody
--                              signed in, for example a reset request in step 54); only a SuperAdmin may change it.
--
-- Additive: no existing data changes.

CREATE TABLE mail_outbox (
  id              uuid        PRIMARY KEY DEFAULT uuidv7(),
  template        text        NOT NULL CHECK (template ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- One plain address: no spaces, control characters, commas or angle brackets (no header injection, no second recipient).
  to_address      text        NOT NULL CHECK (length(to_address) BETWEEN 3 AND 254 AND to_address !~ '[[:space:][:cntrl:],;<>]'),
  to_user_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  subject         text        CHECK (length(subject) BETWEEN 1 AND 400 AND subject !~ '[[:cntrl:]]'),
  body_text       text        CHECK (length(body_text) <= 100000),
  body_html       text        CHECK (length(body_html) <= 200000),
  status          text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- While a sender holds the row; a sender that died leaves it to run out, and the next claim takes the row back.
  locked_until    timestamptz,
  -- A message carrying a link that stops working is never sent late (cancelled instead).
  expires_at      timestamptz,
  -- The provider's error, cleaned of anything secret and cut short by the api.
  last_error      text        CHECK (length(last_error) <= 500),
  provider_id     text        CHECK (length(provider_id) <= 200),
  created_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  finished_at     timestamptz,
  -- A message waiting to go has its content; a finished one has none (the body may have held a one-time link, the subject a name).
  CONSTRAINT mail_outbox_content CHECK (
    CASE WHEN status IN ('queued', 'sending')
      THEN subject IS NOT NULL AND body_text IS NOT NULL AND finished_at IS NULL
      ELSE subject IS NULL AND body_text IS NULL AND body_html IS NULL AND finished_at IS NOT NULL
    END)
);

CREATE INDEX mail_outbox_due_idx ON mail_outbox (next_attempt_at) WHERE status IN ('queued', 'sending');
CREATE INDEX mail_outbox_finished_idx ON mail_outbox (finished_at) WHERE finished_at IS NOT NULL;

-- Enabled, not forced: the owner role (the sending job, backups) works with every row; the app role has no policy, so
-- even with a grant it would see nothing. It has no grant either.
ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE mail_template_overrides (
  template    text        PRIMARY KEY CHECK (template ~ '^[a-z][a-z0-9_]{0,39}$'),
  subject     text        CHECK (length(subject) BETWEEN 1 AND 150 AND subject !~ '[[:cntrl:]]'),
  -- Block key -> text. The api checks keys, placeholders and lengths; the database caps the size.
  blocks      jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(blocks) = 'object' AND length(blocks::text) <= 30000),
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mail_template_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY mail_template_overrides_read ON mail_template_overrides FOR SELECT USING (true);
CREATE POLICY mail_template_overrides_insert ON mail_template_overrides FOR INSERT
  WITH CHECK ((SELECT public.kinship_role()) = 'superadmin');
CREATE POLICY mail_template_overrides_update ON mail_template_overrides FOR UPDATE
  USING ((SELECT public.kinship_role()) = 'superadmin')
  WITH CHECK ((SELECT public.kinship_role()) = 'superadmin');
CREATE POLICY mail_template_overrides_delete ON mail_template_overrides FOR DELETE
  USING ((SELECT public.kinship_role()) = 'superadmin');

-- Queues one message, in the caller's transaction (so it is sent only if the change that asked for it commits). Returns its id.
-- The table's CHECKs refuse a bad address or a subject with a line break; the api checks the same first, with clearer errors.
CREATE FUNCTION public.kinship_mail_enqueue(
  p_template text, p_to text, p_to_user uuid, p_subject text, p_text text, p_html text, p_expires timestamptz
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO public.mail_outbox (template, to_address, to_user_id, subject, body_text, body_html, expires_at, created_by)
  VALUES (p_template, p_to, p_to_user, p_subject, p_text, p_html, p_expires, public.kinship_user_id())
  RETURNING id
$fn$;

-- What the Storage & email page shows: counts and the latest failure and test, never an address, subject or body (the test
-- row's address is the SuperAdmin's own, and is not returned either). SuperAdmin only.
CREATE FUNCTION public.kinship_mail_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF public.kinship_role() IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'only a SuperAdmin may read the email status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'queued', (SELECT count(*) FROM public.mail_outbox WHERE status IN ('queued', 'sending')),
    'failedLastWeek', (SELECT count(*) FROM public.mail_outbox
                        WHERE status = 'failed' AND finished_at > now() - interval '7 days'),
    'lastFailure', (SELECT jsonb_build_object('at', coalesce(o.finished_at, o.created_at), 'template', o.template,
                                              'error', o.last_error, 'final', o.status = 'failed')
                      FROM public.mail_outbox o
                     WHERE o.last_error IS NOT NULL AND o.status IN ('queued', 'failed')
                     ORDER BY coalesce(o.finished_at, o.created_at) DESC LIMIT 1),
    'lastTest', (SELECT jsonb_build_object('id', o.id, 'status', o.status, 'at', o.created_at, 'sentAt', o.sent_at,
                                           'error', o.last_error)
                   FROM public.mail_outbox o
                  WHERE o.template = 'test'
                  ORDER BY o.created_at DESC LIMIT 1));
END
$fn$;

DO $$
DECLARE
  app_role text := current_setting('kinship.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    RAISE EXCEPTION 'kinship.app_role is not set; run migrations through the KinShip migration runner';
  END IF;
  -- New tables start with every privilege for the app role (0001's default privileges); take them back, then give what is needed.
  EXECUTE format('REVOKE ALL ON mail_outbox, mail_template_overrides FROM %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mail_template_overrides TO %I', app_role);
  REVOKE ALL ON FUNCTION public.kinship_mail_enqueue(text, text, uuid, text, text, text, timestamptz),
                         public.kinship_mail_status() FROM PUBLIC;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.kinship_mail_enqueue(text, text, uuid, text, text, text, timestamptz), public.kinship_mail_status() TO %I',
    app_role);
END
$$;
