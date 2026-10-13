-- Paste this into the Supabase SQL editor and run it once.
-- Express uses the service role key and bypasses these policies, so the
-- server must still scope every query to the user id from the access token.
-- The policies protect rows when the publishable anon key is used.

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_type text not null check (asset_type in ('crypto', 'forex', 'metals')),
  symbol text not null check (char_length(btrim(symbol)) between 1 and 32),
  created_at timestamptz not null default now(),
  unique (user_id, asset_type, symbol)
);

create table if not exists public.saved_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_type text not null check (asset_type in ('crypto', 'forex', 'metals')),
  symbol text not null check (char_length(btrim(symbol)) between 1 and 32),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '30m', '1h', '4h', '1d')),
  note text check (note is null or char_length(note) <= 500),
  snapshot jsonb not null,
  disclaimer text not null default 'Research only, not financial advice.',
  created_at timestamptz not null default now()
);

create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_type text not null check (asset_type in ('crypto', 'forex', 'metals')),
  symbol text not null check (char_length(btrim(symbol)) between 1 and 32),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '30m', '1h', '4h', '1d')),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists watchlists_user_id_idx
  on public.watchlists (user_id, created_at desc);

create index if not exists saved_analyses_user_id_idx
  on public.saved_analyses (user_id, created_at desc);

create index if not exists agent_conversations_user_id_idx
  on public.agent_conversations (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agent_conversations_updated_at on public.agent_conversations;
create trigger agent_conversations_updated_at
  before update on public.agent_conversations
  for each row execute function public.set_updated_at();

alter table public.watchlists enable row level security;
alter table public.saved_analyses enable row level security;
alter table public.agent_conversations enable row level security;

revoke all on table public.watchlists from anon;
revoke all on table public.saved_analyses from anon;
revoke all on table public.agent_conversations from anon;

grant select, insert, update, delete on table public.watchlists to authenticated, service_role;
grant select, insert, update, delete on table public.saved_analyses to authenticated, service_role;
grant select, insert, update, delete on table public.agent_conversations to authenticated, service_role;

drop policy if exists watchlists_select_own on public.watchlists;
drop policy if exists watchlists_insert_own on public.watchlists;
drop policy if exists watchlists_update_own on public.watchlists;
drop policy if exists watchlists_delete_own on public.watchlists;

create policy watchlists_select_own on public.watchlists
  for select to authenticated
  using (auth.uid() = user_id);

create policy watchlists_insert_own on public.watchlists
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy watchlists_update_own on public.watchlists
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy watchlists_delete_own on public.watchlists
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists saved_analyses_select_own on public.saved_analyses;
drop policy if exists saved_analyses_insert_own on public.saved_analyses;
drop policy if exists saved_analyses_update_own on public.saved_analyses;
drop policy if exists saved_analyses_delete_own on public.saved_analyses;

create policy saved_analyses_select_own on public.saved_analyses
  for select to authenticated
  using (auth.uid() = user_id);

create policy saved_analyses_insert_own on public.saved_analyses
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy saved_analyses_update_own on public.saved_analyses
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy saved_analyses_delete_own on public.saved_analyses
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists agent_conversations_select_own on public.agent_conversations;
drop policy if exists agent_conversations_insert_own on public.agent_conversations;
drop policy if exists agent_conversations_update_own on public.agent_conversations;
drop policy if exists agent_conversations_delete_own on public.agent_conversations;

create policy agent_conversations_select_own on public.agent_conversations
  for select to authenticated
  using (auth.uid() = user_id);

create policy agent_conversations_insert_own on public.agent_conversations
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy agent_conversations_update_own on public.agent_conversations
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy agent_conversations_delete_own on public.agent_conversations
  for delete to authenticated
  using (auth.uid() = user_id);

-- Paper signal log. Run this section as well if the tables above already exist.
-- Prices are copied from the analysis service. The client does not supply them.

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_type text not null check (asset_type in ('crypto', 'forex', 'metals')),
  symbol text not null check (char_length(btrim(symbol)) between 1 and 32),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '30m', '1h', '4h', '1d')),
  direction text not null check (direction in ('buy', 'sell')),
  entry_low double precision not null,
  entry_high double precision not null,
  stop_loss double precision not null,
  take_profit_1 double precision not null,
  take_profit_2 double precision not null,
  risk_reward double precision not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'hit_tp', 'hit_sl')),
  snapshot jsonb not null default '{}'::jsonb,
  disclaimer text not null default 'Educational and research tool only. Not financial advice. Trading involves risk of loss.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paper_trades_user_id_idx
  on public.paper_trades (user_id, created_at desc);

drop trigger if exists paper_trades_updated_at on public.paper_trades;
create trigger paper_trades_updated_at
  before update on public.paper_trades
  for each row execute function public.set_updated_at();

alter table public.paper_trades enable row level security;

revoke all on table public.paper_trades from anon;

grant select, insert, update, delete on table public.paper_trades to authenticated, service_role;

drop policy if exists paper_trades_select_own on public.paper_trades;
drop policy if exists paper_trades_insert_own on public.paper_trades;
drop policy if exists paper_trades_update_own on public.paper_trades;
drop policy if exists paper_trades_delete_own on public.paper_trades;

create policy paper_trades_select_own on public.paper_trades
  for select to authenticated
  using (auth.uid() = user_id);

create policy paper_trades_insert_own on public.paper_trades
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy paper_trades_update_own on public.paper_trades
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy paper_trades_delete_own on public.paper_trades
  for delete to authenticated
  using (auth.uid() = user_id);
