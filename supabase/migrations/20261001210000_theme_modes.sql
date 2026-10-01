-- Stone redesign: store the Auto / Day / Evening appearance modes directly.
-- Additive: the legacy values stay valid so the previously deployed app keeps working.
alter table public.user_preferences drop constraint user_preferences_theme_check;
alter table public.user_preferences
  add constraint user_preferences_theme_check
  check (theme in ('system', 'dark', 'light', 'auto', 'day', 'evening'));
