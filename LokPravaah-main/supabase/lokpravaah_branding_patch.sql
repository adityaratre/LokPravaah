-- Optional, safe brand-label update for an existing project that already has the janwatch_ai feature flag.
-- Run only if the Admin Operations → Features label still shows the old product name.
update public.app_feature_flags
set label = 'LokPravaah AI assistant',
    description = 'Allow signed-in citizens to use the multi-provider AI assistant. Provider keys remain server-side.'
where flag_key = 'janwatch_ai';
