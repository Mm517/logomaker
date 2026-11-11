import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const TEXT_MODEL = Deno.env.get("GEMINI_TEXT_MODEL") ?? "gemini-2.5-flash";
const IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-2.5-flash-image";
const MAX_PER_HOUR = Number(Deno.env.get("MAX_PER_HOUR") ?? "5");
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

class Fail extends Error {
  constructor(public status: number, public msg: string, public detail?: string) { super(msg); }
}

const toB64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

async function gemini(model: string, body: unknown) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    const t = (await r.text()).slice(0, 400);
    if ((r.status === 429 || r.status >= 500) && attempt === 0) {
      const m = t.match(/retry in ([\d.]+)s/i) ?? t.match(/"retryDelay":\s*"(\d+)s"/);
      const wait = Math.min(45, m ? Math.ceil(Number(m[1])) + 1 : 3);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    if (r.status === 400 && /API key/i.test(t)) throw new Fail(500, "مفتاح GEMINI_API_KEY غلط أو منتهي.", t);
    if (r.status === 403) throw new Fail(500, "مفتاح جيميناي مش مسموح له بالموديل ده.", t);
    if (r.status === 404) throw new Fail(500, `الموديل ${model} مش موجود. غيّر GEMINI_IMAGE_MODEL / GEMINI_TEXT_MODEL.`, t);
    if (r.status === 429) throw new Fail(429, "وصلت لحد طلبات جيميناي (النسخة المجانية 5 في الدقيقة). استنى دقيقة وجرّب تاني.", t);
    throw new Fail(502, "جيميناي رجّع خطأ.", `${r.status}: ${t}`);
  }
}

