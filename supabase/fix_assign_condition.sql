-- Fix assign_condition: FOR UPDATE cannot be used with GROUP BY in PostgreSQL.
-- The original function errored on every call, returning null and causing
-- "No conditions configured" even when conditions existed.


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
 limit 1;


 return v_condition_id;
end;
$$;
