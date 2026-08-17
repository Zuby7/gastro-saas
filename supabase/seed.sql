-- ============================================================================
-- Local dev demo seed data (ticket "chore/demo-seed-data")
-- ============================================================================
-- Runs automatically after migrations on `supabase db reset` (see
-- [db.seed] in supabase/config.toml). Builds one persistent, realistic demo
-- tenant -- "Trattoria Da Mario" (slug `trattoria-da-mario`) -- so a human can
-- log in and see/exercise every implemented feature (Epics 1-7) without
-- manually clicking through setup first: a full published multi-category
-- menu with variants/options/allergens/a sold-out dish, real dish photos,
-- one login per system role, a Stripe Connect test-mode payment account,
-- orders across every real order status with matching payments/refunds, and
-- a pending staff invitation.
--
-- Local-only, never production data: local Supabase supports inserting
-- directly into `auth.users` with a properly bcrypt-hashed password via
-- pgcrypto's `crypt(password, gen_salt('bf'))` -- a documented pattern for
-- local-dev seeds (verified empirically against this repo's local stack: a
-- real POST to GoTrue's /token?grant_type=password endpoint with the exact
-- credentials below returns a real access token, and the app's own login
-- form was exercised against it too). All 5 demo logins share the password
-- `DemoPasswort1234!` -- purely a local fixture, never a real credential.
--
-- Idempotency: `supabase db reset` fully drops and recreates the local
-- database (migrations + this seed run against an empty schema each time),
-- so there is normally nothing to conflict with. This file is *also* safe to
-- re-run directly (`psql -f supabase/seed.sql`) against an already-seeded
-- database without erroring or duplicating: everything below lives inside a
-- single top-level `do $seed$ ... $seed$` block that checks for the demo
-- tenant's slug first and returns immediately if it already exists. A
-- per-row `on conflict do nothing` approach was deliberately rejected here:
-- once this tenant's menu_versions row is flipped to `status = 'published'`,
-- `ensure_menu_version_editable()`'s BEFORE INSERT trigger
-- (20260801110000_restaurant_profile_and_menu_management.sql) rejects any
-- further INSERT into its categories/dishes regardless of ON CONFLICT --
-- the trigger fires on the attempted row before conflict resolution is
-- even considered. The coarse "already seeded? skip entirely" guard sidesteps
-- that entirely and is simpler to reason about than re-deriving per-table
-- upsert logic for a draft/publish-guarded menu tree.
--
-- Media: real dish photos, not placeholders. `media_assets` (see
-- 20260801110000_restaurant_profile_and_menu_management.sql) requires an
-- actual object in the private `dish-media` Supabase Storage bucket, not
-- just a URL column -- the check constraint
-- `storage_path like tenant_id::text || '/%'` and the RLS-protected
-- `storage.objects` policies (20260802090000_menu_admin_ui_support.sql) both
-- assume a real uploaded object. Plain SQL cannot upload storage object
-- bytes (Supabase Storage's actual file content lives outside Postgres, in
-- the storage-api backend), so this seed only creates the `media_assets`
-- *rows* (deterministic storage_path values, real file_size_bytes/content
-- type from the actual source images) -- the real image bytes are uploaded
-- separately by `supabase/seed-assets/upload-dish-media.mjs`, which must be
-- run once after this seed applies (see that script's own header and
-- docs/decisions/assumptions.md). Source images:
-- supabase/seed-assets/dishes/*.jpg, all freely-licensed (CC0/CC BY/CC
-- BY-SA) photos from Wikimedia Commons -- see
-- supabase/seed-assets/dishes/ATTRIBUTION.md for per-file attribution.
-- Without running that companion script, the `media_assets` rows exist and
-- the admin/public menu UI will render correctly-shaped `<img>` requests,
-- but the underlying Storage object won't exist until the script runs.
--
-- Orders/payments/refunds are inserted directly (not via
-- create_order_from_cart()/the Stripe webhook), since this script has no
-- guest cart or a real Stripe event to replay. This is safe here because:
--   - This script runs as a direct superuser connection (`current_setting
--     ('role', true) = 'none'`), the same "non-app-facing" carve-out
--     guard_orders_status_change()/guard_orders_payment_fields_change()/
--     guard_refunds_immutable_fields_change() already grant privileged
--     migration/ops connections (see those functions' own comments) -- so
--     the app-facing guard triggers never fire for this script.
--   - order_status_events are still inserted as a real, validated sequence
--     (validate_order_status_event() has no such role carve-out and runs
--     unconditionally), so every seeded order's status history is a
--     genuinely valid transition chain per is_valid_order_status_transition(),
--     not a shortcut.
--   - payments/refunds rows still pass through
--     ensure_payment_matches_order()/ensure_refund_matches_payment_and_within_limit()
--     unconditionally (no role carve-out there either), so seeded amounts
--     are still validated against their order/payment exactly as production
--     code would be.
-- ============================================================================

do $seed$
declare
  -- Fixed ids (not gen_random_uuid()) so this file's own idempotency guard
  -- and supabase/seed-assets/upload-dish-media.mjs (which must compute the
  -- exact same storage_path values) can agree on identifiers without a
  -- round-trip.
  v_tenant_id uuid := '11111111-1111-4111-8111-111111111111';

  v_owner_id uuid := '11111111-1111-4111-8111-111111111101';
  v_manager_id uuid := '11111111-1111-4111-8111-111111111102';
  v_kitchen_id uuid := '11111111-1111-4111-8111-111111111103';
  v_service_id uuid := '11111111-1111-4111-8111-111111111104';
  v_marketing_id uuid := '11111111-1111-4111-8111-111111111105';

  v_owner_membership_id uuid;
  v_manager_membership_id uuid;
  v_kitchen_membership_id uuid;
  v_service_membership_id uuid;
  v_marketing_membership_id uuid;

  v_owner_role_id uuid;
  v_manager_role_id uuid;
  v_kitchen_role_id uuid;
  v_service_role_id uuid;
  v_marketing_role_id uuid;

  v_menu_version_id uuid := '11111111-1111-4111-8111-111111111201';

  v_cat_starters uuid := '11111111-1111-4111-8111-111111111301';
  v_cat_mains uuid := '11111111-1111-4111-8111-111111111302';
  v_cat_desserts uuid := '11111111-1111-4111-8111-111111111303';
  v_cat_drinks uuid := '11111111-1111-4111-8111-111111111304';

  v_d_bruschetta uuid := '11111111-1111-4111-8111-111111111401';
  v_d_caprese uuid := '11111111-1111-4111-8111-111111111402';
  v_d_minestrone uuid := '11111111-1111-4111-8111-111111111403';
  v_d_margherita uuid := '11111111-1111-4111-8111-111111111404';
  v_d_salami uuid := '11111111-1111-4111-8111-111111111405';
  v_d_carbonara uuid := '11111111-1111-4111-8111-111111111406';
  v_d_lasagne uuid := '11111111-1111-4111-8111-111111111407';
  v_d_risotto uuid := '11111111-1111-4111-8111-111111111408';
  v_d_tiramisu uuid := '11111111-1111-4111-8111-111111111409';
  v_d_pannacotta uuid := '11111111-1111-4111-8111-11111111140a';
  v_d_water uuid := '11111111-1111-4111-8111-11111111140b';
  v_d_lemonade uuid := '11111111-1111-4111-8111-11111111140c';

  v_variant_margherita_klein uuid := '11111111-1111-4111-8111-111111111501';
  v_variant_margherita_gross uuid := '11111111-1111-4111-8111-111111111502';

  v_og_toppings uuid := '11111111-1111-4111-8111-111111111601';
  v_opt_cheese uuid := '11111111-1111-4111-8111-111111111611';
  v_opt_salami uuid := '11111111-1111-4111-8111-111111111612';
  v_opt_peperoni uuid := '11111111-1111-4111-8111-111111111613';

  v_al_gluten uuid := '11111111-1111-4111-8111-111111111801';
  v_al_milch uuid := '11111111-1111-4111-8111-111111111802';
  v_al_ei uuid := '11111111-1111-4111-8111-111111111803';

  v_dl_vegetarisch uuid := '11111111-1111-4111-8111-111111111901';
  v_dl_glutenfrei uuid := '11111111-1111-4111-8111-111111111902';

  v_ma_bruschetta uuid := '11111111-1111-4111-8111-111111111701';
  v_ma_caprese uuid := '11111111-1111-4111-8111-111111111702';
  v_ma_minestrone uuid := '11111111-1111-4111-8111-111111111703';
  v_ma_margherita uuid := '11111111-1111-4111-8111-111111111704';
  v_ma_salami uuid := '11111111-1111-4111-8111-111111111705';
  v_ma_carbonara uuid := '11111111-1111-4111-8111-111111111706';
  v_ma_lasagne uuid := '11111111-1111-4111-8111-111111111707';
  v_ma_risotto uuid := '11111111-1111-4111-8111-111111111708';
  v_ma_tiramisu uuid := '11111111-1111-4111-8111-111111111709';
  v_ma_pannacotta uuid := '11111111-1111-4111-8111-11111111170a';
  v_ma_water uuid := '11111111-1111-4111-8111-11111111170b';
  v_ma_lemonade uuid := '11111111-1111-4111-8111-11111111170c';

  v_order_a uuid := '11111111-1111-4111-8111-111111111a01';
  v_order_b uuid := '11111111-1111-4111-8111-111111111a02';
  v_order_c uuid := '11111111-1111-4111-8111-111111111a03';
  v_order_d uuid := '11111111-1111-4111-8111-111111111a04';
  v_order_e uuid := '11111111-1111-4111-8111-111111111a05';

  v_order_item_id uuid;

  v_payment_b uuid := '11111111-1111-4111-8111-111111111b02';
  v_payment_c uuid := '11111111-1111-4111-8111-111111111b03';
  v_payment_d uuid := '11111111-1111-4111-8111-111111111b04';

  v_refund_d uuid := '11111111-1111-4111-8111-111111111c04';

  v_invitation_id uuid := '11111111-1111-4111-8111-111111111d01';

  v_password text := 'DemoPasswort1234!';
  v_now timestamptz := now();
begin
  -- ---------------------------------------------------------------------
  -- Epic 8 Opus batch review, finding 8: this script creates real
  -- auth.users rows with a shared, publicly-documented password
  -- (v_password above) and, before this fix, had no guard beyond the
  -- "already seeded?" check below -- which does NOT protect against running
  -- it against a hosted/staging project that happens not to have this slug
  -- yet. `[db.seed] enabled = true` in supabase/config.toml already means
  -- `supabase db reset` runs this automatically; this guard adds a second,
  -- independent check so a plain `psql -f supabase/seed.sql "$DATABASE_URL"`
  -- against anything other than an explicitly-opted-in connection refuses
  -- to run at all. Follows this repo's existing custom-GUC opt-in
  -- convention (`gastro_saas.allow_order_status_change`,
  -- `gastro_saas.allow_menu_version_status_change` -- see
  -- 20260801110000_restaurant_profile_and_menu_management.sql/
  -- 20260804090000_orders_state_machine_and_checkout.sql), except this one
  -- is a per-*session* opt-in the operator sets on their own connection
  -- (e.g. `PGOPTIONS="-c gastro_saas.allow_demo_seed=on"` in the shell that
  -- invokes `supabase db reset`/`supabase start`, or a `SET` issued before
  -- `\i seed.sql` in an interactive local psql session) -- documented in
  -- docs/decisions/assumptions.md. Deliberately NOT set inside this file
  -- itself (that would make the guard a no-op) and deliberately NOT set via
  -- a migration/`ALTER DATABASE ... SET` (that would persist the opt-in
  -- for every future connection to whatever database the migration was
  -- ever applied against, including a hosted one).
  -- ---------------------------------------------------------------------
  if coalesce(current_setting('gastro_saas.allow_demo_seed', true), '') <> 'on' then
    raise exception
      'supabase/seed.sql refuses to run: the gastro_saas.allow_demo_seed session '
      'setting is not "on". This script creates real auth.users rows with a shared, '
      'publicly-documented password and must never run against anything but a local, '
      'throwaway database. Set PGOPTIONS="-c gastro_saas.allow_demo_seed=on" (see '
      'docs/decisions/assumptions.md) before running supabase db reset/start locally.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------------------
  -- Idempotency guard: if the demo tenant already exists, this whole seed
  -- has already run -- do nothing further (see header note on why a coarse
  -- guard was chosen over per-row ON CONFLICT here).
  -- ---------------------------------------------------------------------
  if exists (select 1 from tenants where slug = 'trattoria-da-mario') then
    raise notice 'Demo tenant "trattoria-da-mario" already seeded -- skipping supabase/seed.sql.';
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- auth.users + auth.identities: one real, real-password login per system
  -- role. instance_id matches the local GoTrue default
  -- (00000000-0000-0000-0000-000000000000). encrypted_password uses
  -- pgcrypto's crypt()/gen_salt('bf') -- bcrypt, the same scheme GoTrue
  -- itself verifies against on /token?grant_type=password.
  -- ---------------------------------------------------------------------
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    is_sso_user, is_anonymous, created_at, updated_at
  )
  values
    ('00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
     'owner@trattoria-demo.test', crypt(v_password, gen_salt('bf')), v_now,
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, v_now, v_now),
    ('00000000-0000-0000-0000-000000000000', v_manager_id, 'authenticated', 'authenticated',
     'manager@trattoria-demo.test', crypt(v_password, gen_salt('bf')), v_now,
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, v_now, v_now),
    ('00000000-0000-0000-0000-000000000000', v_kitchen_id, 'authenticated', 'authenticated',
     'kitchen@trattoria-demo.test', crypt(v_password, gen_salt('bf')), v_now,
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, v_now, v_now),
    ('00000000-0000-0000-0000-000000000000', v_service_id, 'authenticated', 'authenticated',
     'service@trattoria-demo.test', crypt(v_password, gen_salt('bf')), v_now,
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, v_now, v_now),
    ('00000000-0000-0000-0000-000000000000', v_marketing_id, 'authenticated', 'authenticated',
     'marketing@trattoria-demo.test', crypt(v_password, gen_salt('bf')), v_now,
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, v_now, v_now)
  on conflict (id) do nothing;

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  values
    (gen_random_uuid(), v_owner_id::text, v_owner_id,
     jsonb_build_object('sub', v_owner_id::text, 'email', 'owner@trattoria-demo.test', 'email_verified', true), 'email', v_now, v_now, v_now),
    (gen_random_uuid(), v_manager_id::text, v_manager_id,
     jsonb_build_object('sub', v_manager_id::text, 'email', 'manager@trattoria-demo.test', 'email_verified', true), 'email', v_now, v_now, v_now),
    (gen_random_uuid(), v_kitchen_id::text, v_kitchen_id,
     jsonb_build_object('sub', v_kitchen_id::text, 'email', 'kitchen@trattoria-demo.test', 'email_verified', true), 'email', v_now, v_now, v_now),
    (gen_random_uuid(), v_service_id::text, v_service_id,
     jsonb_build_object('sub', v_service_id::text, 'email', 'service@trattoria-demo.test', 'email_verified', true), 'email', v_now, v_now, v_now),
    (gen_random_uuid(), v_marketing_id::text, v_marketing_id,
     jsonb_build_object('sub', v_marketing_id::text, 'email', 'marketing@trattoria-demo.test', 'email_verified', true), 'email', v_now, v_now, v_now)
  on conflict (provider_id, provider) do nothing;

  -- ---------------------------------------------------------------------
  -- Tenant + first Owner membership, in the same statement/transaction as
  -- required by tenants_created_with_owner (20260801040000_*.sql). This
  -- whole `do` block is one implicit transaction, so the deferred
  -- constraint trigger sees both by the time it fires at block end.
  -- Inserting `tenants` also fires `tenants_seed_standard_roles`
  -- (20260801080000_roles_and_permissions_rbac.sql) synchronously, creating
  -- this tenant's Owner/Manager/Kitchen/Service/Marketing system roles.
  -- ---------------------------------------------------------------------
  insert into tenants (id, name, slug)
  values (v_tenant_id, 'Trattoria Da Mario', 'trattoria-da-mario');

  insert into tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_owner_id, 'owner')
  returning id into v_owner_membership_id;

  -- ---------------------------------------------------------------------
  -- One membership per system role (owner already above), so every one of
  -- the 5 standard roles/permission sets is directly exercised by a real
  -- login. tenant_memberships.role only models owner/manager/staff
  -- (ticket #4) -- sync_membership_standard_role() auto-assigns 'service'
  -- to every 'staff' row, so Kitchen/Marketing's actual role_id is fixed up
  -- below after insert.
  -- ---------------------------------------------------------------------
  insert into tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_manager_id, 'manager')
  returning id into v_manager_membership_id;

  insert into tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_kitchen_id, 'staff')
  returning id into v_kitchen_membership_id;

  insert into tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_service_id, 'staff')
  returning id into v_service_membership_id;

  insert into tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_marketing_id, 'staff')
  returning id into v_marketing_membership_id;

  select id into v_owner_role_id from roles where tenant_id = v_tenant_id and key = 'owner';
  select id into v_manager_role_id from roles where tenant_id = v_tenant_id and key = 'manager';
  select id into v_kitchen_role_id from roles where tenant_id = v_tenant_id and key = 'kitchen';
  select id into v_service_role_id from roles where tenant_id = v_tenant_id and key = 'service';
  select id into v_marketing_role_id from roles where tenant_id = v_tenant_id and key = 'marketing';

  -- Fix up Kitchen: sync_membership_standard_role() assigned 'service' by
  -- default for every 'staff' membership -- replace with 'kitchen'.
  delete from membership_roles where membership_id = v_kitchen_membership_id and role_id = v_service_role_id;
  insert into membership_roles (membership_id, role_id) values (v_kitchen_membership_id, v_kitchen_role_id)
  on conflict do nothing;

  -- Fix up Marketing the same way.
  delete from membership_roles where membership_id = v_marketing_membership_id and role_id = v_service_role_id;
  insert into membership_roles (membership_id, role_id) values (v_marketing_membership_id, v_marketing_role_id)
  on conflict do nothing;

  -- ---------------------------------------------------------------------
  -- Restaurant profile + opening hours (Epic 4, ticket #11)
  -- ---------------------------------------------------------------------
  insert into restaurant_profiles (
    tenant_id, display_name, description, contact_email, phone, timezone, brand_color, updated_by_user_id
  )
  values (
    v_tenant_id, 'Trattoria Da Mario',
    'Familiäre italienische Küche im Herzen der Stadt -- frische Pasta, holzofengebackene Pizza und hausgemachte Desserts.',
    'info@trattoria-demo.test', '+49 30 12345678', 'Europe/Berlin', '#b91c1c', v_owner_id
  );

  insert into opening_hours (tenant_id, weekday, opens_at, closes_at, is_closed)
  values
    (v_tenant_id, 0, null, null, true), -- Monday closed
    (v_tenant_id, 1, '11:30', '22:00', false),
    (v_tenant_id, 2, '11:30', '22:00', false),
    (v_tenant_id, 3, '11:30', '22:00', false),
    (v_tenant_id, 4, '11:30', '23:00', false),
    (v_tenant_id, 5, '11:30', '23:00', false),
    (v_tenant_id, 6, '12:00', '22:00', false);

  -- ---------------------------------------------------------------------
  -- Menu: created as 'draft' first (categories/dishes/variants/options are
  -- only writable while their menu_version is 'draft' --
  -- ensure_menu_version_editable(), 20260801110000_*.sql), then flipped to
  -- 'published' at the very end once all children exist.
  -- ---------------------------------------------------------------------
  insert into menu_versions (id, tenant_id, status, version_number)
  values (v_menu_version_id, v_tenant_id, 'draft', 1);

  insert into categories (id, tenant_id, menu_version_id, name, sort_order)
  values
    (v_cat_starters, v_tenant_id, v_menu_version_id, 'Vorspeisen', 1),
    (v_cat_mains, v_tenant_id, v_menu_version_id, 'Hauptgerichte', 2),
    (v_cat_desserts, v_tenant_id, v_menu_version_id, 'Desserts', 3),
    (v_cat_drinks, v_tenant_id, v_menu_version_id, 'Getränke', 4);

  -- Allergens / dietary labels (tenant-scoped lookup tables)
  insert into allergens (id, tenant_id, name)
  values
    (v_al_gluten, v_tenant_id, 'Gluten'),
    (v_al_milch, v_tenant_id, 'Milch'),
    (v_al_ei, v_tenant_id, 'Ei');

  insert into dietary_labels (id, tenant_id, name)
  values
    (v_dl_vegetarisch, v_tenant_id, 'Vegetarisch'),
    (v_dl_glutenfrei, v_tenant_id, 'Glutenfrei');

  -- media_assets rows -- see this file's header for why the real Storage
  -- object bytes are uploaded by a separate companion script, not here.
  insert into media_assets (id, tenant_id, storage_path, content_type, size_bytes, alt_text, created_by_user_id)
  values
    (v_ma_bruschetta, v_tenant_id, v_tenant_id::text || '/dishes/bruschetta.jpg', 'image/jpeg', 191439, 'Bruschetta mit Tomaten auf geröstetem Brot', v_owner_id),
    (v_ma_caprese, v_tenant_id, v_tenant_id::text || '/dishes/caprese.jpg', 'image/jpeg', 230024, 'Insalata Caprese mit Mozzarella, Tomate und Basilikum', v_owner_id),
    (v_ma_minestrone, v_tenant_id, v_tenant_id::text || '/dishes/minestrone.jpg', 'image/jpeg', 107944, 'Minestrone-Suppe mit Gemüse', v_owner_id),
    (v_ma_margherita, v_tenant_id, v_tenant_id::text || '/dishes/pizza-margherita.jpg', 'image/jpeg', 231734, 'Pizza Margherita mit Tomate, Mozzarella und Basilikum', v_owner_id),
    (v_ma_salami, v_tenant_id, v_tenant_id::text || '/dishes/pizza-salami.jpg', 'image/jpeg', 145715, 'Pizza Salami mit würziger Salami', v_owner_id),
    (v_ma_carbonara, v_tenant_id, v_tenant_id::text || '/dishes/carbonara.jpg', 'image/jpeg', 235348, 'Spaghetti Carbonara mit Ei, Speck und Pecorino', v_owner_id),
    (v_ma_lasagne, v_tenant_id, v_tenant_id::text || '/dishes/lasagne.jpg', 'image/jpeg', 176299, 'Lasagne al Forno', v_owner_id),
    (v_ma_risotto, v_tenant_id, v_tenant_id::text || '/dishes/risotto.jpg', 'image/jpeg', 166112, 'Risotto ai Funghi mit Steinpilzen', v_owner_id),
    (v_ma_tiramisu, v_tenant_id, v_tenant_id::text || '/dishes/tiramisu.jpg', 'image/jpeg', 109748, 'Klassisches Tiramisu', v_owner_id),
    (v_ma_pannacotta, v_tenant_id, v_tenant_id::text || '/dishes/pannacotta.jpg', 'image/jpeg', 114241, 'Panna Cotta mit Karamellsauce', v_owner_id),
    (v_ma_water, v_tenant_id, v_tenant_id::text || '/dishes/acqua-minerale.jpg', 'image/jpeg', 109154, 'Glas Mineralwasser mit Minze', v_owner_id),
    (v_ma_lemonade, v_tenant_id, v_tenant_id::text || '/dishes/limonade.jpg', 'image/jpeg', 134449, 'Hausgemachte Limonade im Glas', v_owner_id);

  -- ---------------------------------------------------------------------
  -- Dishes
  -- ---------------------------------------------------------------------
  insert into dishes (id, tenant_id, menu_version_id, category_id, media_asset_id, name, description, price_cents, allergen_reviewed)
  values
    (v_d_bruschetta, v_tenant_id, v_menu_version_id, v_cat_starters, v_ma_bruschetta, 'Bruschetta al Pomodoro', 'Geröstetes Landbrot mit marinierten Tomaten, Knoblauch und Basilikum.', 650, true),
    (v_d_caprese, v_tenant_id, v_menu_version_id, v_cat_starters, v_ma_caprese, 'Insalata Caprese', 'Büffelmozzarella, Tomaten, Basilikum, Olivenöl.', 750, true),
    (v_d_minestrone, v_tenant_id, v_menu_version_id, v_cat_starters, v_ma_minestrone, 'Minestrone della Casa', 'Hausgemachte Gemüsesuppe nach Familienrezept.', 600, true),
    -- Pizza Margherita: variant-priced (no base price_cents), demonstrates
    -- the klein/groß variant shape.
    (v_d_margherita, v_tenant_id, v_menu_version_id, v_cat_mains, v_ma_margherita, 'Pizza Margherita', 'Tomate, Mozzarella, frisches Basilikum, Olivenöl.', null, true),
    (v_d_salami, v_tenant_id, v_menu_version_id, v_cat_mains, v_ma_salami, 'Pizza Salami', 'Tomate, Mozzarella, würzige Salami.', 1050, true),
    (v_d_carbonara, v_tenant_id, v_menu_version_id, v_cat_mains, v_ma_carbonara, 'Spaghetti Carbonara', 'Ei, Guanciale, Pecorino Romano, schwarzer Pfeffer.', 1150, true),
    (v_d_lasagne, v_tenant_id, v_menu_version_id, v_cat_mains, v_ma_lasagne, 'Lasagne al Forno', 'Hausgemachte Lasagne mit Ragù, Béchamel und Parmesan.', 1250, true),
    -- Deliberately allergen_reviewed = false: demonstrates the
    -- "Allergenangaben wurden vom Restaurant noch nicht bestätigt" UI copy.
    (v_d_risotto, v_tenant_id, v_menu_version_id, v_cat_mains, v_ma_risotto, 'Risotto ai Funghi', 'Cremiges Risotto mit Steinpilzen und Parmesan.', 1150, false),
    (v_d_tiramisu, v_tenant_id, v_menu_version_id, v_cat_desserts, v_ma_tiramisu, 'Tiramisù', 'Mascarpone, Kaffee, Kakao, Löffelbiskuit.', 550, true),
    (v_d_pannacotta, v_tenant_id, v_menu_version_id, v_cat_desserts, v_ma_pannacotta, 'Panna Cotta', 'Sahnedessert mit Karamellsauce.', 500, true),
    (v_d_water, v_tenant_id, v_menu_version_id, v_cat_drinks, v_ma_water, 'Acqua Minerale', 'Stilles oder spritziges Mineralwasser, 0,5 l.', 350, true),
    -- Sold out: no base price AND no available variant -- get_public_menu()'s
    -- soldOut derivation (ticket #84) flags this as unavailable, directly
    -- exercising the sold-out UI without any Epic 8 (unmerged) columns.
    (v_d_lemonade, v_tenant_id, v_menu_version_id, v_cat_drinks, v_ma_lemonade, 'Hausgemachte Limonade', 'Zitronenlimonade mit frischer Minze -- heute leider ausverkauft.', null, true);

  insert into dish_variants (id, tenant_id, dish_id, name, price_cents, is_available, sort_order)
  values
    (v_variant_margherita_klein, v_tenant_id, v_d_margherita, 'Klein (26 cm)', 900, true, 1),
    (v_variant_margherita_gross, v_tenant_id, v_d_margherita, 'Groß (32 cm)', 1200, true, 2);

  insert into option_groups (id, tenant_id, name, min_selections, max_selections)
  values (v_og_toppings, v_tenant_id, 'Extra-Toppings', 0, 3);

  insert into options (id, tenant_id, option_group_id, name, price_delta_cents, sort_order)
  values
    (v_opt_cheese, v_tenant_id, v_og_toppings, 'Extra Käse', 150, 1),
    (v_opt_salami, v_tenant_id, v_og_toppings, 'Extra Salami', 200, 2),
    (v_opt_peperoni, v_tenant_id, v_og_toppings, 'Peperoni', 100, 3);

  insert into dish_option_group_assignments (dish_id, option_group_id, tenant_id, sort_order)
  values (v_d_salami, v_og_toppings, v_tenant_id, 1);

  insert into dish_allergen_assignments (dish_id, allergen_id, tenant_id)
  values
    (v_d_bruschetta, v_al_gluten, v_tenant_id),
    (v_d_caprese, v_al_milch, v_tenant_id),
    (v_d_margherita, v_al_gluten, v_tenant_id),
    (v_d_margherita, v_al_milch, v_tenant_id),
    (v_d_salami, v_al_gluten, v_tenant_id),
    (v_d_salami, v_al_milch, v_tenant_id),
    (v_d_carbonara, v_al_gluten, v_tenant_id),
    (v_d_carbonara, v_al_ei, v_tenant_id),
    (v_d_carbonara, v_al_milch, v_tenant_id),
    (v_d_lasagne, v_al_gluten, v_tenant_id),
    (v_d_lasagne, v_al_milch, v_tenant_id),
    (v_d_lasagne, v_al_ei, v_tenant_id),
    (v_d_tiramisu, v_al_ei, v_tenant_id),
    (v_d_tiramisu, v_al_milch, v_tenant_id),
    (v_d_tiramisu, v_al_gluten, v_tenant_id),
    (v_d_pannacotta, v_al_milch, v_tenant_id);

  insert into dish_dietary_label_assignments (dish_id, dietary_label_id, tenant_id)
  values
    (v_d_margherita, v_dl_vegetarisch, v_tenant_id),
    (v_d_minestrone, v_dl_vegetarisch, v_tenant_id),
    (v_d_risotto, v_dl_vegetarisch, v_tenant_id),
    (v_d_pannacotta, v_dl_glutenfrei, v_tenant_id);

  -- ---------------------------------------------------------------------
  -- Publish the menu. Setting menu_versions.status directly (not via
  -- publish_menu_version(), which requires a real auth.uid() session this
  -- script has none of) is safe here: guard_menu_versions_status_change()
  -- only restricts app-facing roles (authenticated/anon/service_role), and
  -- this direct connection's current_setting('role') is 'none' (see this
  -- file's header note).
  -- ---------------------------------------------------------------------
  update menu_versions
     set status = 'published', published_at = v_now, published_by_user_id = v_owner_id
   where id = v_menu_version_id;

  -- ---------------------------------------------------------------------
  -- Stripe Connect payment account: enabled, obviously-fake test id.
  -- ---------------------------------------------------------------------
  insert into payment_accounts (
    tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled,
    onboarding_completed_at, created_by_user_id
  )
  values (
    v_tenant_id, 'acct_demo_seed_test', 'enabled', true, true, v_now, v_owner_id
  );

  -- ---------------------------------------------------------------------
  -- Orders across every real status
  -- (is_valid_order_status_transition(), 20260804090000_*.sql):
  --   A: awaiting_payment (guest mid-checkout, no payment yet)
  --   B: preparing (paid)
  --   C: ready (paid)
  --   D: completed (paid, with a partial refund)
  --   E: cancelled (never paid)
  -- ---------------------------------------------------------------------
  insert into orders (
    id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name,
    customer_phone, table_identifier, customer_note, total_cents, status
  )
  values
    (v_order_a, v_tenant_id, encode(digest('demo-seed-order-a', 'sha256'), 'hex'), 'pickup', 'Anna Schuster', '+49 170 1111111', null, '', 1550, 'awaiting_payment'),
    (v_order_b, v_tenant_id, encode(digest('demo-seed-order-b', 'sha256'), 'hex'), 'table', 'Markus Vogel', '+49 170 2222222', '5', '', 2850, 'awaiting_payment'),
    (v_order_c, v_tenant_id, encode(digest('demo-seed-order-c', 'sha256'), 'hex'), 'pickup', 'Julia Berger', '+49 170 3333333', null, 'Bitte ohne Zwiebeln.', 1800, 'awaiting_payment'),
    (v_order_d, v_tenant_id, encode(digest('demo-seed-order-d', 'sha256'), 'hex'), 'table', 'Stefan Kraus', '+49 170 4444444', '12', '', 2750, 'awaiting_payment'),
    (v_order_e, v_tenant_id, encode(digest('demo-seed-order-e', 'sha256'), 'hex'), 'pickup', 'Nina Wolf', '+49 170 5555555', null, '', 1250, 'awaiting_payment');

  -- Initial creation events (from_status null -> awaiting_payment), matching
  -- create_order_from_cart()'s own shape.
  insert into order_status_events (tenant_id, order_id, from_status, to_status)
  values
    (v_tenant_id, v_order_a, null, 'awaiting_payment'),
    (v_tenant_id, v_order_b, null, 'awaiting_payment'),
    (v_tenant_id, v_order_c, null, 'awaiting_payment'),
    (v_tenant_id, v_order_d, null, 'awaiting_payment'),
    (v_tenant_id, v_order_e, null, 'awaiting_payment');

  -- Order A stays at awaiting_payment (guest has not completed Stripe
  -- Checkout yet) -- no further events.

  -- Order B -> received -> accepted -> preparing. Inserted as separate
  -- statements (not one multi-row VALUES list): sync_order_status_from_event()
  -- (an AFTER ROW trigger) must update orders.status from the *previous* row
  -- before validate_order_status_event() (a BEFORE ROW trigger) checks the
  -- *next* row's from_status against it -- reliable across separate
  -- statements, not guaranteed within a single multi-row INSERT.
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_b, 'awaiting_payment', 'received', v_service_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_b, 'received', 'accepted', v_kitchen_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_b, 'accepted', 'preparing', v_kitchen_id);

  -- Order C -> received -> accepted -> preparing -> ready (see the note on
  -- Order B above for why each transition is its own statement).
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_c, 'awaiting_payment', 'received', v_service_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_c, 'received', 'accepted', v_kitchen_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_c, 'accepted', 'preparing', v_kitchen_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_c, 'preparing', 'ready', v_kitchen_id);

  -- Order D -> received -> accepted -> preparing -> ready -> completed
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_d, 'awaiting_payment', 'received', v_service_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_d, 'received', 'accepted', v_kitchen_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_d, 'accepted', 'preparing', v_kitchen_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_d, 'preparing', 'ready', v_kitchen_id);
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (v_tenant_id, v_order_d, 'ready', 'completed', v_service_id);

  -- Order E -> cancelled (never paid; e.g. guest abandoned checkout)
  insert into order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id, note)
  values (v_tenant_id, v_order_e, 'awaiting_payment', 'cancelled', v_manager_id, 'Vom Gast storniert.');

  -- ---------------------------------------------------------------------
  -- Order items (immutable purchase-time snapshots)
  -- ---------------------------------------------------------------------
  -- Order A: Pizza Margherita (groß) + Acqua Minerale = 1200 + 350 = 1550
  insert into order_items (tenant_id, order_id, dish_id, dish_variant_id, quantity, dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot)
  values
    (v_tenant_id, v_order_a, v_d_margherita, v_variant_margherita_gross, 1, 'Pizza Margherita', 'Groß (32 cm)', 1200),
    (v_tenant_id, v_order_a, v_d_water, null, 1, 'Acqua Minerale', null, 350);

  -- Order B: 2x Spaghetti Carbonara + 1x Tiramisù = 2*1150 + 550 = 2850
  insert into order_items (tenant_id, order_id, dish_id, dish_variant_id, quantity, dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot)
  values
    (v_tenant_id, v_order_b, v_d_carbonara, null, 2, 'Spaghetti Carbonara', null, 1150),
    (v_tenant_id, v_order_b, v_d_tiramisu, null, 1, 'Tiramisù', null, 550);

  -- Order C: 1x Pizza Salami (+Extra Käse +Peperoni) + 1x Panna Cotta
  --   (1050 + 150 + 100) + 500 = 1800
  insert into order_items (tenant_id, order_id, dish_id, dish_variant_id, quantity, dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot)
  values (v_tenant_id, v_order_c, v_d_salami, null, 1, 'Pizza Salami', null, 1050)
  returning id into v_order_item_id;

  insert into order_item_selections (tenant_id, order_item_id, option_id, option_name_snapshot, price_delta_cents_snapshot)
  values
    (v_tenant_id, v_order_item_id, v_opt_cheese, 'Extra Käse', 150),
    (v_tenant_id, v_order_item_id, v_opt_peperoni, 'Peperoni', 100);

  insert into order_items (tenant_id, order_id, dish_id, dish_variant_id, quantity, dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot)
  values (v_tenant_id, v_order_c, v_d_pannacotta, null, 1, 'Panna Cotta', null, 500);

  -- Order D: 1x Lasagne + 1x Risotto + 1x Acqua Minerale = 1250+1150+350 = 2750
  insert into order_items (tenant_id, order_id, dish_id, dish_variant_id, quantity, dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot)
  values
    (v_tenant_id, v_order_d, v_d_lasagne, null, 1, 'Lasagne al Forno', null, 1250),
    (v_tenant_id, v_order_d, v_d_risotto, null, 1, 'Risotto ai Funghi', null, 1150),
    (v_tenant_id, v_order_d, v_d_water, null, 1, 'Acqua Minerale', null, 350);

  -- Order E: 1x Minestrone + 1x Bruschetta = 600 + 650 = 1250
  insert into order_items (tenant_id, order_id, dish_id, dish_variant_id, quantity, dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot)
  values
    (v_tenant_id, v_order_e, v_d_minestrone, null, 1, 'Minestrone della Casa', null, 600),
    (v_tenant_id, v_order_e, v_d_bruschetta, null, 1, 'Bruschetta al Pomodoro', null, 650);

  -- ---------------------------------------------------------------------
  -- Payments (orders B/C/D are paid; A is awaiting Stripe Checkout
  -- completion, E was cancelled before paying -- neither gets a payments
  -- row, matching how the real checkout flow only ever creates one after a
  -- successful webhook).
  -- ---------------------------------------------------------------------
  insert into payments (id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status)
  values
    (v_payment_b, v_tenant_id, v_order_b, 'cs_test_demo_seed_orderb', 'pi_test_demo_seed_orderb', 'acct_demo_seed_test', 2850, 'EUR', 'paid'),
    (v_payment_c, v_tenant_id, v_order_c, 'cs_test_demo_seed_orderc', 'pi_test_demo_seed_orderc', 'acct_demo_seed_test', 1800, 'EUR', 'paid'),
    (v_payment_d, v_tenant_id, v_order_d, 'cs_test_demo_seed_orderd', 'pi_test_demo_seed_orderd', 'acct_demo_seed_test', 2750, 'EUR', 'paid');

  -- ---------------------------------------------------------------------
  -- Refund: a partial goodwill refund on the completed order D.
  -- ---------------------------------------------------------------------
  insert into refunds (id, tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, stripe_refund_id, status)
  values (v_refund_d, v_tenant_id, v_payment_d, v_order_d, 500, 'EUR', 'Kulanz: Risotto war kalt.', v_manager_id, 're_test_demo_seed_orderd', 'succeeded');

  -- ---------------------------------------------------------------------
  -- One pending staff invitation (Epic 3, ticket #8), so the invitations
  -- admin UI has something to show without inviting a real person first.
  -- ---------------------------------------------------------------------
  insert into invitations (id, tenant_id, email, role_id, token_hash, expires_at, created_by_user_id)
  values (
    v_invitation_id, v_tenant_id, 'neue.aushilfe@trattoria-demo.test', v_marketing_role_id,
    encode(digest('demo-seed-invitation-token', 'sha256'), 'hex'), v_now + interval '7 days', v_owner_id
  );

  raise notice 'Seeded demo tenant "Trattoria Da Mario" (slug trattoria-da-mario, id %). Run supabase/seed-assets/upload-dish-media.mjs to upload the real dish photos into Storage.', v_tenant_id;
end;
$seed$ language plpgsql;
