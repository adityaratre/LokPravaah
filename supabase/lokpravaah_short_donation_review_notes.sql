-- Align the donation review audit constraint with the admin UI and RPC:
-- short but meaningful notes such as "DONE" must not make a valid manual UTR review fail.
begin;

alter table public.donation_manual_reviews
  drop constraint if exists donation_manual_reviews_review_note_check;

alter table public.donation_manual_reviews
  add constraint donation_manual_reviews_review_note_check
  check (char_length(btrim(review_note)) between 3 and 500);

commit;