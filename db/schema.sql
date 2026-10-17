-- FairFare database (Tiger Data = PostgreSQL). Owner: Data role.
-- Safe to run more than once.

create table if not exists price_items (
  id          text not null,
  city        text not null,
  category    text not null check (category in ('transport','food','sim','shopping')),
  name        text not null,
  min_price   numeric(10,2) not null,
  max_price   numeric(10,2) not null,
  currency    text not null,
  tip         text not null default '',
  source      text,            -- where the number came from (link, shop, survey)
  checked_on  date,            -- when it was last verified
  origin      text not null default 'seed',  -- 'seed' = checked by us, 'web' = researched by the AI from search results
  primary key (city, id)
);

-- for databases created before origin existed (the API also runs this on start)
alter table price_items add column if not exists origin text not null default 'seed';

create table if not exists trips (
  id             text primary key,
  city           text not null,
  currency       text not null,
  home_currency  text not null,
  rate_to_local  numeric(14,6) not null,
  budget_home    numeric(12,2) not null,   -- one person's share (group budget / people)
  group_budget_home numeric(12,2),         -- the whole group's budget, optional
  start_date     date not null,
  end_date       date not null,
  invite_code    text unique not null,
  created_at     timestamptz not null default now()
);

-- for databases created before group_budget_home existed
alter table trips add column if not exists group_budget_home numeric(12,2);

create table if not exists people (
  id       text primary key,
  trip_id  text not null references trips(id) on delete cascade,
  name     text not null,
  email    text,
  is_me    boolean not null default false,
  status   text not null default 'joined' check (status in ('joined','invited'))
);

-- shares = {"personId": amountInLocalCurrency, ...} and must add up to amount (checked by the API)
create table if not exists expenses (
  id          text primary key,
  trip_id     text not null references trips(id) on delete cascade,
  item        text not null,
  category    text not null,
  amount      numeric(12,2) not null,
  paid_by     text not null references people(id),
  shares      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_trip_idx on expenses(trip_id, created_at);
