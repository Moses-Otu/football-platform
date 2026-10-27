-- Register football-data.org as a second provider.
insert into football.providers (id, name) values ('football_data', 'football-data.org')
on conflict (id) do nothing;
