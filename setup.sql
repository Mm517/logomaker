-- استوديو الصور الشخصية (kind = ستايل الصورة، logo_path = مسار الصورة الناتجة): شغّله مرة واحدة في Supabase > SQL Editor (آمن لو اتشغّل تاني)
-- بادئة lm_ عشان ما يتخبطش مع جداول المشاريع التانية في نفس الـ project
create table if not exists public.lm_submissions (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  brand text,
  kind text not null default 'combo',   -- symbol | wordmark | combo
  ip text,
  logo_path text,
  created_at timestamptz default now()
);

create table if not exists public.lm_photos (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.lm_submissions(id) on delete cascade,
  path text not null,
  kind text not null default 'face',   -- face | reference
  has_face boolean not null,
  note text,
  created_at timestamptz default now()
);

create index if not exists lm_submissions_ip_time on public.lm_submissions (ip, created_at);
create index if not exists lm_photos_submission on public.lm_photos (submission_id);

-- RLS مفعّل من غير أي policy = محدش يقدر يقرأ/يكتب غير الـ Edge Function (service role)
alter table public.lm_submissions enable row level security;
alter table public.lm_photos enable row level security;

-- Bucket خاص (private) عشان صور الوشوش متبقاش علنية
insert into storage.buckets (id, name, public)
values ('lm-uploads', 'lm-uploads', false)
on conflict (id) do nothing;
