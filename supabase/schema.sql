-- ============================================================
-- A/B Learning Platform — Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================================


create extension if not exists "pgcrypto";


-- ============================================================
-- RESEARCHERS
-- ============================================================
create table if not exists researchers (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null unique,
 full_name text,
 created_at timestamptz default now()
);


-- ============================================================
-- STUDIES
-- A study has no direct researcher_id — ownership is tracked
-- via the study_researchers junction table so multiple
-- researchers can collaborate on the same study.
-- ============================================================
create table if not exists studies (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 description text,
 consent_text text not null default '',
 status text not null default 'draft' check (status in ('draft','active','closed')),
 target_per_condition int default 50,
 created_at timestamptz default now(),
 updated_at timestamptz default now()
);


-- ============================================================
-- STUDY_RESEARCHERS  (many-to-many)
-- ============================================================
create table if not exists study_researchers (
 study_id uuid not null references studies(id) on delete cascade,
 researcher_id uuid not null references researchers(id) on delete cascade,
 role text not null default 'owner' check (role in ('owner','collaborator')),
 created_at timestamptz default now(),
 primary key (study_id, researcher_id)
);


-- ============================================================
-- CONDITIONS
-- ============================================================
create table if not exists conditions (
 id uuid primary key default gen_random_uuid(),
 study_id uuid not null references studies(id) on delete cascade,
 label text not null,
 course_url text not null,
 internal_notes text,
 display_order int default 0,
 created_at timestamptz default now()
);


-- ============================================================
-- SURVEY QUESTIONS
-- ============================================================
create table if not exists survey_questions (
 id uuid primary key default gen_random_uuid(),
 condition_id uuid not null references conditions(id) on delete cascade,
 survey_type text not null check (survey_type in ('pre','post')),
 question_text text not null,
 question_type text not null check (question_type in ('multiple_choice','checkbox','likert','short_text')),
 options_json jsonb,
 is_required boolean default true,
 order_index int default 0,
 created_at timestamptz default now()
);


-- ============================================================
-- PARTICIPANTS
-- ============================================================
create table if not exists participants (
 id uuid primary key default gen_random_uuid(),
 study_id uuid not null references studies(id) on delete cascade,
 condition_id uuid references conditions(id),
 student_id uuid not null default gen_random_uuid(),
 email text not null,
 consent_given_at timestamptz,
 completed_pre_survey boolean default false,
 completed_course boolean default false,
 completed_post_survey boolean default false,
 created_at timestamptz default now(),
 unique(study_id, email)
);


-- ============================================================
-- DEMOGRAPHIC RESPONSES
-- ============================================================
create table if not exists demographic_responses (
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null references participants(id) on delete cascade unique,
 age_range text,
 gender text,
 education_level text,
 field_of_study text,
 prior_experience int check (prior_experience between 1 and 5),
 created_at timestamptz default now()
);


-- ============================================================
-- SURVEY RESPONSES
-- ============================================================
create table if not exists survey_responses (
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null references participants(id) on delete cascade,
 question_id uuid not null references survey_questions(id) on delete cascade,
 response_value text,
 created_at timestamptz default now(),
 unique(participant_id, question_id)
);


-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
 new.updated_at = now();
 return new;
end;
$$;


drop trigger if exists studies_updated_at on studies;
create trigger studies_updated_at
 before update on studies
 for each row execute function update_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================


alter table researchers enable row level security;
alter table studies enable row level security;
alter table study_researchers enable row level security;
alter table conditions enable row level security;
alter table survey_questions enable row level security;
alter table participants enable row level security;
alter table demographic_responses enable row level security;
alter table survey_responses enable row level security;


-- Researchers: manage own profile
drop policy if exists researchers_self on researchers;
create policy "researchers_self" on researchers
 for all using (auth.uid() = id);


-- Study researchers: each researcher can see/manage their own memberships
drop policy if exists study_researchers_member on study_researchers;
create policy "study_researchers_member" on study_researchers
 for all using (researcher_id = auth.uid());


