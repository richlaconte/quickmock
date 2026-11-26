-- lowfi.design, hosted. Safe to run again: every statement only adds what is missing.

create table if not exists workspaces (
  id          text primary key,
  -- sha256 of the owner's secret, which lives in the owner link and then in a cookie.
  owner_hash  text not null,
  -- sha256 of the key an agent sends to /mcp.
  key_hash    text not null,
  -- The key in the guest link, or null while sharing is off.
  share_key   text,
  created_at  timestamptz not null default now()
);

create table if not exists flows (
  ws          text not null references workspaces (id) on delete cascade,
  id          text not null,
  -- json, not jsonb: the order of the keys is how the spec was written, and diffs compare it as text.
  spec        json not null,
  issues      json not null,
  rev         integer not null default 1,
  updated_at  timestamptz not null default now(),
  last_change json,
  -- The number the last note got, so note ids are never reused.
  note_seq    integer not null default 0,
  primary key (ws, id)
);

create table if not exists notes (
  ws       text not null,
  flow_id  text not null,
  id       text not null,
  seq      integer not null,
  body     json not null,
  primary key (ws, flow_id, id),
  foreign key (ws, flow_id) references flows (ws, id) on delete cascade
);
