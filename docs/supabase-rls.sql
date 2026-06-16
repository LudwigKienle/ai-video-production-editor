-- Enable RLS and policies for AI Video Production Editor Portal

alter table teams enable row level security;
alter table team_members enable row level security;
alter table projects enable row level security;
alter table usage_events enable row level security;

-- Teams: members can read their team
create policy "teams_select" on teams
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = teams.id and tm.user_id = auth.uid()
    )
  );

-- Teams: only owner/admin can update
create policy "teams_update" on teams
  for update
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = teams.id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

-- Team members: members can read their team roster
create policy "team_members_select" on team_members
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_members.team_id and tm.user_id = auth.uid()
    )
  );

-- Team members: only owner/admin can manage
create policy "team_members_manage" on team_members
  for all
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_members.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  )
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_members.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

-- Projects: members can read/create for their team
create policy "projects_select" on projects
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = projects.team_id and tm.user_id = auth.uid()
    )
  );

create policy "projects_insert" on projects
  for insert
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = projects.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin','editor')
    )
  );

create policy "projects_update" on projects
  for update
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = projects.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin','editor')
    )
  );

-- Usage events: members can read; only system inserts (via service role)
create policy "usage_select" on usage_events
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = usage_events.team_id and tm.user_id = auth.uid()
    )
  );