-- Studies: any researcher on the study can read/write it
drop policy if exists studies_member on studies;
create policy "studies_member" on studies
 for all using (
   exists (
     select 1 from study_researchers sr
     where sr.study_id = studies.id and sr.researcher_id = auth.uid()
   )
 );


-- Studies: public can read active studies (student portal)
drop policy if exists studies_public_read on studies;
create policy "studies_public_read" on studies
 for select using (status = 'active');


-- Conditions: any researcher on the study can manage conditions
drop policy if exists conditions_owner on conditions;
create policy "conditions_owner" on conditions
 for all using (
   exists (
     select 1 from study_researchers sr
     where sr.study_id = conditions.study_id and sr.researcher_id = auth.uid()
   )
 );


-- Conditions: public can read (needed for enrollment)
drop policy if exists conditions_public_read on conditions;
create policy "conditions_public_read" on conditions
 for select using (true);


-- Survey questions: any researcher on the study can manage questions
drop policy if exists survey_questions_owner on survey_questions;
create policy "survey_questions_owner" on survey_questions
 for all using (
   exists (
     select 1 from conditions c
     join study_researchers sr on sr.study_id = c.study_id
     where c.id = survey_questions.condition_id and sr.researcher_id = auth.uid()
   )
 );


-- Survey questions: public can read
drop policy if exists survey_questions_public_read on survey_questions;
create policy "survey_questions_public_read" on survey_questions
 for select using (true);


-- Participants: any researcher on the study can read participants
drop policy if exists participants_researcher_read on participants;
create policy "participants_researcher_read" on participants
 for select using (
   exists (
     select 1 from study_researchers sr
     where sr.study_id = participants.study_id and sr.researcher_id = auth.uid()
   )
 );


-- Participants: enrollment flow can insert/update
drop policy if exists participants_insert on participants;
create policy "participants_insert" on participants
 for insert with check (true);


drop policy if exists participants_update_own on participants;
create policy "participants_update_own" on participants
 for update using (true);


-- Demographics
drop policy if exists demographics_insert on demographic_responses;
create policy "demographics_insert" on demographic_responses
 for insert with check (true);


drop policy if exists demographics_researcher_read on demographic_responses;
create policy "demographics_researcher_read" on demographic_responses
 for select using (
   exists (
     select 1 from participants p
     join study_researchers sr on sr.study_id = p.study_id
     where p.id = demographic_responses.participant_id and sr.researcher_id = auth.uid()
   )
 );


-- Survey responses
drop policy if exists survey_responses_insert on survey_responses;
create policy "survey_responses_insert" on survey_responses
 for insert with check (true);


drop policy if exists survey_responses_researcher_read on survey_responses;
create policy "survey_responses_researcher_read" on survey_responses
 for select using (
   exists (
     select 1 from participants p
     join study_researchers sr on sr.study_id = p.study_id
     where p.id = survey_responses.participant_id and sr.researcher_id = auth.uid()
   )
 );


-- ============================================================
-- FUNCTION: balanced random condition assignment
-- Returns the condition_id with the fewest participants.
-- ============================================================
create or replace function assign_condition(p_study_id uuid)
returns uuid language plpgsql security definer as $$
declare
 v_condition_id uuid;
begin
 select c.id into v_condition_id
 from conditions c
 left join participants p
   on p.condition_id = c.id and p.study_id = p_study_id
 where c.study_id = p_study_id
 group by c.id
 order by count(p.id) asc, random()
 limit 1
 for update skip locked;


 return v_condition_id;
end;
$$;


-- ============================================================
-- MIGRATION NOTE (if you have existing data):
-- Run these before applying the new schema:
--
--   insert into study_researchers (study_id, researcher_id, role)
--   select id, researcher_id, 'owner'
--   from studies
--   where researcher_id is not null;
--
--   alter table studies drop column researcher_id;
-- ============================================================
