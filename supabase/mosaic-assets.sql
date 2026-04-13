create table if not exists public.mosaic_assets (
  photo_id text primary key,
  source_image_url text,
  thumb_url text not null,
  avg_r integer not null,
  avg_g integer not null,
  avg_b integer not null,
  luma numeric(10,4) not null,
  aspect_ratio numeric(10,4) not null default 1,
  created_at timestamptz not null,
  processed_at timestamptz not null default now(),
  status text not null default 'ready',
  error_message text
);

alter table public.mosaic_assets enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mosaic_assets'
      and policyname = 'Public can read ready mosaic assets'
  ) then
    create policy "Public can read ready mosaic assets"
      on public.mosaic_assets
      for select
      using (status = 'ready');
  end if;
end;
$$;

insert into storage.buckets (id, name, public)
values ('mosaic-thumbs', 'mosaic-thumbs', true)
on conflict (id) do update
set public = excluded.public;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public can read mosaic thumbs'
  ) then
    create policy "Public can read mosaic thumbs"
      on storage.objects
      for select
      using (bucket_id = 'mosaic-thumbs');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Service role manages mosaic thumbs'
  ) then
    create policy "Service role manages mosaic thumbs"
      on storage.objects
      for all
      using (bucket_id = 'mosaic-thumbs' and auth.role() = 'service_role')
      with check (bucket_id = 'mosaic-thumbs' and auth.role() = 'service_role');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mosaic_assets'
  ) then
    alter publication supabase_realtime add table public.mosaic_assets;
  end if;
end;
$$;
