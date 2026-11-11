# استوديو الصور الشخصية (Gemini + Supabase)

## الحالة
مربوط بمشروع Supabase `krustyburger` (cijujqhxdjpvuyzbxedf):
- جداول `lm_submissions` و`lm_photos` + bucket خاص `lm-uploads` (متعملين).
- الدالة `logo-maker` منشورة (`verify_jwt=false`).
- `index.html` فيه الـ URL والمفتاح العام جاهزين.

## اللي لازم تتأكد منه
الدالة محتاجة سيكرت `GEMINI_API_KEY` في نفس المشروع. لو مش موجود:
```bash
supabase secrets set GEMINI_API_KEY=مفتاحك --project-ref cijujqhxdjpvuyzbxedf
```
اختياري: `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `MAX_PER_HOUR` (افتراضي 5 تصميمات/ساعة لكل IP).

## الملفات
- `index.html` — الواجهة (من غير build). ارفعها على Vercel / Netlify / GitHub Pages أو افتحها محلياً.
- `supabase/functions/logo-maker/index.ts` — فحص الوشوش + تخزين الصور + توليد الصورة الشخصية.
- `setup.sql` — نفس اللي اتطبّق (للرجوع إليه أو لمشروع تاني).

## الواجهة
4 صور شخصية، ريفرنس اختياري (لحد 3)، ستايل الصورة (واقعية/كارتون/أنمي/3D/لوحة/أفاتار)، ألوان خلفية، وصف اختياري، موافقة على الصور.
النتيجة: معاينة على 4 خلفيات، تحميل PNG، نسخة تانية بنفس الصور، وسجل نسخ للمقارنة.

## لو ظهر خطأ
الرسالة دلوقتي بتظهر معاها السبب الحقيقي. أشهرها: `GEMINI_API_KEY` ناقص/غلط، الموديل مش موجود، رصيد جيميناي خلص، أو `setup.sql` ما اتشغلش. الصور بتتخزن قبل التوليد، فلو التوليد فشل هتلاقيها في `lm-uploads`.
بعد التعديل أعد النشر: `supabase functions deploy logo-maker --no-verify-jwt --project-ref cijujqhxdjpvuyzbxedf`
