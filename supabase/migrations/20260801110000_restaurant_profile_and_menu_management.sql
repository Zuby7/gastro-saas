-- ============================================================================
-- Restaurant profile and menu management foundation (Epic 4, tickets #11-#15)
-- ============================================================================
-- Adds tenant-scoped profile/opening-hours tables, draft/published menu
-- versions, categories/dishes/media assets, variants/options/extras,
-- allergen/additive/dietary-label assignments, and publish validation.
-- ============================================================================

insert into permissions (key, description)
values
  ('tenant.settings.write', 'Update restaurant profile and tenant settings'),
  ('menu.write', 'Create and edit draft menu content')
on conflict (key) do update set description = excluded.description;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key in ('tenant.settings.write', 'menu.write')
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'tenant.settings.write'),
      ('manager', 'menu.write'),
      ('marketing', 'menu.write')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Restaurant profile and opening hours
-- ----------------------------------------------------------------------------
create table restaurant_profiles (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  display_name text not null check (char_length(display_name) > 0),
  description text not null default '',
  contact_email text,
  phone text,
  timezone text not null default 'Europe/Berlin',
  brand_color text not null default '#166534' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger restaurant_profiles_set_updated_at
  before update on restaurant_profiles
  for each row
  execute function set_updated_at();

create table opening_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, weekday),
  check (
    (is_closed and opens_at is null and closes_at is null)
    or (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at)
  )
);

create trigger opening_hours_set_updated_at
  before update on opening_hours
  for each row
  execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Menu versions, categories, dishes, media
-- ----------------------------------------------------------------------------
create table menu_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version_number integer not null default 1,
  published_at timestamptz,
  published_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger menu_versions_set_updated_at
  before update on menu_versions
  for each row
  execute function set_updated_at();

create table categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  menu_version_id uuid not null references menu_versions (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, menu_version_id, sort_order)
);

create trigger categories_set_updated_at
  before update on categories
  for each row
  execute function set_updated_at();

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  alt_text text not null check (char_length(alt_text) > 0),
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (storage_path like tenant_id::text || '/%')
);

create table dishes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  menu_version_id uuid not null references menu_versions (id) on delete cascade,
  category_id uuid not null references categories (id) on delete restrict,
  media_asset_id uuid references media_assets (id) on delete set null,
  name text not null check (char_length(name) > 0),
  description text not null default '',
  price_cents integer check (price_cents is null or price_cents >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  allergen_reviewed boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger dishes_set_updated_at
  before update on dishes
  for each row
  execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Variants, options, ingredients
-- ----------------------------------------------------------------------------
create table dish_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  dish_id uuid not null references dishes (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger dish_variants_set_updated_at
  before update on dish_variants
  for each row
  execute function set_updated_at();

create table option_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_selections <= max_selections)
);

create trigger option_groups_set_updated_at
  before update on option_groups
  for each row
  execute function set_updated_at();

create table options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  option_group_id uuid not null references option_groups (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  price_delta_cents integer not null default 0,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger options_set_updated_at
  before update on options
  for each row
  execute function set_updated_at();

create table dish_option_group_assignments (
  dish_id uuid not null references dishes (id) on delete cascade,
  option_group_id uuid not null references option_groups (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (dish_id, option_group_id)
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) > 0)
);

create table removable_ingredients (
  dish_id uuid not null references dishes (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (dish_id, ingredient_id)
);

-- ----------------------------------------------------------------------------
-- Allergens, additives, dietary labels
-- ----------------------------------------------------------------------------
create table allergens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  unique (tenant_id, name)
);

create table additives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  unique (tenant_id, name)
);

create table dietary_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  unique (tenant_id, name)
);

