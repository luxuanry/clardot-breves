-- Run once in the Supabase SQL editor.

create table if not exists publications (
  id              text primary key,          -- AMF uin_idt_uin
  published_at    timestamptz not null,
  company         text not null,
  isin            text,
  lei             text,
  country         text,
  is_cac40        boolean not null default false,
  language        text not null,
  category        text not null,
  subtype         text not null,
  title           text not null,
  document_url    text not null,
  is_correction   boolean not null default false,
  corrects_ref    text,
  translation_of  text,
  score           integer not null default 0,
  selected        boolean not null default false,
  score_reasons   jsonb not null default '[]',
  ingested_at     timestamptz not null default now()
);

create index if not exists publications_published_at_idx on publications (published_at desc);
create index if not exists publications_company_idx on publications (company);
create index if not exists publications_subtype_idx on publications (subtype);
create index if not exists publications_selected_idx on publications (selected, score desc);

create table if not exists briefs (
  id              uuid primary key default gen_random_uuid(),
  publication_id  text not null references publications(id) on delete cascade,
  title           text not null,
  body            text not null,
  key_facts       jsonb not null default '[]',
  figures         jsonb not null default '[]',
  verification    text not null,             -- ok | review | unverifiable
  model           text not null,
  word_count      integer not null,
  created_at      timestamptz not null default now(),
  unique (publication_id)
);

-- The app only talks to Supabase from the server with the service role key.
-- RLS stays enabled with no public policy, so the anon key cannot read or write.
alter table publications enable row level security;
alter table briefs enable row level security;