// طلب واحد بس لكل الصور الأربعة (عشان حد 5 طلبات/دقيقة في النسخة المجانية)
async function checkFaces(b64s: string[], mimes: string[]) {
  const parts: unknown[] = [];
  b64s.forEach((d, i) => {
    parts.push({ text: `Photo ${i + 1}:` }, { inlineData: { mimeType: mimes[i], data: d } });
  });
  parts.push({ text: "For each photo, is there a real, clearly visible human face (not a drawing, cartoon, or object)? " +
    "Return JSON only, an array with one item per photo in order: [{\"has_face\": boolean, \"face_count\": number, \"reason\": \"short reason in Egyptian Arabic\"}]" });
  const res = await gemini(TEXT_MODEL, {
    contents: [{ parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const txt = res.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  let arr: any[] = [];
  try { arr = JSON.parse(txt); } catch { /* ignore */ }
  return b64s.map((_, i) => arr[i] ?? { has_face: false, face_count: 0, reason: "مقدرناش نقرا الصورة، جرّب صورة تانية" });
}

const STYLES: Record<string, string> = {
  realistic: "an ultra-realistic professional studio portrait, natural skin texture, soft cinematic lighting, sharp focus",
  cartoon: "a stylized 2D cartoon portrait with clean outlines and vibrant colors",
  anime: "an anime-style illustration portrait with expressive eyes and clean cel shading",
  "3d": "a polished 3D animated-film style character portrait",
  painting: "a classic oil painting portrait with visible brush strokes",
  flat: "a flat vector illustration avatar with simple shapes",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!KEY) throw new Fail(500, "السيكرت GEMINI_API_KEY مش متظبط في المشروع.");
    const form = await req.formData();
    const description = String(form.get("description") ?? "").trim().slice(0, 500);
    const kind = String(form.get("kind")) in STYLES ? String(form.get("kind")) : "realistic";
    const colors = String(form.get("colors") ?? "").replace(/[^#0-9a-fA-F, ]/g, "").slice(0, 60);
    const files = form.getAll("photos").filter((f): f is File => f instanceof File);
    const refs = form.getAll("references").filter((f): f is File => f instanceof File).slice(0, 3);

    if (files.length !== 4) throw new Fail(400, "لازم ترفع 4 صور شخصية بالظبط.");
    if ([...files, ...refs].some((f) => !f.type.startsWith("image/"))) throw new Fail(400, "الملفات لازم تكون صور.");
    if ([...files, ...refs].some((f) => f.size > 6_000_000)) throw new Fail(400, "إحدى الصور أكبر من 6MB.");

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb.from("lm_submissions").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
    if ((count ?? 0) >= MAX_PER_HOUR) throw new Fail(429, "وصلت للحد الأقصى في الساعة. جرّب بعد شوية.");

    const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
    const b64s = buffers.map(toB64);
    const refBuffers = await Promise.all(refs.map((f) => f.arrayBuffer()));
    const refB64s = refBuffers.map(toB64);

    // 1) فحص الوشوش
    const checks = await checkFaces(b64s, files.map((f) => f.type || "image/jpeg"));
    const results = checks.map((c, i) => ({ index: i + 1, ok: c.has_face === true && c.face_count === 1, face_count: c.face_count, reason: c.reason }));
    if (results.some((r) => !r.ok)) return json({ error: "في صور مفيهاش وش واضح لشخص واحد.", results }, 422);

    // 2) تخزين الصور الأول (قبل التوليد) عشان تتحفظ حتى لو التوليد فشل
    const { data: sub, error: e1 } = await sb.from("lm_submissions").insert({ description: description || "-", ip, kind }).select("id").single();
    if (e1) throw new Fail(500, "فشل الحفظ في الداتا بيس (اتأكد إنك شغّلت setup.sql).", e1.message);
    const id = sub.id as string;

    const up = async (path: string, data: ArrayBuffer | Uint8Array, type: string) => {
      const { error } = await sb.storage.from("lm-uploads").upload(path, data, { contentType: type, upsert: true });
      if (error) throw new Fail(500, "فشل رفع الملف للـ Storage (اتأكد إن bucket اسمه lm-uploads موجود).", error.message);
    };
    const paths = files.map((_, i) => `${id}/photo-${i + 1}.jpg`);
    const refPaths = refs.map((_, i) => `${id}/ref-${i + 1}.jpg`);
    await Promise.all([
      ...paths.map((p, i) => up(p, buffers[i], files[i].type || "image/jpeg")),
      ...refPaths.map((p, i) => up(p, refBuffers[i], refs[i].type || "image/jpeg")),
    ]);
    const { error: e3 } = await sb.from("lm_photos").insert([
      ...paths.map((path, i) => ({ submission_id: id, path, kind: "face", has_face: true, note: results[i].reason })),
      ...refPaths.map((path) => ({ submission_id: id, path, kind: "reference", has_face: false, note: null })),
    ]);
    if (e3) throw new Fail(500, "فشل تسجيل الصور في الداتا بيس.", e3.message);

    // 3) توليد الصورة الشخصية
    const gen = await gemini(IMAGE_MODEL, {
      contents: [{ parts: [
        { text: "The next 4 images are photos of the SAME real person from different angles. Use them to preserve his/her exact face, features, skin tone and hair:" },
        ...b64s.map((d, i) => ({ inlineData: { mimeType: files[i].type || "image/jpeg", data: d } })),
        ...(refs.length ? [
          { text: `The next ${refs.length} image(s) are STYLE REFERENCES: follow their mood, lighting and color feel but do not copy them or their people.` },
          ...refB64s.map((d, i) => ({ inlineData: { mimeType: refs[i].type || "image/jpeg", data: d } })),
        ] : []),
        { text: [
          `Create ${STYLES[kind]} of this exact person. Keep the face clearly recognizable and faithful to the photos. Head and shoulders, centered, no text, no watermark.`,
          description ? `Extra details: ${description}.` : "",
          colors ? `Use this color palette for the background and accents: ${colors}.` : "",
        ].filter(Boolean).join(" ") },
      ] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    });
    const cand = gen.candidates?.[0];
    const part = cand?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
    const inline = part?.inlineData ?? part?.inline_data;
    if (!inline?.data) {
      const why = gen.promptFeedback?.blockReason ?? cand?.finishReason ?? "";
      const txt = cand?.content?.parts?.find((p: any) => p.text)?.text ?? "";
      throw new Fail(502, "جيميناي رفض أو ماطلعش صورة. جرّب صور أوضح أو وصف تاني.", `${why} ${txt}`.trim().slice(0, 300));
    }
    const outBytes = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0));

    const outPath = `${id}/result.png`;
    await up(outPath, outBytes, inline.mimeType ?? inline.mime_type ?? "image/png");
    await sb.from("lm_submissions").update({ logo_path: outPath }).eq("id", id);

    const { data: signed } = await sb.storage.from("lm-uploads").createSignedUrl(outPath, 3600);
    return json({ id, results, logo_url: signed?.signedUrl });
  } catch (e) {
    console.error(e);
    if (e instanceof Fail) return json({ error: e.msg, detail: e.detail }, e.status);
    return json({ error: "حصل خطأ في السيرفر.", detail: String(e).slice(0, 300) }, 500);
  }
});