create table dish_allergen_assignments (
  dish_id uuid not null references dishes (id) on delete cascade,
  allergen_id uuid not null references allergens (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (dish_id, allergen_id)
);

create table dish_additive_assignments (
  dish_id uuid not null references dishes (id) on delete cascade,
  additive_id uuid not null references additives (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (dish_id, additive_id)
);

create table dish_dietary_label_assignments (
  dish_id uuid not null references dishes (id) on delete cascade,
  dietary_label_id uuid not null references dietary_labels (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (dish_id, dietary_label_id)
);

-- ----------------------------------------------------------------------------
-- Integrity helpers
-- ----------------------------------------------------------------------------
create or replace function ensure_menu_child_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if tg_table_name = 'categories' then
    select tenant_id into v_tenant_id from public.menu_versions where id = new.menu_version_id;
  elsif tg_table_name = 'dishes' then
    select c.tenant_id into v_tenant_id
      from public.categories c
     where c.id = new.category_id
       and c.menu_version_id = new.menu_version_id;
  elsif tg_table_name = 'dish_variants' then
    select tenant_id into v_tenant_id from public.dishes where id = new.dish_id;
  elsif tg_table_name = 'options' then
    select tenant_id into v_tenant_id from public.option_groups where id = new.option_group_id;
  end if;

  if v_tenant_id is null or v_tenant_id <> new.tenant_id then
    raise exception '% tenant_id must match its parent tenant', tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger categories_tenant_match before insert or update on categories for each row execute function ensure_menu_child_tenant_match();
create trigger dishes_tenant_match before insert or update on dishes for each row execute function ensure_menu_child_tenant_match();
create trigger dish_variants_tenant_match before insert or update on dish_variants for each row execute function ensure_menu_child_tenant_match();
create trigger options_tenant_match before insert or update on options for each row execute function ensure_menu_child_tenant_match();

-- Generic assignment same-tenant guard for dish/lookup join tables.
create or replace function ensure_assignment_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left_tenant uuid;
  v_right_tenant uuid;
begin
  select tenant_id into v_left_tenant from public.dishes where id = new.dish_id;

  if tg_table_name = 'dish_option_group_assignments' then
    select tenant_id into v_right_tenant from public.option_groups where id = new.option_group_id;
  elsif tg_table_name = 'removable_ingredients' then
    select tenant_id into v_right_tenant from public.ingredients where id = new.ingredient_id;
  elsif tg_table_name = 'dish_allergen_assignments' then
    select tenant_id into v_right_tenant from public.allergens where id = new.allergen_id;
  elsif tg_table_name = 'dish_additive_assignments' then
    select tenant_id into v_right_tenant from public.additives where id = new.additive_id;
  elsif tg_table_name = 'dish_dietary_label_assignments' then
    select tenant_id into v_right_tenant from public.dietary_labels where id = new.dietary_label_id;
  end if;

  if v_left_tenant is null or v_right_tenant is null or v_left_tenant <> new.tenant_id or v_right_tenant <> new.tenant_id then
    raise exception '% tenant_id must match both assigned records', tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger dish_option_group_assignments_tenant_match before insert or update on dish_option_group_assignments for each row execute function ensure_assignment_tenant_match();
create trigger removable_ingredients_tenant_match before insert or update on removable_ingredients for each row execute function ensure_assignment_tenant_match();
create trigger dish_allergen_assignments_tenant_match before insert or update on dish_allergen_assignments for each row execute function ensure_assignment_tenant_match();
create trigger dish_additive_assignments_tenant_match before insert or update on dish_additive_assignments for each row execute function ensure_assignment_tenant_match();
create trigger dish_dietary_label_assignments_tenant_match before insert or update on dish_dietary_label_assignments for each row execute function ensure_assignment_tenant_match();

-- ----------------------------------------------------------------------------
-- Draft/publish write guard (fixes: published/archived menu versions were
-- previously still writable -- app-layer permission checks alone don't stop
-- an admin action from silently editing the live menu; RLS's write policies
-- below only check permission, not menu-version status). categories/dishes
-- carry menu_version_id directly; their children are locked transitively via
-- dish_id -> dishes.menu_version_id. option_groups/options are intentionally
-- NOT version-scoped (shared library across versions, like ingredients) --
-- reviewed and accepted as out of scope for this guard, tracked as a
-- residual risk rather than solved here.
-- ----------------------------------------------------------------------------
create or replace function ensure_menu_version_editable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_menu_version_id uuid;
  v_dish_id uuid;
  v_status text;
begin
  if tg_table_name in ('categories', 'dishes') then
    v_menu_version_id := coalesce(new.menu_version_id, old.menu_version_id);
    select status into v_status from public.menu_versions where id = v_menu_version_id;
  else
    v_dish_id := coalesce(new.dish_id, old.dish_id);
    select mv.status into v_status
      from public.dishes d
      join public.menu_versions mv on mv.id = d.menu_version_id
     where d.id = v_dish_id;
  end if;

  if v_status is not null and v_status <> 'draft' then
    raise exception '% is read-only once its menu version leaves draft status (current status: %)', tg_table_name, v_status
      using errcode = 'read_only_sql_transaction';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger categories_menu_version_editable before insert or update or delete on categories for each row execute function ensure_menu_version_editable();
create trigger dishes_menu_version_editable before insert or update or delete on dishes for each row execute function ensure_menu_version_editable();
create trigger dish_variants_menu_version_editable before insert or update or delete on dish_variants for each row execute function ensure_menu_version_editable();
create trigger dish_option_group_assignments_menu_version_editable before insert or update or delete on dish_option_group_assignments for each row execute function ensure_menu_version_editable();
create trigger removable_ingredients_menu_version_editable before insert or update or delete on removable_ingredients for each row execute function ensure_menu_version_editable();
create trigger dish_allergen_assignments_menu_version_editable before insert or update or delete on dish_allergen_assignments for each row execute function ensure_menu_version_editable();
create trigger dish_additive_assignments_menu_version_editable before insert or update or delete on dish_additive_assignments for each row execute function ensure_menu_version_editable();
create trigger dish_dietary_label_assignments_menu_version_editable before insert or update or delete on dish_dietary_label_assignments for each row execute function ensure_menu_version_editable();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table restaurant_profiles enable row level security;
alter table opening_hours enable row level security;
alter table menu_versions enable row level security;
alter table categories enable row level security;
alter table media_assets enable row level security;
alter table dishes enable row level security;
alter table dish_variants enable row level security;
alter table option_groups enable row level security;
alter table options enable row level security;
alter table dish_option_group_assignments enable row level security;
alter table ingredients enable row level security;
alter table removable_ingredients enable row level security;
alter table allergens enable row level security;
alter table additives enable row level security;
alter table dietary_labels enable row level security;
alter table dish_allergen_assignments enable row level security;
alter table dish_additive_assignments enable row level security;
alter table dish_dietary_label_assignments enable row level security;

grant select, insert, update, delete on restaurant_profiles, opening_hours, menu_versions, categories, media_assets, dishes, dish_variants, option_groups, options, dish_option_group_assignments, ingredients, removable_ingredients, allergens, additives, dietary_labels, dish_allergen_assignments, dish_additive_assignments, dish_dietary_label_assignments to authenticated, service_role;
revoke truncate on restaurant_profiles, opening_hours, menu_versions, categories, media_assets, dishes, dish_variants, option_groups, options, dish_option_group_assignments, ingredients, removable_ingredients, allergens, additives, dietary_labels, dish_allergen_assignments, dish_additive_assignments, dish_dietary_label_assignments from anon, authenticated, service_role;

create or replace function apply_basic_tenant_policies(p_table regclass, p_write_permission text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('create policy %I on %s for select to authenticated using (public.is_tenant_member(tenant_id))', p_table::text || '_select_member', p_table);
  execute format('create policy %I on %s for insert to authenticated with check (public.has_tenant_permission(tenant_id, %L))', p_table::text || '_insert_write', p_table, p_write_permission);
  execute format('create policy %I on %s for update to authenticated using (public.has_tenant_permission(tenant_id, %L)) with check (public.has_tenant_permission(tenant_id, %L))', p_table::text || '_update_write', p_table, p_write_permission, p_write_permission);
  execute format('create policy %I on %s for delete to authenticated using (public.has_tenant_permission(tenant_id, %L))', p_table::text || '_delete_write', p_table, p_write_permission);
end;
$$;

select apply_basic_tenant_policies('restaurant_profiles', 'tenant.settings.write');
select apply_basic_tenant_policies('opening_hours', 'tenant.settings.write');
select apply_basic_tenant_policies('menu_versions', 'menu.write');
select apply_basic_tenant_policies('categories', 'menu.write');
select apply_basic_tenant_policies('media_assets', 'menu.write');
select apply_basic_tenant_policies('dishes', 'menu.write');
select apply_basic_tenant_policies('dish_variants', 'menu.write');
select apply_basic_tenant_policies('option_groups', 'menu.write');
select apply_basic_tenant_policies('options', 'menu.write');
select apply_basic_tenant_policies('dish_option_group_assignments', 'menu.write');
select apply_basic_tenant_policies('ingredients', 'menu.write');
select apply_basic_tenant_policies('removable_ingredients', 'menu.write');
select apply_basic_tenant_policies('allergens', 'menu.write');
select apply_basic_tenant_policies('additives', 'menu.write');
select apply_basic_tenant_policies('dietary_labels', 'menu.write');
select apply_basic_tenant_policies('dish_allergen_assignments', 'menu.write');
select apply_basic_tenant_policies('dish_additive_assignments', 'menu.write');
select apply_basic_tenant_policies('dish_dietary_label_assignments', 'menu.write');

drop function apply_basic_tenant_policies(regclass, text);

-- ----------------------------------------------------------------------------
-- Publish validation
-- ----------------------------------------------------------------------------
create table menu_publish_checks (
  id uuid primary key default gen_random_uuid(),
  menu_version_id uuid not null references menu_versions (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  severity text not null check (severity in ('blocker', 'warning')),
  code text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table menu_publish_checks enable row level security;
grant select, insert, delete on menu_publish_checks to authenticated, service_role;
create policy menu_publish_checks_select_member on menu_publish_checks for select to authenticated using (is_tenant_member(tenant_id));

create or replace function run_menu_publish_checks(p_menu_version_id uuid)
returns table (severity text, code text, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id from public.menu_versions where id = p_menu_version_id;
  if v_tenant_id is null then
    raise exception 'Menu version not found' using errcode = 'invalid_parameter_value';
  end if;

  delete from public.menu_publish_checks where menu_version_id = p_menu_version_id;

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'blocker', 'no-purchasable-dish', 'At least one dish needs a price or purchasable variant.'
  where not exists (
    select 1 from public.dishes d
     where d.menu_version_id = p_menu_version_id
       and d.archived_at is null
       and (d.price_cents is not null or exists (select 1 from public.dish_variants dv where dv.dish_id = d.id and dv.is_available))
  );

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'blocker', 'dish-without-price', d.name || ' has no price or purchasable variant.'
    from public.dishes d
   where d.menu_version_id = p_menu_version_id
     and d.archived_at is null
     and d.price_cents is null
     and not exists (select 1 from public.dish_variants dv where dv.dish_id = d.id and dv.is_available);

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'blocker', 'option-group-empty', og.name || ' has no options.'
    from public.option_groups og
   where og.tenant_id = v_tenant_id
     and exists (
       select 1
         from public.dish_option_group_assignments doga
         join public.dishes d on d.id = doga.dish_id
        where d.menu_version_id = p_menu_version_id
          and doga.option_group_id = og.id
     )
     and not exists (select 1 from public.options o where o.option_group_id = og.id);

  insert into public.menu_publish_checks (menu_version_id, tenant_id, severity, code, message)
  select p_menu_version_id, v_tenant_id, 'warning', 'allergen-review-missing', d.name || ' has no restaurant-provided allergen review.'
    from public.dishes d
   where d.menu_version_id = p_menu_version_id
     and d.archived_at is null
     and d.allergen_reviewed = false;

  return query
  select mpc.severity, mpc.code, mpc.message
    from public.menu_publish_checks mpc
   where mpc.menu_version_id = p_menu_version_id
   order by mpc.severity, mpc.code;
end;
$$;

-- Deep-clones a menu version's full structure (categories, dishes, variants,
-- and all dish assignment tables) into a brand-new 'draft' version. Called
-- by publish_menu_version() so publishing never leaves the tenant without an
-- editable draft -- without this, the admin UI would have nothing to edit
-- after the first publish. New rows get fresh ids (via temp id-mapping
-- tables); option_groups/options/ingredients/allergens/additives/dietary_labels
-- are tenant-scoped, not version-scoped, so they're referenced as-is, not
-- cloned.
create or replace function clone_menu_version_as_draft(p_source_menu_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_source_version_number integer;
  v_new_version_id uuid;
begin
  select tenant_id, version_number into v_tenant_id, v_source_version_number
    from public.menu_versions
   where id = p_source_menu_version_id;

  if v_tenant_id is null then
    raise exception 'Source menu version not found' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.menu_versions (tenant_id, status, version_number)
  values (v_tenant_id, 'draft', v_source_version_number + 1)
  returning id into v_new_version_id;

  create temporary table _clone_category_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temporary table _clone_dish_map (old_id uuid primary key, new_id uuid not null) on commit drop;

  insert into _clone_category_map (old_id, new_id)
  select id, gen_random_uuid() from public.categories where menu_version_id = p_source_menu_version_id;

  insert into public.categories (id, tenant_id, menu_version_id, name, sort_order, archived_at)
  select cm.new_id, c.tenant_id, v_new_version_id, c.name, c.sort_order, c.archived_at
    from public.categories c
    join _clone_category_map cm on cm.old_id = c.id
   where c.menu_version_id = p_source_menu_version_id;

  insert into _clone_dish_map (old_id, new_id)
  select id, gen_random_uuid() from public.dishes where menu_version_id = p_source_menu_version_id;

  insert into public.dishes (id, tenant_id, menu_version_id, category_id, media_asset_id, name, description, price_cents, currency, allergen_reviewed, archived_at)
  select dm.new_id, d.tenant_id, v_new_version_id, cm.new_id, d.media_asset_id, d.name, d.description, d.price_cents, d.currency, d.allergen_reviewed, d.archived_at
    from public.dishes d
    join _clone_dish_map dm on dm.old_id = d.id
    join _clone_category_map cm on cm.old_id = d.category_id
   where d.menu_version_id = p_source_menu_version_id;

  insert into public.dish_variants (tenant_id, dish_id, name, price_cents, currency, is_available, sort_order)
  select dv.tenant_id, dm.new_id, dv.name, dv.price_cents, dv.currency, dv.is_available, dv.sort_order
    from public.dish_variants dv
    join _clone_dish_map dm on dm.old_id = dv.dish_id;

  insert into public.dish_option_group_assignments (dish_id, option_group_id, tenant_id, sort_order)
  select dm.new_id, a.option_group_id, a.tenant_id, a.sort_order
    from public.dish_option_group_assignments a
    join _clone_dish_map dm on dm.old_id = a.dish_id;

  insert into public.removable_ingredients (dish_id, ingredient_id, tenant_id)
  select dm.new_id, r.ingredient_id, r.tenant_id
    from public.removable_ingredients r
    join _clone_dish_map dm on dm.old_id = r.dish_id;

  insert into public.dish_allergen_assignments (dish_id, allergen_id, tenant_id)
  select dm.new_id, a.allergen_id, a.tenant_id
    from public.dish_allergen_assignments a
    join _clone_dish_map dm on dm.old_id = a.dish_id;

  insert into public.dish_additive_assignments (dish_id, additive_id, tenant_id)
  select dm.new_id, a.additive_id, a.tenant_id
    from public.dish_additive_assignments a
    join _clone_dish_map dm on dm.old_id = a.dish_id;

  insert into public.dish_dietary_label_assignments (dish_id, dietary_label_id, tenant_id)
  select dm.new_id, a.dietary_label_id, a.tenant_id
    from public.dish_dietary_label_assignments a
    join _clone_dish_map dm on dm.old_id = a.dish_id;

  return v_new_version_id;
end;
$$;

create or replace function publish_menu_version(p_menu_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_actor_user_id uuid := auth.uid();
begin
  select tenant_id into v_tenant_id from public.menu_versions where id = p_menu_version_id and status = 'draft';
  if v_tenant_id is null then
    raise exception 'Draft menu version not found' using errcode = 'invalid_parameter_value';
  end if;

  perform public.require_tenant_permission(v_tenant_id, 'menu.publish');
  perform public.run_menu_publish_checks(p_menu_version_id);

  if exists (select 1 from public.menu_publish_checks where menu_version_id = p_menu_version_id and severity = 'blocker') then
    raise exception 'Menu has blockers and cannot be published'
      using errcode = 'check_violation';
  end if;

  update public.menu_versions
     set status = 'archived'
   where tenant_id = v_tenant_id
     and status = 'published';

  update public.menu_versions
     set status = 'published',
         published_at = now(),
         published_by_user_id = v_actor_user_id
   where id = p_menu_version_id;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id)
  values (v_tenant_id, v_actor_user_id, 'menu.published', 'menu_version', p_menu_version_id::text);

  -- Publishing must never leave the tenant without an editable draft --
  -- the write-guard trigger above now locks the just-published version, so
  -- without this the admin UI would have nothing left to edit.
  perform public.clone_menu_version_as_draft(p_menu_version_id);
end;
$$;

revoke all on function run_menu_publish_checks(uuid) from public;
revoke all on function publish_menu_version(uuid) from public;
revoke all on function clone_menu_version_as_draft(uuid) from public;
grant execute on function run_menu_publish_checks(uuid) to authenticated, service_role;
grant execute on function publish_menu_version(uuid) to authenticated, service_role;
grant execute on function clone_menu_version_as_draft(uuid) to service_role;
