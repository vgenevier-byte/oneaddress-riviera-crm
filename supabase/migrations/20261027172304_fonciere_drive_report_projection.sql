-- Fix only the administrative report projection. The SQL alias "f" collided
-- with the worker's PL/pgSQL folder row variable. Preserve its logic and grants.
begin;
do $migration$
declare
 definition text;
 previous_fragment constant text := $before$p.title,f.drive_folder_id,f.status,f.error from public.fonciere_projects p left join app_private.fonciere_drive_folders f on f.project_id=p.id and f.category='project'$before$;
 corrected_fragment constant text := $after$p.title,folder_row.drive_folder_id,folder_row.status,folder_row.error from public.fonciere_projects p left join app_private.fonciere_drive_folders folder_row on folder_row.project_id=p.id and folder_row.category='project'$after$;
begin
 select pg_get_functiondef('app_private.fonciere_drive_worker(text,jsonb)'::regprocedure) into definition;
 if strpos(definition,previous_fragment)>0 then
  if length(definition)-length(replace(definition,previous_fragment,''))<>length(previous_fragment) then
   raise exception 'unexpected_fonciere_drive_report_definition';
  end if;
  execute replace(definition,previous_fragment,corrected_fragment);
 elsif strpos(definition,corrected_fragment)=0 then
  raise exception 'unexpected_fonciere_drive_report_definition';
 end if;
end
$migration$;
notify pgrst,'reload schema';
commit;
