// Reformas de baños en Alicante: сайт-заявка + блог и SEO. Один файл, Node 18+, без зависимостей.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ======================= База данных =======================
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.resolve("data");
const PERSISTENT = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR);
const FILE = path.join(DATA_DIR, "db.json");
const empty = () => ({ leads: [], projects: [], viz: [], posts: [], seoJobs: [], settings: {}, seo: {} });
let db = empty();
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) db = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
} catch (e) { console.error("Не удалось прочитать базу:", e.message); }
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 200); };
function flush() {
  try { const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE); }
  catch (e) { console.error("Не удалось сохранить базу:", e.message); }
}
process.on("SIGTERM", () => { flush(); process.exit(0); });
const newId = () => crypto.randomBytes(8).toString("hex");
const token = () => crypto.randomBytes(16).toString("hex");
class UserError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clampNum = (v, lo, hi, def) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ======================= Языки =======================
const LANGS = ["es", "en", "ru"];
const LANG_NAME = { es: "Spanish (Spain)", en: "English", ru: "Russian" };
const LOCALE = { es: "es-ES", en: "en-GB", ru: "ru-RU" };
const OG_LOCALE = { es: "es_ES", en: "en_GB", ru: "ru_RU" };
const normLang = (l) => (LANGS.includes(l) ? l : "es");
const homeUrl = (l) => (l === "es" ? "/" : `/${l}`);
const blogBase = (l) => (l === "es" ? "/blog" : `/${l}/blog`);
const privacyUrl = (l) => (l === "es" ? "/privacidad" : `/${l}/privacy`);
const money = (v, l) => new Intl.NumberFormat(LOCALE[l], { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);

// ======================= Картинки =======================
const IMG = path.join(DATA_DIR, "img");
for (const d of ["projects", "blog", "private"]) fs.mkdirSync(path.join(IMG, d), { recursive: true });
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
function parseImg(v, msg = "Нужна картинка JPG, PNG или WEBP.") {
  const m = DATA_URL.exec(v || "");
  if (!m) throw new UserError(msg);
  return { buf: Buffer.from(m[2], "base64"), type: m[1] };
}
const extOf = (t) => (/png/.test(t) ? "png" : /webp/.test(t) ? "webp" : "jpg");
function writeImg(dir, name, buf, type) {
  const d = path.join(IMG, dir);
  for (const f of fs.readdirSync(d)) if (f.startsWith(name + ".")) fs.rmSync(path.join(d, f), { force: true });
  const file = `${name}.${extOf(type)}`;
  fs.writeFileSync(path.join(d, file), buf);
  return `/img/${dir}/${file}?v=${Date.now()}`;
}
function rmImg(url) {
  const m = /^\/img\/(projects|blog|private)\/([\w-]+\.(?:jpg|png|webp))/.exec(url || "");
  if (m) fs.rmSync(path.join(IMG, m[1], m[2]), { force: true });
}
function serveImg(res, sub, name) {
  if (!["projects", "blog", "private"].includes(sub) || !/^[\w-]+\.(jpg|png|webp)$/.test(name)) return false;
  const file = path.join(IMG, sub, name);
  if (!fs.existsSync(file)) return false;
  const h = { "content-type": name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg", "cache-control": sub === "private" ? "private, max-age=86400" : "public, max-age=604800", "x-content-type-options": "nosniff" };
  if (sub === "private") h["x-robots-tag"] = "noindex, nofollow";
  res.writeHead(200, h);
  fs.createReadStream(file).pipe(res);
  return true;
}
async function fetchImg(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("не удалось скачать картинку");
  return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
}

// ======================= Настройки компании, цены =======================
db.settings.biz ||= {};
db.settings.calc ||= {};
db.settings.services ||= {};
db.settings.viz ||= {};
const AREAS_DEFAULT = ["Alicante", "Playa de San Juan", "Sant Joan d'Alacant", "San Vicente del Raspeig", "El Campello", "Mutxamel", "Santa Pola", "Elche"];
function biz() {
  const b = db.settings.biz;
  return {
    name: b.name || process.env.BUSINESS_NAME || "Reformas Baño Alicante",
    phone: b.phone || process.env.BUSINESS_PHONE || "",
    whatsapp: b.whatsapp || "",
    email: b.email || process.env.CONTACT_EMAIL || "",
    street: b.street || "", postal: b.postal || "", city: b.city || "Alicante", cityRu: b.cityRu || "Аликанте", region: b.region || "Alicante",
    hours: b.hours || "", openingHours: b.openingHours || "Mo-Fr 08:00-19:00",
    guarantee: b.guarantee || 2, gbp: b.gbp || "", nif: b.nif || "",
    areas: Array.isArray(b.areas) && b.areas.length ? b.areas : AREAS_DEFAULT,
    lat: Number.isFinite(b.lat) ? b.lat : 38.3452, lng: Number.isFinite(b.lng) ? b.lng : -0.481,
  };
}
const BRAND = () => biz().name;
const digits = (s) => String(s || "").replace(/[^\d+]/g, "");
function phoneHref(p) {
  let d = digits(p);
  if (!d) return "";
  if (!d.startsWith("+")) d = (d.startsWith("34") && d.length > 9 ? "+" : "+34") + d;
  return "tel:" + d;
}
function waLink(b, text = "") {
  let d = digits(b.whatsapp || b.phone).replace(/^\+/, "");
  if (!d) return "";
  if (d.length === 9) d = "34" + d;
  return `https://wa.me/${d}${text ? "?text=" + encodeURIComponent(text) : ""}`;
}
const SERVICES = ["integral", "shower", "small", "tiles", "plumbing", "accessible"];
const SVC0 = { integral: 4500, shower: 1200, small: 3500, tiles: 35, plumbing: 150, accessible: 2200 };
const svcS = () => ({ ...SVC0, ...db.settings.services });
const CALC0 = { min: 3000, partial: 400, full: 750, premium: 1100, screen: 350, vanity: 450, floor: 90, access: 700 };
const calcS = () => ({ ...CALC0, ...db.settings.calc });
const VIZ_MODELS = [
  { id: "fal-ai/nano-banana-pro/edit", name: "Nano Banana Pro (лучшее качество)", cost: 0.15 },
  { id: "fal-ai/nano-banana-2/edit", name: "Nano Banana 2 (быстрее и дешевле)", cost: 0.12 },
];
const VIZ0 = { enabled: true, model: VIZ_MODELS[0].id, dailyCap: 40, perPhone: 2 };
const vizS = () => ({ ...VIZ0, ...db.settings.viz });

// ======================= fal.ai =======================
const falKey = () => (process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim();
async function falFetch(url, opts = {}) {
  const k = falKey();
  if (!k) throw new UserError("На сервере не задан FAL_KEY. Railway → сервис → Variables.", 500);
  const r = await fetch(url, { ...opts, headers: { authorization: "Key " + k, "content-type": "application/json", ...(opts.headers || {}) } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}
function falError(status, data) {
  let d = data?.detail ?? data?.error ?? data?.message ?? data?.raw ?? "";
  if (Array.isArray(d)) d = d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  else if (typeof d === "object") d = JSON.stringify(d);
  d = String(d);
  if (status === 402 || /balance|credit|locked|billing/i.test(d)) return { admin: "На аккаунте fal.ai закончился баланс." };
  if (status === 401 || status === 403) return { admin: `fal.ai не принял ключ (${status}).` };
  return { admin: `(${status}) ${d.slice(0, 300)}` };
}
const OPTIONAL = ["aspect_ratio", "resolution", "output_format", "image_size"];
async function falSubmit(endpoint, input) {
  const url = `https://queue.fal.run/${endpoint}`;
  let r = await falFetch(url, { method: "POST", body: JSON.stringify(input) });
  if (r.status === 422) {
    const slim = { ...input };
    for (const k of OPTIONAL) delete slim[k];
    r = await falFetch(url, { method: "POST", body: JSON.stringify(slim) });
  }
  return r;
}
async function falPoll(job) {
  const st = await falFetch(job.statusUrl);
  if (!st.ok) return st.status < 500 ? { state: "failed", error: falError(st.status, st.data).admin } : { state: "working" };
  if (st.data.status !== "COMPLETED") return { state: "working", queue: st.data.queue_position ?? null };
  const out = await falFetch(job.responseUrl);
  if (!out.ok) return { state: "failed", error: falError(out.status, out.data).admin };
  return { state: "done", data: out.data };
}
const falImages = (data) => (data?.images || (data?.image ? [data.image] : [])).map((i) => (typeof i === "string" ? i : i?.url)).filter(Boolean);
async function falProbe() {
  if (!falKey()) return { ok: false, text: "FAL_KEY не задан" };
  try {
    const r = await fetch("https://queue.fal.run/fal-ai/nano-banana-pro/requests/00000000-0000-0000-0000-000000000000/status", { headers: { authorization: "Key " + falKey() } });
    const t = await r.text();
    if (/balance|locked|billing/i.test(t)) return { ok: false, text: "Ключ верный, но закончился баланс fal.ai" };
    if (r.status === 401 || r.status === 403) return { ok: false, text: "fal.ai не принял ключ" };
    return { ok: true, text: "Ключ принят" };
  } catch (e) { return { ok: false, text: "Нет связи с fal.ai: " + e.message }; }
}

// ======================= Уведомления в Telegram =======================
const tgOn = () => Boolean((process.env.TELEGRAM_BOT_TOKEN || "").trim() && (process.env.TELEGRAM_CHAT_ID || "").trim());
async function notify(text) {
  if (!tgOn()) return;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN.trim()}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID.trim(), text, disable_web_page_preview: true }),
    });
  } catch {}
}

// ======================= Защита от спама =======================
const hits = new Map();
function limit(key, n, ms) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < ms);
  if (a.length >= n) return false;
  a.push(now); hits.set(key, a);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < 864e5)) hits.delete(k); }, 36e5).unref();
const ipOf = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

// ======================= Тексты лендинга =======================
const HOME_T = {
  es: {
    "nav.services": "Servicios", "nav.projects": "Proyectos", "nav.prices": "Precios", "nav.viz": "Visualizador", "nav.blog": "Blog", "nav.faq": "Preguntas",
    "cta.quote": "Presupuesto gratis", "cta.call": "Llamar", "cta.wa": "WhatsApp",
    "hero.eyebrow": "Reformas de baños · {city}",
    "hero.title": "Reforma de baños en {city} <em>con precio cerrado</em>",
    "hero.lead": "Cambiamos la bañera por un plato de ducha, alicatamos, renovamos la fontanería y te entregamos el baño listo para usar. Un solo equipo de principio a fin y un presupuesto que no cambia.",
    "fact.1": "Visita y presupuesto gratis", "fact.2": "Precio cerrado por escrito", "fact.3": "Garantía de {g} años",
    "quick.t": "Te llamamos gratis", "quick.p": "Déjanos tu teléfono: te llamamos el mismo día laborable y concretamos la visita.", "quick.go": "Quiero que me llaméis",
    "svc.eyebrow": "Servicios", "svc.title": "Qué hacemos en tu baño", "svc.from": "desde",
    "svc.integral.t": "Reforma integral de baño", "svc.integral.p": "Demolición, fontanería y electricidad nuevas, alicatado, sanitarios y mobiliario. Te entregamos el baño terminado.",
    "svc.shower.t": "Cambio de bañera por plato de ducha", "svc.shower.p": "Plato extraplano a ras de suelo, mampara y grifería termostática. Normalmente en 1–2 días.",
    "svc.small.t": "Reforma de baño pequeño", "svc.small.p": "Soluciones para ganar espacio: inodoro suspendido, mueble volado, ducha de obra y espejos con almacenaje.",
    "svc.tiles.t": "Alicatado y microcemento", "svc.tiles.p": "Porcelánico de gran formato, baldosa hidráulica o microcemento sin juntas, también sobre el revestimiento existente.",
    "svc.plumbing.t": "Fontanería y sanitarios", "svc.plumbing.p": "Cambio de tuberías antiguas, desagües, inodoros, lavabos, grifería y termos.",
    "svc.accessible.t": "Baño adaptado", "svc.accessible.p": "Ducha sin barreras, asideros, asiento abatible y suelo antideslizante para personas mayores.",
    "how.eyebrow": "Cómo trabajamos", "how.title": "De la primera llamada a la entrega",
    "how.1t": "Visita gratuita", "how.1p": "Medimos, revisamos las instalaciones y escuchamos lo que quieres.",
    "how.2t": "Presupuesto cerrado", "how.2p": "Por escrito y desglosado en 24–48 horas, con materiales y plazos.",
    "how.3t": "Obra limpia", "how.3p": "Protegemos la vivienda, retiramos escombros y te informamos de cada fase.",
    "how.4t": "Entrega y garantía", "how.4p": "Revisamos juntos el resultado y te dejamos la garantía por escrito.",
    "proj.eyebrow": "Proyectos", "proj.title": "Antes y después", "proj.lead": "Baños reales que hemos reformado. Arrastra el divisor para comparar.", "proj.before": "antes", "proj.after": "después", "proj.days": "días",
    "price.eyebrow": "Precios", "price.title": "¿Cuánto cuesta reformar un baño en {city}?", "price.lead": "Precios orientativos sin IVA. Tras la visita te damos un presupuesto cerrado y por escrito.",
    "calc.title": "Calcula tu presupuesto", "calc.area": "Superficie del baño", "calc.level": "Tipo de reforma",
    "calc.partial": "Parcial", "calc.partialD": "Ducha, sanitarios o revestimiento", "calc.full": "Integral", "calc.fullD": "Todo nuevo, instalaciones incluidas", "calc.premium": "Premium", "calc.premiumD": "Gran formato, microcemento, grifería empotrada",
    "calc.extras": "Extras", "calc.screen": "Mampara de cristal", "calc.vanity": "Mueble de lavabo suspendido", "calc.floor": "Suelo radiante", "calc.access": "Adaptación para movilidad reducida",
    "calc.result": "Estimación", "calc.note": "Orientativo, IVA no incluido. El precio final se fija tras la visita.", "calc.cta": "Pedir presupuesto exacto",
    "calc.msg": "Calculadora: baño de {area} m², reforma {level}{extras}. Estimación {range}.",
    "viz.eyebrow": "Visualizador IA", "viz.title": "Mira cómo quedaría tu baño", "viz.lead": "Sube una foto de tu baño actual, elige un estilo y la inteligencia artificial te enseña una propuesta en un minuto. Gratis.",
    "viz.upload": "Sube una foto de tu baño", "viz.uploadHint": "Desde la puerta, con buena luz · JPG o PNG", "viz.style": "Estilo", "viz.contact": "¿A quién enviamos la propuesta?",
    "viz.go": "Ver mi baño reformado", "viz.wait": "Diseñando tu baño… suele tardar 30–60 segundos", "viz.done": "Así podría quedar tu baño. Te llamaremos para comentar la reforma.",
    "viz.note": "Imagen orientativa generada por IA. El resultado real depende de la obra y de los materiales.", "viz.again": "Probar con otra foto",
    "st.modern": "Moderno con microcemento", "st.white": "Blanco minimalista", "st.med": "Mediterráneo", "st.spa": "Madera y piedra", "st.dark": "Elegante oscuro", "st.marble": "Mármol clásico",
    "areas.eyebrow": "Zona de trabajo", "areas.title": "Reformamos baños en {city} y alrededores", "areas.lead": "Trabajamos en {city} y en los municipios cercanos. Si tu localidad no aparece, pregúntanos.",
    "faq.eyebrow": "Preguntas", "faq.title": "Preguntas frecuentes",
    "blog.eyebrow": "Blog", "blog.title": "Consejos para reformar tu baño", "blog.all": "Todos los artículos",
    "contact.eyebrow": "Contacto", "contact.title": "Pide tu presupuesto gratis", "contact.lead": "Cuéntanos qué quieres hacer. Si puedes, añade fotos del baño: así el presupuesto será más preciso.",
    "f.name": "Nombre", "f.phone": "Teléfono", "f.email": "Email (opcional)", "f.msg": "¿Qué quieres reformar?", "f.msgPh": "Por ejemplo: baño de 5 m² en un piso de los 80, cambiar la bañera por un plato de ducha y alicatar…",
    "f.photos": "Fotos del baño (opcional, hasta 3)", "f.add": "Añadir fotos", "f.consent": "He leído y acepto la <a href=\"{privacy}\">política de privacidad</a>.", "f.send": "Enviar solicitud",
    "f.sending": "Enviando…", "f.ok": "¡Gracias! Te llamaremos en horario laboral, normalmente el mismo día.",
    "c.phone": "Teléfono", "c.wa": "Escríbenos por WhatsApp", "c.email": "Email", "c.address": "Dirección", "c.hours": "Horario", "c.reviews": "Ver opiniones en Google",
    "band.t": "¿Empezamos con tu baño nuevo?", "foot.privacy": "Política de privacidad", "foot.tag": "Reformas de baños en {city}",
    "e.name": "Escribe tu nombre.", "e.phone": "Revisa el teléfono: necesitamos al menos 9 cifras.", "e.consent": "Acepta la política de privacidad para enviar la solicitud.",
    "e.photo": "No hemos podido abrir la foto. Guárdala como JPG y vuelve a intentarlo.", "e.net": "Sin conexión con el servidor. Revisa tu internet.", "e.max": "Bastan tres fotos.",
    "e.limit": "Has alcanzado el límite de visualizaciones por hoy. Te llamamos y lo vemos juntos.", "e.busy": "El visualizador está muy solicitado hoy. Déjanos tu teléfono y te enviamos la propuesta.",
    "e.off": "El visualizador no está disponible ahora mismo.", "e.failed": "No hemos podido generar la imagen. Inténtalo con otra foto.", "e.bad": "Solicitud incorrecta.", "e.many": "Demasiadas solicitudes. Inténtalo más tarde o llámanos.",
    "cookie.t": "Usamos cookies analíticas solo si las aceptas.", "cookie.yes": "Aceptar", "cookie.no": "Rechazar",
  },
  en: {
    "nav.services": "Services", "nav.projects": "Projects", "nav.prices": "Prices", "nav.viz": "Visualiser", "nav.blog": "Blog", "nav.faq": "FAQ",
    "cta.quote": "Free quote", "cta.call": "Call", "cta.wa": "WhatsApp",
    "hero.eyebrow": "Bathroom renovations · {city}",
    "hero.title": "Bathroom renovation in {city} <em>at a fixed price</em>",
    "hero.lead": "We swap your bathtub for a walk-in shower, retile, renew the plumbing and hand over a bathroom ready to use. One team from start to finish and a quote that doesn't change.",
    "fact.1": "Free visit and quote", "fact.2": "Fixed price in writing", "fact.3": "{g}-year guarantee",
    "quick.t": "We'll call you back", "quick.p": "Leave your number: we call you the same working day to arrange a visit.", "quick.go": "Call me back",
    "svc.eyebrow": "Services", "svc.title": "What we do in your bathroom", "svc.from": "from",
    "svc.integral.t": "Full bathroom renovation", "svc.integral.p": "Strip-out, new plumbing and electrics, tiling, sanitaryware and furniture. We hand over a finished bathroom.",
    "svc.shower.t": "Bath to shower conversion", "svc.shower.p": "Low-profile floor-level shower tray, glass screen and thermostatic mixer. Usually 1–2 days.",
    "svc.small.t": "Small bathroom renovation", "svc.small.p": "Space-saving solutions: wall-hung toilet, floating vanity, built-in shower and storage mirrors.",
    "svc.tiles.t": "Tiling and microcement", "svc.tiles.p": "Large-format porcelain, patterned tiles or seamless microcement, also over existing tiles.",
    "svc.plumbing.t": "Plumbing and sanitaryware", "svc.plumbing.p": "Replacing old pipes, drains, toilets, basins, taps and water heaters.",
    "svc.accessible.t": "Accessible bathroom", "svc.accessible.p": "Step-free shower, grab rails, fold-down seat and non-slip floor for older people.",
    "how.eyebrow": "How we work", "how.title": "From the first call to handover",
    "how.1t": "Free visit", "how.1p": "We measure, check the installations and listen to what you want.",
    "how.2t": "Fixed quote", "how.2p": "Itemised and in writing within 24–48 hours, with materials and timeline.",
    "how.3t": "Clean works", "how.3p": "We protect your home, remove rubble and keep you updated at every stage.",
    "how.4t": "Handover and guarantee", "how.4p": "We check the result together and give you a written guarantee.",
    "proj.eyebrow": "Projects", "proj.title": "Before and after", "proj.lead": "Real bathrooms we have renovated. Drag the divider to compare.", "proj.before": "before", "proj.after": "after", "proj.days": "days",
    "price.eyebrow": "Prices", "price.title": "How much does a bathroom renovation cost in {city}?", "price.lead": "Guide prices excluding VAT. After the visit we give you a fixed written quote.",
    "calc.title": "Estimate your cost", "calc.area": "Bathroom size", "calc.level": "Type of renovation",
    "calc.partial": "Partial", "calc.partialD": "Shower, sanitaryware or tiling", "calc.full": "Full", "calc.fullD": "Everything new, including installations", "calc.premium": "Premium", "calc.premiumD": "Large format, microcement, concealed fittings",
    "calc.extras": "Extras", "calc.screen": "Glass shower screen", "calc.vanity": "Floating vanity unit", "calc.floor": "Underfloor heating", "calc.access": "Reduced-mobility adaptation",
    "calc.result": "Estimate", "calc.note": "Guide only, VAT not included. The final price is set after the visit.", "calc.cta": "Get an exact quote",
    "calc.msg": "Calculator: {area} m² bathroom, {level} renovation{extras}. Estimate {range}.",
    "viz.eyebrow": "AI visualiser", "viz.title": "See your new bathroom first", "viz.lead": "Upload a photo of your current bathroom, choose a style and AI shows you a design in about a minute. Free.",
    "viz.upload": "Upload a photo of your bathroom", "viz.uploadHint": "From the doorway, in good light · JPG or PNG", "viz.style": "Style", "viz.contact": "Who should we send the design to?",
    "viz.go": "Show my renovated bathroom", "viz.wait": "Designing your bathroom… usually 30–60 seconds", "viz.done": "This is how your bathroom could look. We'll call you to talk it through.",
    "viz.note": "AI-generated illustration. The real result depends on the works and materials.", "viz.again": "Try another photo",
    "st.modern": "Modern microcement", "st.white": "Minimal white", "st.med": "Mediterranean", "st.spa": "Wood and stone", "st.dark": "Dark and elegant", "st.marble": "Classic marble",
    "areas.eyebrow": "Where we work", "areas.title": "Bathroom renovations in {city} and nearby", "areas.lead": "We work in {city} and the surrounding towns. If yours isn't listed, just ask.",
    "faq.eyebrow": "FAQ", "faq.title": "Frequently asked questions",
    "blog.eyebrow": "Blog", "blog.title": "Bathroom renovation tips", "blog.all": "All articles",
    "contact.eyebrow": "Contact", "contact.title": "Get your free quote", "contact.lead": "Tell us what you'd like to do. Photos of the bathroom help us give a more accurate quote.",
    "f.name": "Name", "f.phone": "Phone", "f.email": "Email (optional)", "f.msg": "What would you like to renovate?", "f.msgPh": "E.g. 5 m² bathroom in a 1980s flat, replace the bath with a walk-in shower and retile…",
    "f.photos": "Bathroom photos (optional, up to 3)", "f.add": "Add photos", "f.consent": "I have read and accept the <a href=\"{privacy}\">privacy policy</a>.", "f.send": "Send request",
    "f.sending": "Sending…", "f.ok": "Thank you! We'll call you during working hours, usually the same day.",
    "c.phone": "Phone", "c.wa": "Message us on WhatsApp", "c.email": "Email", "c.address": "Address", "c.hours": "Opening hours", "c.reviews": "See our Google reviews",
    "band.t": "Ready for your new bathroom?", "foot.privacy": "Privacy policy", "foot.tag": "Bathroom renovations in {city}",
    "e.name": "Please enter your name.", "e.phone": "Please check the phone number: at least 9 digits.", "e.consent": "Please accept the privacy policy to send your request.",
    "e.photo": "We couldn't open this photo. Save it as JPG and try again.", "e.net": "Can't reach the server. Check your connection.", "e.max": "Three photos are enough.",
    "e.limit": "You've reached today's visualiser limit. We'll call you and go through it together.", "e.busy": "The visualiser is very busy today. Leave your number and we'll send you the design.",
    "e.off": "The visualiser is not available right now.", "e.failed": "We couldn't create the image. Try another photo.", "e.bad": "Invalid request.", "e.many": "Too many requests. Please try later or call us.",
    "cookie.t": "We use analytics cookies only if you accept them.", "cookie.yes": "Accept", "cookie.no": "Decline",
  },
  ru: {
    "nav.services": "Услуги", "nav.projects": "Работы", "nav.prices": "Цены", "nav.viz": "Визуализатор", "nav.blog": "Блог", "nav.faq": "Вопросы",
    "cta.quote": "Бесплатная смета", "cta.call": "Позвонить", "cta.wa": "WhatsApp",
    "hero.eyebrow": "Ремонт ванных комнат · {city}",
    "hero.title": "Ремонт ванной в {cityRu} <em>по фиксированной цене</em>",
    "hero.lead": "Меняем ванну на душ, кладём плитку, обновляем сантехнику и сдаём готовую ванную. Одна бригада от начала до конца и смета, которая не растёт.",
    "fact.1": "Бесплатный выезд и смета", "fact.2": "Фиксированная цена в договоре", "fact.3": "Гарантия {g} года",
    "quick.t": "Перезвоним бесплатно", "quick.p": "Оставьте телефон: перезвоним в тот же рабочий день и договоримся о замере. Говорим по-русски.", "quick.go": "Перезвоните мне",
    "svc.eyebrow": "Услуги", "svc.title": "Что мы делаем в ванной", "svc.from": "от",
    "svc.integral.t": "Ремонт ванной под ключ", "svc.integral.p": "Демонтаж, новая сантехника и электрика, плитка, оборудование и мебель. Сдаём готовую ванную.",
    "svc.shower.t": "Замена ванны на душ", "svc.shower.p": "Низкий поддон вровень с полом, стеклянная перегородка и термостатический смеситель. Обычно 1–2 дня.",
    "svc.small.t": "Ремонт маленькой ванной", "svc.small.p": "Решения для экономии места: подвесной унитаз, подвесная тумба, душ без поддона, зеркала с хранением.",
    "svc.tiles.t": "Плитка и микроцемент", "svc.tiles.p": "Крупноформатный керамогранит, гидравлическая плитка или микроцемент без швов, в том числе поверх старой плитки.",
    "svc.plumbing.t": "Сантехника", "svc.plumbing.p": "Замена старых труб, канализации, унитазов, раковин, смесителей и бойлеров.",
    "svc.accessible.t": "Ванная для пожилых", "svc.accessible.p": "Душ без порога, поручни, откидное сиденье и противоскользящий пол.",
    "how.eyebrow": "Как мы работаем", "how.title": "От первого звонка до сдачи",
    "how.1t": "Бесплатный замер", "how.1p": "Измеряем, проверяем коммуникации и обсуждаем, что вы хотите.",
    "how.2t": "Фиксированная смета", "how.2p": "Письменно и по пунктам за 24–48 часов, с материалами и сроками.",
    "how.3t": "Аккуратная работа", "how.3p": "Защищаем квартиру, вывозим мусор и сообщаем о каждом этапе.",
    "how.4t": "Сдача и гарантия", "how.4p": "Вместе принимаем результат, гарантия оформляется письменно.",
    "proj.eyebrow": "Работы", "proj.title": "До и после", "proj.lead": "Реальные ванные, которые мы отремонтировали. Потяните разделитель, чтобы сравнить.", "proj.before": "до", "proj.after": "после", "proj.days": "дн.",
    "price.eyebrow": "Цены", "price.title": "Сколько стоит ремонт ванной в {cityRu}", "price.lead": "Ориентировочные цены без IVA. После замера даём фиксированную смету письменно.",
    "calc.title": "Рассчитайте стоимость", "calc.area": "Площадь ванной", "calc.level": "Тип ремонта",
    "calc.partial": "Частичный", "calc.partialD": "Душ, сантехника или плитка", "calc.full": "Под ключ", "calc.fullD": "Всё новое, включая коммуникации", "calc.premium": "Премиум", "calc.premiumD": "Крупный формат, микроцемент, скрытый монтаж",
    "calc.extras": "Дополнительно", "calc.screen": "Стеклянная душевая перегородка", "calc.vanity": "Подвесная тумба с раковиной", "calc.floor": "Тёплый пол", "calc.access": "Адаптация для пожилых",
    "calc.result": "Оценка", "calc.note": "Ориентировочно, без IVA. Точная цена после замера.", "calc.cta": "Получить точную смету",
    "calc.msg": "Калькулятор: ванная {area} м², ремонт «{level}»{extras}. Оценка {range}.",
    "viz.eyebrow": "ИИ-визуализатор", "viz.title": "Посмотрите на ванную после ремонта", "viz.lead": "Загрузите фото вашей ванной, выберите стиль, и нейросеть за минуту покажет вариант ремонта. Бесплатно.",
    "viz.upload": "Загрузите фото ванной", "viz.uploadHint": "От двери, при хорошем свете · JPG или PNG", "viz.style": "Стиль", "viz.contact": "Кому отправить вариант?",
    "viz.go": "Показать ванную после ремонта", "viz.wait": "Проектируем вашу ванную… обычно 30–60 секунд", "viz.done": "Так может выглядеть ваша ванная. Мы перезвоним и обсудим ремонт.",
    "viz.note": "Иллюстрация создана ИИ. Реальный результат зависит от работ и материалов.", "viz.again": "Попробовать другое фото",
    "st.modern": "Современный, микроцемент", "st.white": "Белый минимализм", "st.med": "Средиземноморский", "st.spa": "Дерево и камень", "st.dark": "Тёмный элегантный", "st.marble": "Классический мрамор",
    "areas.eyebrow": "Где работаем", "areas.title": "Ремонт ванных в {cityRu} и окрестностях", "areas.lead": "Работаем в {cityRu} и соседних городах. Если вашего нет в списке, спросите.",
    "faq.eyebrow": "Вопросы", "faq.title": "Частые вопросы",
    "blog.eyebrow": "Блог", "blog.title": "Советы по ремонту ванной", "blog.all": "Все статьи",
    "contact.eyebrow": "Контакты", "contact.title": "Получите бесплатную смету", "contact.lead": "Расскажите, что хотите сделать. Если можете, приложите фото ванной: так смета будет точнее.",
    "f.name": "Имя", "f.phone": "Телефон", "f.email": "Email (необязательно)", "f.msg": "Что нужно сделать?", "f.msgPh": "Например: ванная 5 м² в квартире 80-х, заменить ванну на душ и положить плитку…",
    "f.photos": "Фото ванной (необязательно, до 3)", "f.add": "Добавить фото", "f.consent": "Я прочитал(а) и принимаю <a href=\"{privacy}\">политику конфиденциальности</a>.", "f.send": "Отправить заявку",
    "f.sending": "Отправляем…", "f.ok": "Спасибо! Перезвоним в рабочее время, обычно в тот же день.",
    "c.phone": "Телефон", "c.wa": "Написать в WhatsApp", "c.email": "Email", "c.address": "Адрес", "c.hours": "Часы работы", "c.reviews": "Отзывы в Google",
    "band.t": "Начнём ремонт вашей ванной?", "foot.privacy": "Политика конфиденциальности", "foot.tag": "Ремонт ванных комнат в {cityRu}",
    "e.name": "Укажите имя.", "e.phone": "Проверьте телефон: нужно минимум 9 цифр.", "e.consent": "Примите политику конфиденциальности, чтобы отправить заявку.",
    "e.photo": "Не удалось открыть фото. Сохраните его как JPG и попробуйте снова.", "e.net": "Нет связи с сервером. Проверьте интернет.", "e.max": "Достаточно трёх фото.",
    "e.limit": "Лимит визуализаций на сегодня исчерпан. Мы перезвоним и всё обсудим.", "e.busy": "Визуализатор сегодня перегружен. Оставьте телефон, и мы пришлём вариант.",
    "e.off": "Визуализатор сейчас недоступен.", "e.failed": "Не удалось создать изображение. Попробуйте другое фото.", "e.bad": "Некорректный запрос.", "e.many": "Слишком много заявок. Попробуйте позже или позвоните нам.",
    "cookie.t": "Мы используем аналитические cookie только с вашего согласия.", "cookie.yes": "Принять", "cookie.no": "Отказаться",
  },
};
const FAQ_T = {
  es: [
    ["¿Cuánto cuesta reformar un baño en {city}?", "Depende de la superficie, del estado de las instalaciones y de los materiales. Cambiar la bañera por un plato de ducha empieza en torno a {pShower} y una reforma integral en torno a {pIntegral}, IVA aparte. Tras la visita te damos un precio cerrado por escrito."],
    ["¿Cuánto dura la obra?", "Un cambio de bañera por plato de ducha suele hacerse en 1–2 días. Una reforma integral de un baño estándar, entre 7 y 15 días laborables según los materiales y sus plazos de entrega."],
    ["¿Necesito permiso del Ayuntamiento?", "Las reformas interiores de baño suelen tramitarse como obra menor (declaración responsable o licencia, según el municipio). Te indicamos qué corresponde en tu caso y te ayudamos con el trámite."],
    ["¿Puedo seguir viviendo en casa durante la obra?", "Sí. Protegemos suelos y zonas de paso, retiramos escombros cada día y, si es tu único baño, planificamos la obra para que estés el menor tiempo posible sin ducha."],
    ["¿Qué garantía dais?", "La obra tiene {g} años de garantía por escrito, además de la garantía de los fabricantes de sanitarios y grifería."],
    ["¿Os encargáis también de la fontanería y la electricidad?", "Sí. Renovamos tuberías, desagües, puntos de luz y extracción. Tienes un solo responsable para toda la obra."],
  ],
  en: [
    ["How much does a bathroom renovation cost in {city}?", "It depends on the size, the condition of the installations and the materials. A bath-to-shower conversion starts at around {pShower} and a full renovation at around {pIntegral}, plus VAT. After the visit we give you a fixed price in writing."],
    ["How long do the works take?", "A bath-to-shower conversion usually takes 1–2 days. A full renovation of a standard bathroom takes 7–15 working days, depending on materials and delivery times."],
    ["Do I need a permit from the town hall?", "Interior bathroom renovations are usually processed as minor works (a responsible declaration or a licence, depending on the town). We tell you what applies in your case and help with the paperwork."],
    ["Can I stay at home during the works?", "Yes. We protect floors and walkways, remove rubble daily and, if it is your only bathroom, plan the works so you are without a shower for as little time as possible."],
    ["What guarantee do you give?", "The works come with a {g}-year written guarantee, plus the manufacturers' guarantees on sanitaryware and taps."],
    ["Do you also handle plumbing and electrics?", "Yes. We renew pipes, drains, lighting points and extraction. You have one point of contact for the whole job."],
  ],
  ru: [
    ["Сколько стоит ремонт ванной в {cityRu}?", "Зависит от площади, состояния коммуникаций и материалов. Замена ванны на душ — примерно от {pShower}, ремонт под ключ — примерно от {pIntegral}, без IVA. После замера даём фиксированную цену письменно."],
    ["Сколько длится ремонт?", "Замена ванны на душ обычно занимает 1–2 дня. Ремонт стандартной ванной под ключ — 7–15 рабочих дней, в зависимости от материалов и сроков их поставки."],
    ["Нужно ли разрешение мэрии (Ayuntamiento)?", "Ремонт ванной внутри квартиры обычно оформляется как малые работы (obra menor: declaración responsable или лицензия, в зависимости от города). Подскажем, что нужно в вашем случае, и поможем с оформлением."],
    ["Можно жить в квартире во время ремонта?", "Да. Защищаем полы и проходы, ежедневно вывозим мусор, а если ванная единственная, планируем работы так, чтобы вы были без душа как можно меньше."],
    ["Какая гарантия?", "На работы даём письменную гарантию {g} года, плюс гарантия производителей на сантехнику и смесители."],
    ["Вы делаете и сантехнику, и электрику?", "Да. Меняем трубы, канализацию, точки освещения и вытяжку. У вас один ответственный за весь ремонт."],
  ],
};
const CLIENT_KEYS = ["f.sending", "f.ok", "e.name", "e.phone", "e.consent", "e.photo", "e.net", "e.max", "e.failed", "calc.msg", "calc.partial", "calc.full", "calc.premium", "calc.screen", "calc.vanity", "calc.floor", "calc.access", "proj.before", "proj.after", "viz.wait", "viz.done"];

// ======================= Заявки =======================
const STATUSES = ["new", "contacted", "visit", "quote", "won", "lost"];
const SOURCE_NAME = { hero: "быстрая форма", form: "форма заявки", calc: "калькулятор", viz: "визуализатор" };
function addLead(o, origin) {
  const lead = {
    id: newId(), created: Date.now(), status: "new", note: "",
    name: o.name, phone: o.phone, email: o.email || "", message: o.message || "", lang: o.lang, source: o.source,
    estimate: o.estimate || "", page: o.page || "", photos: o.photos || [], viz: "",
  };
  db.leads.unshift(lead);
  if (db.leads.length > 5000) db.leads.length = 5000;
  save();
  notify([
    `🛁 Новая заявка (${SOURCE_NAME[lead.source] || lead.source}, ${lead.lang.toUpperCase()})`,
    `${lead.name} · ${lead.phone}${lead.email ? " · " + lead.email : ""}`,
    lead.message ? `«${lead.message.slice(0, 600)}»` : "",
    lead.estimate ? `Оценка: ${lead.estimate}` : "",
    lead.photos.length ? `Фото: ${lead.photos.length}` : "",
    origin ? `${origin}/admin` : "",
  ].filter(Boolean).join("\n"));
  return lead;
}
function validateContact(b, E) {
  const name = clean(b.name, 80), phone = clean(b.phone, 30), email = clean(b.email, 120);
  if (name.length < 2) throw new UserError(E["e.name"]);
  if ((phone.match(/\d/g) || []).length < 9) throw new UserError(E["e.phone"]);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError(E["e.bad"]);
  if (!b.consent) throw new UserError(E["e.consent"]);
  return { name, phone, email };
}

// ======================= ИИ-визуализатор =======================
const VIZ_STYLES = {
  modern: "contemporary Mediterranean style: warm light grey microcement walls and floor, walk-in shower with a flush floor-level shower tray and a frameless glass panel, matte black rainfall shower and taps, floating oak vanity with a white basin, round mirror with LED backlight, recessed niche in the shower.",
  white: "minimalist all-white style: large-format white matte porcelain tiles, white floating vanity, wall-hung toilet with concealed cistern, frameless glass shower screen, brushed chrome fittings, hidden LED strips.",
  med: "bright Mediterranean style: white walls, blue-and-white patterned hydraulic floor tiles, handmade-look glazed wall tiles around the shower, light wood vanity, brass taps, arched mirror, a small green plant.",
  spa: "warm spa style: wood-effect porcelain tiles on the floor and one wall, natural stone-effect tiles in the shower, walk-in shower, teak vanity with a stone countertop basin, warm indirect lighting.",
  dark: "elegant dark style: anthracite large-format stone-effect tiles, black slate-effect shower tray, brushed gold taps and shower set, dark walnut vanity, backlit mirror, warm accent lighting.",
  marble: "classic marble style: white Calacatta-look porcelain on walls and floor, a large walk-in shower (or a freestanding bathtub if the room is big), polished nickel fittings, white vanity with a marble top.",
};
function vizPrompt(style) {
  return [
    "Renovate the bathroom in this photo into a newly finished, high-end but realistic bathroom.",
    "Keep exactly the same room: identical walls, room size and proportions, ceiling height, window and door positions, and the same camera position, angle and lens. Keep fixture positions plausible for the existing plumbing.",
    "Replace all finishes, fixtures and furniture with the new design below. Remove clutter, towels and personal items.",
    "Design: " + VIZ_STYLES[style],
    "Photorealistic interior photography, natural daylight with soft warm artificial light, straight verticals, clean and bright, realistic materials and reflections. No people, no text, no watermark, no logo.",
  ].join(" ");
}
db.viz ||= [];
const vizPolling = new Set();
async function advanceViz(job) {
  if (job.status !== "working" || vizPolling.has(job.id)) return;
  vizPolling.add(job.id);
  try {
    const r = await falPoll(job);
    if (r.state === "failed") { job.status = "failed"; job.error = r.error; }
    else if (r.state === "done") {
      const src = falImages(r.data)[0];
      if (!src) { job.status = "failed"; job.error = "модель не вернула картинку"; }
      else {
        const d = await fetchImg(src);
        job.after = writeImg("private", `${job.fileId}-after`, d.buf, d.type);
        job.status = "done";
        const lead = db.leads.find((l) => l.id === job.leadId);
        if (lead) lead.viz = job.after;
      }
    } else if (Date.now() - job.created > 10 * 60 * 1000) { job.status = "failed"; job.error = "слишком долго"; }
  } catch (e) { job.status = "failed"; job.error = e.message; }
  finally { vizPolling.delete(job.id); save(); }
}

// ======================= Проекты «до/после» =======================
db.projects ||= [];
const publicProjects = () => db.projects.filter((p) => p.published && p.before && p.after).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.created - a.created).slice(0, 12);
function projectFields(o, p) {
  p.city = clean(o.city, 60);
  p.area = clampNum(o.area, 0, 100, 0);
  p.days = Math.round(clampNum(o.days, 0, 120, 0));
  p.type = SERVICES.includes(o.type) ? o.type : "integral";
  p.caption = clean(o.caption, 80);
  if (o.published !== undefined) p.published = !!o.published;
  if (o.featured !== undefined) p.featured = !!o.featured;
  return p;
}

// ======================= Markdown =======================
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g" };
function slugify(s) {
  return String(s || "").toLowerCase().split("").map((c) => TR[c] ?? c).join("").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
}
const safeUrl = (u) => /^(https?:\/\/|\/)[^\s"'<>]*$/i.test(u);
function inline(text) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => (safeUrl(src) ? `<img src="${src}" alt="${alt}" loading="lazy">` : alt))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => (safeUrl(u) ? `<a href="${u}"${/^https?:/i.test(u) ? ' rel="noopener" target="_blank"' : ""}>${t}</a>` : t))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
function renderMarkdown(md, { linker } = {}) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const out = [], toc = [], ids = new Set(), para = [];
  const L = (h) => (linker ? linker(h) : h);
  const flushP = () => { if (para.length) { out.push(`<p>${L(inline(esc(para.join(" "))))}</p>`); para.length = 0; } };
  const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flushP(); i++; continue; }
    if ((m = line.match(/^(#{2,4})\s+(.+?)\s*#*$/))) {
      flushP();
      const lvl = m[1].length, txt = m[2].trim();
      let id = slugify(txt) || "section", n = 2;
      while (ids.has(id)) id = `${slugify(txt) || "section"}-${n++}`;
      ids.add(id);
      if (lvl === 2) toc.push({ id, text: txt });
      out.push(`<h${lvl} id="${id}">${inline(esc(txt))}</h${lvl}>`);
      i++; continue;
    }
    if (/^#\s+/.test(line)) { flushP(); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushP(); out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) {
      flushP();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote><p>${L(inline(esc(q.join(" "))))}</p></blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushP();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push(`<ul>${items.map((t) => `<li>${L(inline(esc(t)))}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushP();
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
      out.push(`<ol>${items.map((t) => `<li>${L(inline(esc(t)))}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushP();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i])); i++; }
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      }
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushP();
  return { html: out.join("\n"), toc };
}
function makeLinker(rules, { max = 6, selfUrl = "" } = {}) {
  const used = new Set();
  let count = 0;
  const compiled = [];
  for (const r of rules) {
    if (!r.url || r.url === selfUrl) continue;
    for (const a of String(r.anchors || "").split(/[,;\n]/).map((x) => x.trim()).filter((x) => x.length >= 3)) {
      compiled.push({ url: r.url, len: a.length, re: new RegExp(`(?<![\\p{L}\\p{N}])(${escRe(esc(a))})(?![\\p{L}\\p{N}])`, "iu") });
    }
  }
  compiled.sort((a, b) => b.len - a.len);
  const linker = (html) => {
    for (const r of compiled) {
      if (count >= max) break;
      if (used.has(r.url)) continue;
      const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/);
      for (let k = 0; k < parts.length; k += 2) {
        const m = parts[k].match(r.re);
        if (!m) continue;
        parts[k] = parts[k].slice(0, m.index) + `<a href="${esc(r.url)}" class="il">${m[1]}</a>` + parts[k].slice(m.index + m[1].length);
        used.add(r.url); count++;
        html = parts.join("");
        break;
      }
    }
    return html;
  };
  linker.links = () => [...used];
  return linker;
}
const stripMd = (md) => String(md || "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>|#-]/g, " ").replace(/\s+/g, " ").trim();
const wordCount = (md) => (stripMd(md).match(/[\p{L}\p{N}]+/gu) || []).length;

// ======================= Блог и SEO =======================
const COVER_MODEL = process.env.FAL_COVER_MODEL || "fal-ai/nano-banana-pro";
const LLM_MODELS = [
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro (лучшее качество)" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5 (лучший стиль текста)" },
  { id: "openai/gpt-4.1", name: "GPT-4.1" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (быстро и дёшево)" },
];
db.posts ||= [];
db.seoJobs ||= [];
const S = db.seo;
S.home ||= {};
for (const l of LANGS) S.home[l] ||= { title: "", description: "" };
S.verify ||= { google: "", bing: "" };
S.analytics ||= { ga4: "" };
S.links ||= [];
S.maxLinks ??= 6;
S.llm ||= LLM_MODELS[0].id;
S.indexnow ??= true;
S.indexnowKey ||= crypto.randomBytes(16).toString("hex");
S.plan ||= [];
S.ogImage ||= "";
S.autoCover ??= true;

function defaultHome(l) {
  const b = biz();
  return {
    es: { title: `Reforma de baños en ${b.city} | ${b.name}`, description: `Reformas integrales de baño en ${b.city}: cambio de bañera por plato de ducha, alicatado y fontanería. Presupuesto gratis y cerrado, obra limpia y con garantía.` },
    en: { title: `Bathroom Renovation in ${b.city} | ${b.name}`, description: `Full bathroom renovations in ${b.city}: bath-to-shower conversions, tiling and plumbing. Free fixed-price quote, clean work and a written guarantee.` },
    ru: { title: `Ремонт ванной в ${b.cityRu} под ключ | ${b.name}`, description: `Ремонт ванных комнат в ${b.cityRu} под ключ: замена ванны на душ, плитка, сантехника. Бесплатная смета с фиксированной ценой, аккуратная работа и гарантия.` },
  }[l];
}
const homeMeta = (l) => ({ title: S.home[l]?.title || defaultHome(l).title, description: S.home[l]?.description || defaultHome(l).description });
const postUrl = (p) => `${blogBase(p.lang)}/${p.slug}`;
const tagUrl = (l, tag) => `${blogBase(l)}/tag/${encodeURIComponent(slugify(tag) || tag)}`;
function originOf(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const o = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  if (!/localhost|127\.0\.0\.1/.test(o) && S.origin !== o) { S.origin = o; save(); }
  return o;
}
const knownOrigin = () => (process.env.PUBLIC_URL || S.origin || "").replace(/\/$/, "");
const published = (l) => db.posts.filter((p) => p.status === "published" && (!l || p.lang === l)).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
const findPost = (id) => db.posts.find((p) => p.id === id);
const findBySlug = (l, slug) => db.posts.find((p) => p.lang === l && p.slug === slug && p.status === "published");
const groupOf = (p) => p.tgroup || p.id;
const translations = (p, onlyPub = true) => db.posts.filter((x) => x.id !== p.id && x.lang !== p.lang && groupOf(x) === groupOf(p) && (!onlyPub || x.status === "published"));
function uniqueSlug(l, base, selfId) {
  let s = slugify(base) || "post", n = 2;
  const root = s;
  while (db.posts.some((p) => p.lang === l && p.slug === s && p.id !== selfId)) s = `${root}-${n++}`;
  return s;
}
function normalizePost(input, existing) {
  const l = normLang(input.lang);
  const p = existing || { id: newId(), created: Date.now(), views: 0, daily: {}, status: "draft" };
  p.lang = l;
  p.title = clean(input.title, 140);
  if (!p.title) throw new UserError("Укажите заголовок статьи.");
  p.keyword = clean(input.keyword, 80);
  p.description = clean(input.description, 300);
  p.anchors = clean(Array.isArray(input.anchors) ? input.anchors.join(", ") : input.anchors, 300);
  p.tags = (Array.isArray(input.tags) ? input.tags : String(input.tags || "").split(",")).map((t) => clean(t, 40)).filter(Boolean).slice(0, 6);
  p.body = String(input.body ?? p.body ?? "").slice(0, 120000);
  p.faq = (Array.isArray(input.faq) ? input.faq : []).map((f) => ({ q: clean(f.q, 240), a: String(f.a || "").trim().slice(0, 1500) })).filter((f) => f.q && f.a).slice(0, 10);
  p.coverAlt = clean(input.coverAlt, 200) || p.title;
  if (input.coverPrompt !== undefined) p.coverPrompt = clean(input.coverPrompt, 600);
  if (input.cover !== undefined && (input.cover === "" || /^\/img\/blog\//.test(input.cover))) p.cover = input.cover;
  p.slug = uniqueSlug(l, input.slug || p.slug || p.title, p.id);
  p.updated = Date.now();
  return p;
}
function linkTranslation(p, targetId) {
  if (targetId === undefined) return;
  const cur = translations(p, false);
  if (!targetId) { if (cur.length) p.tgroup = newId(); return; }
  if (cur.some((x) => x.id === targetId)) return;
  const t = findPost(targetId);
  if (!t || t.lang === p.lang) return;
  const g = groupOf(t);
  if (db.posts.some((x) => x.id !== p.id && x.lang === p.lang && groupOf(x) === g)) throw new UserError("У выбранной статьи уже есть перевод на этот язык.");
  t.tgroup = g;
  p.tgroup = g;
}
function savePost(input) {
  const existing = input.id ? findPost(input.id) : null;
  if (input.id && !existing) throw new UserError("Статья не найдена.", 404);
  const p = normalizePost(input, existing);
  if (!existing) db.posts.unshift(p);
  linkTranslation(p, input.translationId);
  save();
  return p;
}
function setPublished(id, on) {
  const p = findPost(id);
  if (!p) throw new UserError("Статья не найдена.", 404);
  if (on && wordCount(p.body) < 150) throw new UserError("В статье слишком мало текста для публикации.");
  p.status = on ? "published" : "draft";
  if (on && !p.publishedAt) p.publishedAt = Date.now();
  p.updated = Date.now();
  save();
  return p;
}
function deletePost(id) {
  const p = findPost(id);
  if (!p) return;
  if (p.cover && !db.posts.some((x) => x.id !== id && x.cover === p.cover)) rmImg(p.cover);
  db.posts = db.posts.filter((x) => x.id !== id);
  save();
}
function builtinRules(l) {
  const c = biz().city;
  return {
    es: [{ anchors: `reforma de baño en ${c}, reformas de baños en ${c}, reforma de baños en ${c}, reformar el baño en ${c}`, url: "/" }],
    en: [{ anchors: `bathroom renovation in ${c}, bathroom renovations in ${c}, bathroom remodel in ${c}`, url: "/en" }],
    ru: [{ anchors: `ремонт ванной в ${biz().cityRu}, ремонт ванных комнат в ${biz().cityRu}, ремонт ванной под ключ`, url: "/ru" }],
  }[l];
}
function linkRules(l) {
  const auto = published(l).filter((p) => p.keyword).map((p) => ({ anchors: [p.keyword, p.anchors].filter(Boolean).join(", "), url: postUrl(p), auto: true }));
  const manual = S.links.filter((x) => x.lang === l || x.lang === "all");
  return [...manual, ...auto, ...builtinRules(l)];
}
function renderPost(p) {
  const linker = makeLinker(linkRules(p.lang), { max: S.maxLinks, selfUrl: postUrl(p) });
  const r = renderMarkdown(p.body, { linker });
  return { ...r, links: linker.links() };
}
function related(p, n = 3) {
  const kw = new Set(String(p.keyword || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  return published(p.lang).filter((x) => x.id !== p.id)
    .map((x) => ({ x, s: x.tags.filter((t) => p.tags.includes(t)).length * 3 + String(x.keyword || "").toLowerCase().split(/\s+/).filter((w) => kw.has(w)).length }))
    .sort((a, b) => b.s - a.s || (b.x.publishedAt || 0) - (a.x.publishedAt || 0)).slice(0, n).map((r) => r.x);
}
function linkGraph() {
  const incoming = {}, outgoing = {};
  for (const p of published()) {
    const links = renderPost(p).links;
    outgoing[p.id] = links.length;
    for (const u of links) incoming[u] = (incoming[u] || 0) + 1;
  }
  return { incoming, outgoing };
}
function analyze(p) {
  const kw = String(p.keyword || "").toLowerCase().trim();
  const text = stripMd(p.body).toLowerCase();
  const words = wordCount(p.body);
  const firstPara = (String(p.body || "").split(/\n\s*\n/).map(stripMd).find((x) => x.length > 40) || "").toLowerCase();
  const h2 = (String(p.body || "").match(/^##\s+.+$/gm) || []).map((h) => h.toLowerCase());
  const kwStem = kw.split(/\s+/).filter(Boolean).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  const has = (s) => kw && kwStem.every((st) => s.includes(st));
  const kwCount = kw ? (text.match(new RegExp(kwStem.map(escRe).join("[\\p{L}]*\\s+"), "giu")) || []).length : 0;
  const density = words ? (kwCount * Math.max(1, kw.split(/\s+/).length)) / words * 100 : 0;
  const paras = String(p.body || "").split(/\n\s*\n/).map(stripMd).filter((x) => x.length > 0 && !/^#/.test(x));
  const avgPara = paras.length ? paras.reduce((s, x) => s + x.split(/\s+/).length, 0) / paras.length : 0;
  const rendered = renderPost(p);
  const tl = (p.title || "").length, dl = (p.description || "").length;
  const checks = [
    { w: 8, ok: !!kw, t: "Задан ключевой запрос", tip: "Укажите главный запрос, по которому статья должна находиться." },
    { w: 10, ok: tl >= 30 && tl <= 65, warn: tl > 0, t: `Длина заголовка ${tl} симв. (лучше 30–65)`, tip: "Короткий заголовок теряет слова, длинный обрезается в поиске." },
    { w: 10, ok: has((p.title || "").toLowerCase()), t: "Ключевой запрос в заголовке", tip: "Поставьте запрос ближе к началу заголовка." },
    { w: 10, ok: dl >= 110 && dl <= 165, warn: dl > 0, t: `Длина описания ${dl} симв. (лучше 110–165)`, tip: "Это текст под ссылкой в поиске: от него зависит, кликнут ли." },
    { w: 5, ok: has((p.description || "").toLowerCase()), t: "Ключевой запрос в описании", tip: "Поисковик выделяет совпадения жирным." },
    { w: 4, ok: (p.slug || "").length > 0 && (p.slug || "").length <= 60, t: "Короткий адрес страницы", tip: "До 60 символов, латиницей." },
    { w: 8, ok: has(firstPara), t: "Ключевой запрос в первом абзаце", tip: "Сразу покажите, о чём статья." },
    { w: 6, ok: density >= 0.4 && density <= 3, warn: kwCount > 0, t: `Частота запроса ${density.toFixed(1)}% (лучше 0,4–3%)`, tip: "Слишком часто — переспам, слишком редко — тема неясна." },
    { w: 12, ok: words >= 1000, warn: words >= 600, t: `Объём ${words} слов (лучше от 1000)`, tip: "Подробные статьи чаще занимают верхние позиции." },
    { w: 7, ok: h2.length >= 3, t: `Подзаголовков H2: ${h2.length} (нужно от 3)`, tip: "Структура помогает и читателю, и поисковику." },
    { w: 4, ok: h2.some(has), t: "Ключевой запрос в подзаголовке", tip: "Хотя бы в одном H2." },
    { w: 5, ok: !!p.cover, t: "Есть обложка", tip: "Картинка нужна для соцсетей и Google Discover." },
    { w: 6, ok: rendered.links.length >= 2, warn: rendered.links.length === 1, t: `Внутренних ссылок: ${rendered.links.length} (нужно от 2)`, tip: "Добавьте правила перелинковки или больше статей по теме." },
    { w: 3, ok: (p.faq || []).length >= 3, t: `Вопросов в FAQ: ${(p.faq || []).length} (нужно от 3)`, tip: "FAQ ловит длинные вопросы из поиска." },
    { w: 2, ok: avgPara > 0 && avgPara <= 90, t: "Абзацы не слишком длинные", tip: "В среднем до 90 слов на абзац." },
  ];
  const score = Math.round(checks.reduce((s, c) => s + (c.ok ? c.w : c.warn ? c.w * 0.5 : 0), 0));
  return {
    score, words, kwCount, density: +density.toFixed(2),
    checks: checks.map(({ w, ok, warn, t, tip }) => ({ ok, warn: !ok && !!warn, t, tip, w })),
    html: rendered.html, toc: rendered.toc, links: rendered.links, readMin: Math.max(1, Math.round(words / 200)),
  };
}
function audit() {
  const b = biz();
  const pub = published();
  const graph = linkGraph();
  const titles = {};
  for (const p of pub) titles[p.title.toLowerCase()] = (titles[p.title.toLowerCase()] || 0) + 1;
  const thin = pub.filter((p) => wordCount(p.body) < 600);
  const noDesc = pub.filter((p) => (p.description || "").length < 50);
  const noCover = pub.filter((p) => !p.cover);
  const orphans = pub.filter((p) => !graph.incoming[postUrl(p)]);
  const dupes = Object.values(titles).filter((n) => n > 1).length;
  const low = pub.filter((p) => analyze(p).score < 60);
  const towns = b.areas.filter((a) => a.toLowerCase() !== b.city.toLowerCase()).map((a) => a.toLowerCase());
  const local = pub.filter((p) => towns.some((t) => `${p.keyword} ${p.title}`.toLowerCase().includes(t)));
  const es = published("es").length;
  const C = (w, ok, t, tip, warn) => ({ w, ok, warn: !ok && !!warn, t, tip });
  const checks = [
    C(8, !!process.env.PUBLIC_URL, "Задан основной адрес сайта (PUBLIC_URL)", "Railway → Variables → PUBLIC_URL = https://ваш-домен. Без этого canonical и sitemap берут адрес из запроса.", !!knownOrigin()),
    C(6, PERSISTENT, "Данные сохраняются на Volume", "Подключите Volume /data, иначе заявки и статьи пропадут при обновлении."),
    C(10, !!(b.phone && b.street && b.postal), "Указаны телефон и адрес компании (NAP)", "Админка → Компания. Одинаковые название, адрес и телефон на сайте и в Google Business Profile — основа локального SEO."),
    C(10, !!b.gbp, "Добавлен профиль Google Business", "Создайте профиль на business.google.com и вставьте ссылку в Админка → Компания. По запросу «reforma baño Alicante» выше сайтов показывается карта с компаниями."),
    C(8, !!S.verify.google, "Подтверждён Google Search Console", "Без него не видно, по каким запросам вас находят, и нельзя ускорить индексацию."),
    C(3, !!S.verify.bing, "Подтверждён Bing Webmaster", "Bing также питает поиск в ChatGPT и Copilot."),
    C(5, !!S.analytics.ga4, "Подключена аналитика", "Google Analytics 4: видно, откуда приходят заявки."),
    C(5, LANGS.every((l) => { const h = homeMeta(l); return h.title.length <= 65 && h.description.length <= 170; }), "Заголовок и описание главной в норме", "Настройки → главная страница."),
    C(6, publicProjects().length >= 3, `Проектов «до/после» на сайте: ${publicProjects().length} (нужно от 3)`, "Реальные фото работ сильнее всего убеждают позвонить. Админка → Проекты.", publicProjects().length >= 1),
    C(15, es >= 20, `Статей на испанском: ${es} (цель — от 20, лучше 50+)`, "Основной местный поиск — на испанском. Трафик растёт от количества полезных страниц по разным запросам.", es >= 5),
    C(5, published("en").length >= 5, `Статей на английском: ${published("en").length} (нужно от 5)`, "В провинции Аликанте много англоязычных владельцев жилья."),
    C(3, published("ru").length >= 3, `Статей на русском: ${published("ru").length} (нужно от 3)`, "Русскоязычная аудитория — ниша с низкой конкуренцией."),
    C(8, local.length >= 3, `Статей под города и районы: ${local.length} (нужно от 3)`, "Статьи вида «reforma de baño en Elche» собирают локальные запросы. Попросите их в «Контент-плане».", local.length >= 1),
    C(10, thin.length === 0, `Слабые статьи (< 600 слов): ${thin.length}`, "Дополните или снимите с публикации: короткие страницы тянут сайт вниз.", thin.length <= 2),
    C(6, noDesc.length === 0, `Без мета-описания: ${noDesc.length}`, "Заполните описание у каждой статьи."),
    C(4, noCover.length === 0, `Без обложки: ${noCover.length}`, "Сгенерируйте или загрузите обложку."),
    C(8, orphans.length === 0, `Статьи-сироты без входящих ссылок: ${orphans.length}`, "Добавьте их ключевые слова в другие статьи или правила перелинковки.", orphans.length <= 2),
    C(4, dupes === 0, `Повторяющиеся заголовки: ${dupes}`, "У каждой страницы должен быть уникальный заголовок."),
    C(8, low.length === 0, `Статьи с SEO-оценкой ниже 60: ${low.length}`, "Откройте статью и пройдите по чек-листу справа.", low.length <= 2),
  ];
  const score = Math.round((checks.reduce((s, c) => s + (c.ok ? c.w : c.warn ? c.w * 0.5 : 0), 0) / checks.reduce((s, c) => s + c.w, 0)) * 100);
  return { score, checks: checks.map(({ w, ...c }) => c), orphans: orphans.map((p) => p.id) };
}
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|lighthouse|headless/i;
function countView(p, req) {
  if (BOT.test(req.headers["user-agent"] || "")) return;
  p.views = (p.views || 0) + 1;
  p.daily ||= {};
  const d = day();
  p.daily[d] = (p.daily[d] || 0) + 1;
  const keys = Object.keys(p.daily);
  if (keys.length > 120) for (const k of keys.sort().slice(0, keys.length - 120)) delete p.daily[k];
  save();
}
function viewsByDay(n = 30) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = day(Date.now() - i * 864e5); out.push({ day: d, views: db.posts.reduce((s, p) => s + (p.daily?.[d] || 0), 0) }); }
  return out;
}
async function indexNow(urls) {
  const origin = knownOrigin();
  if (!S.indexnow) return { skipped: "IndexNow выключен в настройках" };
  if (!origin || /localhost|127\.0\.0\.1/.test(origin)) return { skipped: "Неизвестен адрес сайта: задайте PUBLIC_URL" };
  const host = new URL(origin).host;
  const list = [...new Set(urls.map((u) => (u.startsWith("http") ? u : origin + u)))].slice(0, 10000);
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host, key: S.indexnowKey, keyLocation: `${origin}/${S.indexnowKey}.txt`, urlList: list }) });
    S.lastIndexNow = { at: Date.now(), status: r.status, count: list.length };
  } catch (e) { S.lastIndexNow = { at: Date.now(), status: 0, count: list.length, error: e.message }; }
  save();
  return S.lastIndexNow;
}
const allUrls = () => [...LANGS.map(homeUrl), ...LANGS.map(blogBase), ...published().map(postUrl)];
function uploadCover(id, dataUrl) {
  const p = findPost(id);
  if (!p) throw new UserError("Статья не найдена.", 404);
  const img = parseImg(dataUrl);
  p.cover = writeImg("blog", p.id, img.buf, img.type);
  save();
  return p;
}
function uploadOg(dataUrl) {
  const img = parseImg(dataUrl);
  S.ogImage = writeImg("blog", "og-default", img.buf, img.type);
  save();
}

// ---------- ИИ для блога ----------
function SYSTEM(l) {
  const b = biz();
  return [
    `You are a senior SEO editor and an experienced bathroom renovation contractor who has worked for many years in ${b.city} (Costa Blanca, Spain). You write for ${b.name}, a local company that renovates bathrooms in ${b.city} and nearby towns (${b.areas.join(", ")}).`,
    "Write genuinely helpful, expert and specific content that shows first-hand experience (E-E-A-T): real work sequence, materials, timelines, what affects the price, typical problems in local homes (hard water and limescale, humidity and poor ventilation in older flats, coastal climate, old pipes in older buildings, rules of the community of owners).",
    "No filler, no clichés, no invented statistics, studies, quotes, customers or reviews. Do not present exact prices, laws, permit rules or tax rates as facts; give ranges as guidance only and, when mentioning permits (obra menor, declaración responsable, licencia) or VAT, tell the reader to confirm with the town hall or the company.",
    `Write in ${LANG_NAME[l]} only, in a natural native style.`,
  ].join(" ");
}
function parseJSON(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (!a.length || b < Math.min(...a)) throw new Error("ИИ вернул ответ не в формате JSON");
  return JSON.parse(t.slice(Math.min(...a), b + 1));
}
async function submitLLM(prompt, system, maxTokens) {
  const url = "https://queue.fal.run/fal-ai/any-llm";
  let r = await falFetch(url, { method: "POST", body: JSON.stringify({ prompt, system_prompt: system, model: S.llm, max_tokens: maxTokens, temperature: 0.7 }) });
  if (r.status === 422) r = await falFetch(url, { method: "POST", body: JSON.stringify({ prompt, system_prompt: system, model: "google/gemini-2.5-flash" }) });
  return r;
}
async function submitImage(prompt) {
  const url = `https://queue.fal.run/${COVER_MODEL}`;
  let r = await falFetch(url, { method: "POST", body: JSON.stringify({ prompt, num_images: 1, output_format: "jpeg", aspect_ratio: "16:9", resolution: "1K" }) });
  if (r.status === 422) r = await falFetch(url, { method: "POST", body: JSON.stringify({ prompt, num_images: 1 }) });
  return r;
}
const JSON_SHAPE = '{"title":"SEO title, 45–60 characters, contains the focus keyword","description":"meta description, 130–155 characters, contains the focus keyword, ends with a soft call to action","slug":"short-latin-url-slug-3-to-6-words","tags":["2–4 short topic tags"],"anchors":["2–3 grammatical variants of the focus keyword for internal links"],"cover_prompt":"English prompt for a photorealistic interior photo of a renovated bathroom that illustrates the topic; no text, no logos, no people","body":"the article in Markdown","faq":[{"q":"question","a":"answer"}]}';
function articlePrompt({ keyword, title, intent, lang }) {
  const b = biz();
  return [
    "Write an in-depth blog article.",
    `Focus keyword: ${keyword}`,
    title ? `Working title: ${title}` : "",
    intent ? `Search intent: ${intent}` : "",
    "Requirements:",
    "- 1500–2200 words.",
    "- No H1. Start with a 2–3 sentence intro paragraph that contains the focus keyword naturally.",
    "- 5–8 sections with ## headings and ### subheadings where useful. Put the focus keyword (or a close variant) in at least one ## heading.",
    "- Use the focus keyword naturally 3–6 times in total, plus related terms. Never stuff keywords.",
    "- Be practical: step-by-step explanations, checklists, concrete examples (materials such as porcelain tiles, microcement, shower trays, screens, taps; layouts for small bathrooms; timelines; how to prepare the home; what changes the price), typical mistakes and how to avoid them.",
    `- Where relevant, add local context for ${b.city} and nearby towns. Mention ${b.name} naturally 1–2 times only where it genuinely helps (for example, the free visit and fixed quote). It must not read like an advertisement.`,
    "- Do not add any links; internal links are added automatically.",
    "- Markdown only: paragraphs, ## and ### headings, bullet and numbered lists, **bold**, optionally one table. Keep paragraphs short (2–4 sentences).",
    "- Also write 4–5 FAQ questions people really search for, with concise 2–4 sentence answers that do not repeat the article verbatim.",
    `- Language: ${LANG_NAME[lang]}.`,
    "Return ONLY valid JSON without code fences, with this exact shape:",
    JSON_SHAPE,
  ].filter(Boolean).join("\n");
}
function planPrompt({ seed, lang, count, existing }) {
  const b = biz();
  return [
    `Create a content plan of ${count} blog articles for ${b.name}, a bathroom renovation company in ${b.city}, Spain.`,
    `Niche and topics: ${seed}`,
    `Language of keywords and titles: ${LANG_NAME[lang]}.`,
    `Include local long-tail keywords with towns and neighbourhoods: ${b.areas.join(", ")}, and the neighbourhoods and urbanisations of ${b.city} and nearby coastal areas. About a third of the ideas should be local.`,
    "Mix search intents: local commercial (renovation + town, price, company), informational how-to, comparisons (shower tray vs bathtub, microcement vs tiles), cost questions and ideas for small bathrooms.",
    "Prefer realistic low-competition long-tail keywords that a new site can rank for. Group topics into clusters so articles can link to each other.",
    existing.length ? `Do not duplicate these existing topics: ${existing.slice(0, 80).join("; ")}` : "",
    'Return ONLY a valid JSON array without code fences: [{"keyword":"...","title":"...","intent":"informational|commercial|transactional","cluster":"..."}]',
  ].filter(Boolean).join("\n");
}
function translatePrompt(p, lang) {
  return [
    `Translate and localise this blog article into ${LANG_NAME[lang]} for readers in ${biz().city}, Spain.`,
    "Adapt the focus keyword to how people actually search in that language (for example English-speaking expats search 'bathroom renovation Alicante'). Keep the Markdown structure, headings, lists and tables. Keep it natural, not a literal translation. Do not add links.",
    "Source article as JSON:",
    JSON.stringify({ keyword: p.keyword, title: p.title, description: p.description, tags: p.tags, body: p.body, faq: p.faq }),
    "Return ONLY valid JSON without code fences, with this exact shape:",
    JSON_SHAPE.replace('{"title"', '{"keyword":"focus keyword in the target language","title"'),
  ].join("\n");
}
async function startJob(type, input, prompt, maxTokens, sysLang) {
  const r = await submitLLM(prompt, SYSTEM(sysLang), maxTokens);
  if (!r.ok || !r.data.request_id) throw new UserError("ИИ не принял задачу: " + falError(r.status, r.data).admin, 502);
  const job = { id: newId(), type, status: "working", input, statusUrl: r.data.status_url, responseUrl: r.data.response_url, created: Date.now() };
  db.seoJobs.unshift(job);
  save();
  return job;
}
async function startArticle({ keyword, title, intent, lang, planId }) {
  keyword = clean(keyword, 100);
  if (keyword.length < 3) throw new UserError("Укажите ключевое слово или тему статьи.");
  lang = normLang(lang);
  const job = await startJob("article", { keyword, title, intent, lang, planId }, articlePrompt({ keyword, title: clean(title, 140), intent: clean(intent, 40), lang }), 12000, lang);
  if (planId) { const it = S.plan.find((x) => x.id === planId); if (it) { it.status = "writing"; it.jobId = job.id; } save(); }
  return job;
}
async function startPlan({ seed, lang, count }) {
  lang = normLang(lang);
  count = Math.max(5, Math.min(40, parseInt(count, 10) || 20));
  const SEED = {
    es: "reforma de baño en Alicante, precio de reformar un baño, cambiar bañera por plato de ducha, baño pequeño, microcemento, alicatado, baño adaptado para mayores, reformas en Elche, San Vicente del Raspeig, El Campello y Sant Joan d'Alacant",
    en: "bathroom renovation Alicante, bath to shower conversion, bathroom remodel cost in Spain, small bathroom ideas, renovating a holiday home on the Costa Blanca, hiring builders in Spain",
    ru: `ремонт ванной в ${biz().cityRu}, замена ванны на душ, ремонт квартиры в Испании, микроцемент, плитка, сколько стоит ремонт ванной в Испании, как найти мастеров в ${biz().cityRu}`,
  };
  seed = clean(seed, 600) || SEED[lang];
  const existing = [...db.posts.map((p) => p.title), ...S.plan.map((x) => x.title)];
  return startJob("plan", { seed, lang, count }, planPrompt({ seed, lang, count, existing }), 6000, lang);
}
async function startTranslate({ id, lang }) {
  const p = findPost(id);
  if (!p) throw new UserError("Статья не найдена.", 404);
  lang = normLang(lang);
  if (lang === p.lang) throw new UserError("Выберите другой язык.");
  if (translations(p, false).some((x) => x.lang === lang)) throw new UserError("Перевод на этот язык уже есть.");
  if (wordCount(p.body) < 150) throw new UserError("В статье слишком мало текста для перевода.");
  return startJob("translate", { postId: id, lang, keyword: p.keyword }, translatePrompt(p, lang), 12000, lang);
}
async function startCover(postId) {
  const p = findPost(postId);
  if (!p) throw new UserError("Статья не найдена.", 404);
  const prompt = [
    p.coverPrompt || `Interior photograph of a beautifully renovated bathroom illustrating the topic: ${p.title}`,
    "Photorealistic high-end interior photography of a Mediterranean home in Spain, natural daylight, realistic materials, clean composition.",
    "No text, no letters, no watermark, no logo, no people.",
  ].join(" ");
  const r = await submitImage(prompt);
  if (!r.ok || !r.data.request_id) throw new UserError("Не удалось запустить обложку: " + falError(r.status, r.data).admin, 502);
  const job = { id: newId(), type: "cover", status: "working", input: { postId }, statusUrl: r.data.status_url, responseUrl: r.data.response_url, created: Date.now() };
  db.seoJobs.unshift(job);
  p.coverJob = job.id;
  save();
  return job;
}
async function improveMeta({ title, description, keyword, body, lang }) {
  lang = normLang(lang);
  const prompt = [
    "Rewrite the SEO title and meta description for this article to maximise click-through rate from Google while staying accurate.",
    `Focus keyword: ${clean(keyword, 100)}`, `Current title: ${clean(title, 140)}`, `Current description: ${clean(description, 300)}`,
    `Article start: ${stripMd(body).slice(0, 1500)}`,
    "Title: 45–60 characters, focus keyword near the beginning, specific benefit or number if it fits, no clickbait, no ALL CAPS.",
    "Description: 130–155 characters, includes the focus keyword, promises a concrete outcome, ends with a soft call to action.",
    `Language: ${LANG_NAME[lang]}.`, 'Return ONLY JSON: {"title":"...","description":"..."}',
  ].join("\n");
  const r = await falFetch("https://fal.run/fal-ai/any-llm", { method: "POST", body: JSON.stringify({ prompt, system_prompt: SYSTEM(lang), model: S.llm, temperature: 0.6 }) });
  if (!r.ok) throw new UserError("ИИ не ответил: " + falError(r.status, r.data).admin, 502);
  const j = parseJSON(r.data.output);
  return { title: clean(j.title, 140), description: clean(j.description, 300) };
}
let jobsRunning = null;
const pollJobs = () => { if (!jobsRunning) jobsRunning = stepJobs().finally(() => { jobsRunning = null; }); return jobsRunning; };
async function stepJobs() {
  for (const job of db.seoJobs) {
    if (job.status !== "working") continue;
    try {
      const r = await falPoll(job);
      if (r.state === "failed") { failJob(job, r.error); continue; }
      if (r.state === "working") { if (Date.now() - job.created > 15 * 60 * 1000) failJob(job, "слишком долго"); continue; }
      const out = r.data;
      if (job.type === "cover") {
        const src = falImages(out)[0];
        const p = findPost(job.input.postId);
        if (!src) { failJob(job, "модель не вернула картинку"); continue; }
        if (p) { const d = await fetchImg(src); p.cover = writeImg("blog", p.id, d.buf, d.type); p.coverAlt ||= p.title; delete p.coverJob; }
        job.status = "done";
        continue;
      }
      if (out.error) { failJob(job, out.error); continue; }
      const data = parseJSON(out.output);
      if (job.type === "plan") {
        const items = (Array.isArray(data) ? data : data.items || []).map((x) => ({
          id: newId(), lang: job.input.lang, keyword: clean(x.keyword, 100), title: clean(x.title, 140), intent: clean(x.intent, 30), cluster: clean(x.cluster, 60), status: "idea", created: Date.now(),
        })).filter((x) => x.keyword && x.title);
        S.plan.unshift(...items);
        job.result = { added: items.length };
        job.status = "done";
      } else if (job.type === "article") {
        const p = savePost({ lang: job.input.lang, title: data.title || job.input.title || job.input.keyword, keyword: job.input.keyword, description: data.description, slug: data.slug, tags: data.tags, anchors: data.anchors, body: data.body, faq: data.faq, coverPrompt: data.cover_prompt });
        p.ai = true;
        job.result = { postId: p.id };
        job.status = "done";
        if (job.input.planId) { const it = S.plan.find((x) => x.id === job.input.planId); if (it) { it.status = "done"; it.postId = p.id; } }
        if (S.autoCover) await startCover(p.id).catch(() => {});
      } else if (job.type === "translate") {
        const src = findPost(job.input.postId);
        const p = savePost({ lang: job.input.lang, title: data.title, keyword: data.keyword || "", description: data.description, slug: data.slug, tags: data.tags, anchors: data.anchors, body: data.body, faq: data.faq, coverPrompt: data.cover_prompt, translationId: src ? src.id : undefined });
        p.ai = true;
        if (src?.cover) { p.cover = src.cover; p.coverAlt = clean(data.title, 200) || p.title; }
        job.result = { postId: p.id };
        job.status = "done";
      }
    } catch (e) { failJob(job, e.message); }
  }
  if (db.seoJobs.length > 300) db.seoJobs.length = 300;
  save();
}
function failJob(job, err) {
  job.status = "failed";
  job.error = String(err || "ошибка").slice(0, 300);
  if (job.type === "article" && job.input.planId) { const it = S.plan.find((x) => x.id === job.input.planId); if (it) it.status = "idea"; }
  if (job.type === "cover") { const p = findPost(job.input.postId); if (p) delete p.coverJob; }
}
const jobsBusy = () => db.seoJobs.some((j) => j.status === "working");
const code = (v) => clean(v, 120).replace(/[^\w\-.:]/g, "");
function saveSeoSettings(b) {
  for (const l of LANGS) S.home[l] = { title: clean(b.home?.[l]?.title, 120), description: clean(b.home?.[l]?.description, 300) };
  S.verify = { google: code(b.verify?.google), bing: code(b.verify?.bing) };
  const ga = clean(b.analytics?.ga4, 30).toUpperCase();
  if (ga && !/^G-[A-Z0-9]{4,}$/.test(ga)) throw new UserError("ID Google Analytics выглядит так: G-XXXXXXXXXX.");
  S.analytics = { ga4: ga };
  if (LLM_MODELS.some((m) => m.id === b.llm)) S.llm = b.llm;
  S.indexnow = b.indexnow !== false;
  S.autoCover = b.autoCover !== false;
  save();
}
function saveLinks(b) {
  S.links = (Array.isArray(b.links) ? b.links : []).map((l) => ({ anchors: clean(l.anchors, 300), url: clean(l.url, 300), lang: [...LANGS, "all"].includes(l.lang) ? l.lang : "es" }))
    .filter((l) => l.anchors && /^(\/|https?:\/\/)/.test(l.url)).slice(0, 300);
  S.maxLinks = Math.max(1, Math.min(20, parseInt(b.maxLinks, 10) || 6));
  save();
}
const postSummary = (p) => {
  const a = analyze(p);
  return {
    id: p.id, lang: p.lang, title: p.title, slug: p.slug, keyword: p.keyword, status: p.status, ai: !!p.ai, cover: p.cover || "", coverBusy: !!p.coverJob,
    views: p.views || 0, words: a.words, score: a.score, created: p.created, updated: p.updated, publishedAt: p.publishedAt || 0, url: postUrl(p),
    translations: translations(p, false).map((x) => ({ id: x.id, lang: x.lang, title: x.title })),
  };
};

// ======================= HTML-страницы (блог, политика) =======================
const BT = {
  es: { blog: "Blog", blogTitle: "Blog de reformas de baños", blogLead: "Consejos prácticos para reformar tu baño en {city}: materiales, plazos, precios orientativos y errores que conviene evitar.", home: "Inicio", create: "Presupuesto gratis", read: "min de lectura", toc: "Contenido", faq: "Preguntas frecuentes", related: "Sigue leyendo", tag: "Tema", ctaT: "¿Vas a reformar tu baño en {city}?", ctaP: "Visita y presupuesto gratis, precio cerrado por escrito y obra con garantía.", ctaB: "Pedir presupuesto", empty: "Pronto publicaremos artículos.", prev: "← Más recientes", next: "Anteriores →", page: "Página", nf: "Página no encontrada", nfP: "Puede que se haya eliminado o que la dirección tenga un error.", updated: "Actualizado", privacy: "Política de privacidad" },
  en: { blog: "Blog", blogTitle: "Bathroom renovation blog", blogLead: "Practical advice for renovating your bathroom in {city}: materials, timelines, guide prices and mistakes to avoid.", home: "Home", create: "Free quote", read: "min read", toc: "Contents", faq: "FAQ", related: "Read next", tag: "Topic", ctaT: "Renovating your bathroom in {city}?", ctaP: "Free visit and quote, fixed price in writing and a guarantee on the works.", ctaB: "Get a quote", empty: "Articles are coming soon.", prev: "← Newer", next: "Older →", page: "Page", nf: "Page not found", nfP: "It may have been removed or the address is mistyped.", updated: "Updated", privacy: "Privacy policy" },
  ru: { blog: "Блог", blogTitle: "Блог о ремонте ванных комнат", blogLead: "Практические советы по ремонту ванной в {cityRu}: материалы, сроки, ориентировочные цены и частые ошибки.", home: "Главная", create: "Бесплатная смета", read: "мин чтения", toc: "Содержание", faq: "Частые вопросы", related: "Читайте также", tag: "Тема", ctaT: "Планируете ремонт ванной в {cityRu}?", ctaP: "Бесплатный замер и смета, фиксированная цена в договоре и гарантия на работы.", ctaB: "Получить смету", empty: "Статьи скоро появятся.", prev: "← Новее", next: "Старше →", page: "Страница", nf: "Страница не найдена", nfP: "Возможно, её удалили или адрес набран с ошибкой.", updated: "Обновлено", privacy: "Политика конфиденциальности" },
};
const bt = (l, k) => BT[l][k].replace(/\{city\}/g, biz().city).replace(/\{cityRu\}/g, biz().cityRu);
const fmtDate = (ts, l) => new Date(ts).toLocaleDateString(LOCALE[l], { day: "numeric", month: "long", year: "numeric" });
const iso = (ts) => new Date(ts || Date.now()).toISOString();
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const ogAbs = (origin, img) => (img ? (img.startsWith("http") ? img : origin + img) : "");
function headExtras(l) {
  const out = [];
  if (S.verify.google) out.push(`<meta name="google-site-verification" content="${esc(S.verify.google)}">`);
  if (S.verify.bing) out.push(`<meta name="msvalidate.01" content="${esc(S.verify.bing)}">`);
  if (S.analytics.ga4) {
    const t = HOME_T[l];
    const banner = `<span>${esc(t["cookie.t"])} <a href="${privacyUrl(l)}">${esc(t["foot.privacy"])}</a></span><button type="button" data-v="0">${esc(t["cookie.no"])}</button><button type="button" data-v="1" class="ok">${esc(t["cookie.yes"])}</button>`;
    out.push(`<script>(function(){var ID=${JSON.stringify(S.analytics.ga4)};function load(){if(window.__ga)return;window.__ga=1;var s=document.createElement("script");s.async=1;s.src="https://www.googletagmanager.com/gtag/js?id="+ID;document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag("js",new Date());gtag("config",ID,{anonymize_ip:true});}var c=null;try{c=localStorage.getItem("cookie_ok")}catch(e){}if(c==="1")load();else if(c!=="0")document.addEventListener("DOMContentLoaded",function(){var b=document.createElement("div");b.className="cookie";b.innerHTML=${JSON.stringify(banner).replace(/</g, "\\u003c")};document.body.appendChild(b);b.onclick=function(e){var v=e.target.getAttribute&&e.target.getAttribute("data-v");if(!v)return;try{localStorage.setItem("cookie_ok",v)}catch(x){}b.remove();if(v==="1")load();};});})();</script>`);
  }
  return out.join("\n");
}
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">`;
const ICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2314303f'/%3E%3Cpath d='M7 15h18v3a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6z' fill='%23e9e3d8'/%3E%3Ccircle cx='22' cy='9' r='3' fill='%23c4612f'/%3E%3C/svg%3E">`;
function pageHead({ lang, title, description, canonical, origin, image, type = "website", alternates = [], robots = "index,follow", jsonld = [], extra = "" }) {
  const img = ogAbs(origin, image || S.ogImage);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots},max-image-preview:large">
${canonical ? `<link rel="canonical" href="${esc(origin + canonical)}">` : ""}
${alternates.map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${esc(origin + a.url)}">`).join("\n")}
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${esc(BRAND())}"><meta property="og:locale" content="${OG_LOCALE[lang]}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(origin + canonical)}">` : ""}
${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:image" content="${esc(img)}">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<link rel="alternate" type="application/rss+xml" title="${esc(BRAND())} — ${BT[lang].blog}" href="${blogBase(lang)}/rss.xml">
${ICON}
${FONTS}
${jsonld.map(ld).join("\n")}
${headExtras(lang)}
${extra}
<style>${CSS}</style>
</head>`;
}
const CSS = `
:root{--paper:#f5f2ec;--card:#fff;--ink:#14303f;--muted:#5d6b73;--line:#e0d9cd;--accent:#c4612f;--accent-ink:#fff;--sea:#1d6a85;--soft:#ece6db;--link:#1d6a85;
--f-display:"Fraunces",Georgia,serif;--f-body:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;--f-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#0f1a20;--card:#16242c;--ink:#ebe6dc;--muted:#9eabb2;--line:#26363f;--accent:#e2804e;--accent-ink:#0f1a20;--sea:#6fb6d0;--soft:#1c2c35;--link:#8fcbe0;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--paper);color:var(--ink);font:17px/1.65 var(--f-body);-webkit-font-smoothing:antialiased}
a{color:var(--link)}img{max-width:100%;height:auto}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{max-width:1120px;margin:0 auto;padding-inline:20px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-block:16px;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink)}
.logo i{width:30px;height:30px;border-radius:9px;background:var(--ink);position:relative;flex:none}
.logo i::after{content:"";position:absolute;width:9px;height:9px;border-radius:50%;background:var(--accent);right:6px;top:6px}
.logo b{font:600 19px/1.1 var(--f-display)}
.nav{display:flex;gap:14px;align-items:center;font-size:15px;flex-wrap:wrap}.nav a{color:var(--muted);text-decoration:none}.nav a:hover{color:var(--ink)}
.nav a.btn{color:var(--accent-ink)}.langs{display:flex;gap:4px}.langs a{font:500 12px var(--f-mono);border:1px solid var(--line);border-radius:999px;padding:3px 8px}.langs a[aria-current]{background:var(--ink);color:var(--card);border-color:var(--ink)}
.btn{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:9px 18px;font-weight:700;font-size:15px;text-decoration:none;background:var(--accent);color:var(--accent-ink);border:0}
.crumbs{font:13px var(--f-mono);color:var(--muted);margin:8px 0 18px;display:flex;flex-wrap:wrap;gap:6px}.crumbs a{color:var(--muted)}
h1{font:400 clamp(32px,5vw,50px)/1.1 var(--f-display);margin:0 0 14px;letter-spacing:-.01em;text-wrap:balance}
.lead{color:var(--muted);font-size:18px;max-width:62ch;margin:0 0 28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:grid;grid-template-rows:auto 1fr;text-decoration:none;color:var(--ink)}
.card:hover{border-color:var(--ink)}.card .ph{aspect-ratio:16/9;background:linear-gradient(135deg,var(--soft),var(--line))}.card .ph img{width:100%;height:100%;object-fit:cover;display:block}
.card .tx{padding:16px 18px 18px;display:grid;gap:8px;align-content:start}.card h2,.card h3{font:600 19px/1.3 var(--f-body);margin:0;text-wrap:balance}.card p{margin:0;color:var(--muted);font-size:15px;line-height:1.5}
.meta{font:12.5px var(--f-mono);color:var(--muted);display:flex;gap:10px;flex-wrap:wrap}
.tags{display:flex;gap:6px;flex-wrap:wrap}.tags a{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:3px 10px;text-decoration:none;color:var(--muted);background:var(--card)}
.art{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:48px;align-items:start}@media(max-width:960px){.art{grid-template-columns:minmax(0,1fr)}.side{display:none}}
.cover{border-radius:16px;overflow:hidden;margin:18px 0 26px;aspect-ratio:16/9;background:var(--soft)}.cover img{width:100%;height:100%;object-fit:cover;display:block}
.prose{max-width:70ch;font-size:18px;line-height:1.75}.prose h2{font:400 30px/1.2 var(--f-display);margin:44px 0 12px;scroll-margin-top:20px}
.prose h3{font:700 21px/1.3 var(--f-body);margin:30px 0 8px}.prose h4{font:700 18px/1.3 var(--f-body);margin:24px 0 6px}
.prose p{margin:0 0 18px}.prose ul,.prose ol{padding-left:24px;margin:0 0 18px}.prose li{margin:6px 0}
.prose blockquote{margin:22px 0;padding:6px 20px;border-left:3px solid var(--accent);color:var(--muted)}
.prose a.il{text-decoration-color:var(--accent);text-decoration-thickness:2px;text-underline-offset:3px}
.prose code{font:15px var(--f-mono);background:var(--soft);padding:1px 6px;border-radius:4px}.prose hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.tbl{overflow-x:auto;margin:0 0 20px}.prose table{border-collapse:collapse;width:100%;font-size:16px}.prose th,.prose td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}.prose th{font:600 13px var(--f-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.side{position:sticky;top:20px;display:grid;gap:16px}.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.box h2{font:600 12px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.box ol{margin:0;padding-left:18px;font-size:14.5px;line-height:1.5}.box li{margin:6px 0}.box a{color:var(--ink);text-decoration:none}.box a:hover{text-decoration:underline}
.cta{background:var(--ink);color:var(--paper);border-radius:18px;padding:28px;display:grid;gap:10px;margin:36px 0}
.cta b{font:400 26px/1.2 var(--f-display)}.cta p{margin:0;opacity:.85}.cta .row{display:flex;gap:10px;flex-wrap:wrap}.cta .btn.ghost{background:transparent;color:var(--paper);border:1.5px solid currentColor}
.side .cta{margin:0;padding:20px}.side .cta b{font-size:20px}
.faq{max-width:70ch}.faq details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:0 0 10px}.faq summary{cursor:pointer;font-weight:700}.faq details p{margin:10px 0 0;color:var(--muted)}
.sec{margin-top:56px}.sec>h2{font:400 30px/1.2 var(--f-display);margin:0 0 18px}
.pager{display:flex;justify-content:space-between;gap:12px;margin:32px 0;font-weight:700}
footer{border-top:1px solid var(--line);margin-top:64px;padding-block:28px 40px;color:var(--muted);font-size:14px;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}footer a{color:var(--muted)}
.cookie{position:fixed;left:12px;right:12px;bottom:12px;z-index:90;max-width:640px;margin:0 auto;background:var(--ink);color:var(--paper);border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px;box-shadow:0 20px 50px -20px rgba(0,0,0,.5)}
.cookie span{flex:1 1 240px}.cookie a{color:inherit}.cookie button{border:1.5px solid currentColor;background:none;color:inherit;border-radius:999px;padding:6px 14px;font:inherit;font-weight:700;cursor:pointer}.cookie button.ok{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}`;
function langLinks(cur, urls) {
  return `<span class="langs">${LANGS.filter((l) => urls[l]).map((l) => `<a href="${urls[l]}" hreflang="${l}"${l === cur ? ' aria-current="true"' : ""}>${l.toUpperCase()}</a>`).join("")}</span>`;
}
function header(l, urls = {}) {
  const b = biz();
  return `<body><header class="wrap bar"><a class="logo" href="${homeUrl(l)}"><i aria-hidden="true"></i><b>${esc(b.name)}</b></a>
<nav class="nav"><a href="${blogBase(l)}">${BT[l].blog}</a>${b.phone ? `<a href="${phoneHref(b.phone)}">${esc(b.phone)}</a>` : ""}${langLinks(l, urls)}<a class="btn" href="${homeUrl(l)}#contact">${BT[l].create}</a></nav></header>`;
}
function footer(l) {
  const b = biz();
  const nap = [b.name, [b.street, b.postal, b.city].filter(Boolean).join(", "), b.phone].filter(Boolean).map(esc).join(" · ");
  return `<footer class="wrap"><span>© ${new Date().getFullYear()} ${nap}</span><span><a href="${homeUrl(l)}">${BT[l].home}</a> · <a href="${blogBase(l)}">${BT[l].blog}</a> · <a href="${privacyUrl(l)}">${BT[l].privacy}</a> · <a href="/sitemap.xml">Sitemap</a></span></footer></body></html>`;
}
const ctaBox = (l) => {
  const b = biz();
  return `<div class="cta"><b>${esc(bt(l, "ctaT"))}</b><p>${esc(bt(l, "ctaP"))}</p><div class="row"><a class="btn" href="${homeUrl(l)}#contact">${BT[l].ctaB}</a>${b.phone ? `<a class="btn ghost" href="${phoneHref(b.phone)}">${esc(b.phone)}</a>` : ""}</div></div>`;
};
const card = (p, l, h = "h2") => `<a class="card" href="${postUrl(p)}"><div class="ph">${p.cover ? `<img src="${esc(p.cover)}" alt="${esc(p.coverAlt || p.title)}" loading="lazy" width="640" height="360">` : ""}</div><div class="tx"><div class="meta"><span>${fmtDate(p.publishedAt, l)}</span><span>${Math.max(1, Math.round(wordCount(p.body) / 200))} ${BT[l].read}</span></div><${h}>${esc(p.title)}</${h}><p>${esc(p.description)}</p></div></a>`;
const bizRef = (origin) => ({ "@id": origin + "/#business" });
const blogUrls = () => Object.fromEntries(LANGS.map((l) => [l, blogBase(l)]));
function blogList(req, l, { page = 1, tag = "" } = {}) {
  const origin = originOf(req), t = BT[l], per = 12;
  let posts = published(l), tagName = "";
  if (tag) {
    posts = posts.filter((p) => p.tags.some((x) => (slugify(x) || x) === tag));
    tagName = posts[0]?.tags.find((x) => (slugify(x) || x) === tag) || "";
    if (!posts.length) return null;
  }
  const pages = Math.max(1, Math.ceil(posts.length / per));
  if (page > pages) return null;
  const slice = posts.slice((page - 1) * per, page * per);
  const base = tag ? tagUrl(l, tagName) : blogBase(l);
  const canonical = page > 1 ? `${base}?page=${page}` : base;
  const title = tag ? `${tagName} — ${t.blog} ${BRAND()}` : `${t.blogTitle} — ${BRAND()}${page > 1 ? ` · ${t.page} ${page}` : ""}`;
  const desc = tag ? `${t.tag}: ${tagName}. ${bt(l, "blogLead")}` : bt(l, "blogLead");
  const tags = [...new Set(published(l).flatMap((p) => p.tags))].slice(0, 30);
  return pageHead({
    lang: l, title, description: desc, canonical, origin,
    alternates: tag ? [] : [...LANGS.map((x) => ({ lang: x, url: blogBase(x) })), { lang: "x-default", url: "/blog" }],
    robots: tag && posts.length < 2 ? "noindex,follow" : "index,follow",
    jsonld: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: title, url: origin + canonical, inLanguage: l, isPartOf: { "@type": "WebSite", name: BRAND(), url: origin + "/" },
      breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: t.home, item: origin + homeUrl(l) }, { "@type": "ListItem", position: 2, name: t.blog, item: origin + blogBase(l) }, ...(tag ? [{ "@type": "ListItem", position: 3, name: tagName, item: origin + base }] : [])] } }],
  }) + header(l, tag ? {} : blogUrls()) + `<main class="wrap">
<nav class="crumbs" aria-label="breadcrumbs"><a href="${homeUrl(l)}">${t.home}</a><span>›</span>${tag ? `<a href="${blogBase(l)}">${t.blog}</a><span>›</span><span>${esc(tagName)}</span>` : `<span>${t.blog}</span>`}</nav>
<h1>${tag ? esc(tagName) : t.blogTitle}</h1><p class="lead">${esc(desc)}</p>
${tags.length && !tag ? `<div class="tags" style="margin-bottom:24px">${tags.map((x) => `<a href="${tagUrl(l, x)}">${esc(x)}</a>`).join("")}</div>` : ""}
${slice.length ? `<div class="grid">${slice.map((p) => card(p, l)).join("")}</div>` : `<p>${t.empty}</p>`}
${pages > 1 ? `<nav class="pager">${page > 1 ? `<a href="${page === 2 ? base : `${base}?page=${page - 1}`}" rel="prev">${t.prev}</a>` : "<span></span>"}${page < pages ? `<a href="${base}?page=${page + 1}" rel="next">${t.next}</a>` : "<span></span>"}</nav>` : ""}
${ctaBox(l)}
</main>` + footer(l);
}
function article(req, p) {
  const origin = originOf(req), l = p.lang, t = BT[l];
  const a = analyze(p);
  const trs = translations(p);
  const rel = related(p);
  const url = postUrl(p);
  const group = [p, ...trs];
  const alternates = trs.length ? [...group.map((x) => ({ lang: x.lang, url: postUrl(x) })), { lang: "x-default", url: postUrl(group.find((x) => x.lang === "es") || p) }] : [];
  const urls = Object.fromEntries(group.map((x) => [x.lang, postUrl(x)]));
  const crumbs = [{ n: t.home, u: homeUrl(l) }, { n: t.blog, u: blogBase(l) }, ...(p.tags[0] ? [{ n: p.tags[0], u: tagUrl(l, p.tags[0]) }] : []), { n: p.title, u: url }];
  const jsonld = [
    { "@context": "https://schema.org", "@type": "BlogPosting", "@id": origin + url + "#article", mainEntityOfPage: origin + url, headline: p.title.slice(0, 110), description: p.description,
      image: p.cover ? [ogAbs(origin, p.cover)] : undefined, datePublished: iso(p.publishedAt), dateModified: iso(p.updated || p.publishedAt), inLanguage: l, wordCount: a.words,
      keywords: [p.keyword, ...p.tags].filter(Boolean).join(", "), author: { "@type": "Organization", name: BRAND(), url: origin + "/" }, publisher: bizRef(origin) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.n, item: origin + c.u })) },
    ...(p.faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
  ];
  const extra = `<meta property="article:published_time" content="${iso(p.publishedAt)}"><meta property="article:modified_time" content="${iso(p.updated)}">${p.tags.map((x) => `<meta property="article:tag" content="${esc(x)}">`).join("")}`;
  let body = a.html;
  const h2s = [...body.matchAll(/<h2 /g)];
  if (h2s.length >= 4) body = body.slice(0, h2s[3].index) + ctaBox(l) + body.slice(h2s[3].index);
  return pageHead({ lang: l, title: `${p.title} — ${BRAND()}`, description: p.description || p.title, canonical: url, origin, image: p.cover, type: "article", alternates, jsonld, extra })
    + header(l, trs.length ? urls : {}) + `<main class="wrap">
<nav class="crumbs" aria-label="breadcrumbs">${crumbs.slice(0, -1).map((c) => `<a href="${c.u}">${esc(c.n)}</a><span>›</span>`).join("")}</nav>
<div class="art"><article>
<h1>${esc(p.title)}</h1>
<div class="meta"><time datetime="${iso(p.publishedAt)}">${fmtDate(p.publishedAt, l)}</time>${p.updated - (p.publishedAt || 0) > 864e5 ? `<span>${t.updated}: ${fmtDate(p.updated, l)}</span>` : ""}<span>${a.readMin} ${t.read}</span></div>
${p.cover ? `<figure class="cover"><img src="${esc(p.cover)}" alt="${esc(p.coverAlt || p.title)}" width="1280" height="720" fetchpriority="high"></figure>` : `<div style="height:20px"></div>`}
<div class="prose">${body}</div>
${h2s.length < 4 ? ctaBox(l) : ""}
${p.faq.length ? `<section class="sec faq"><h2>${t.faq}</h2>${p.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>` : ""}
${p.tags.length ? `<div class="tags" style="margin-top:28px">${p.tags.map((x) => `<a href="${tagUrl(l, x)}">${esc(x)}</a>`).join("")}</div>` : ""}
</article>
<aside class="side">${a.toc.length >= 3 ? `<nav class="box" aria-label="${t.toc}"><h2>${t.toc}</h2><ol>${a.toc.map((x) => `<li><a href="#${x.id}">${esc(x.text)}</a></li>`).join("")}</ol></nav>` : ""}<div class="cta"><b>${esc(bt(l, "ctaT"))}</b><a class="btn" href="${homeUrl(l)}#contact">${t.ctaB}</a></div></aside></div>
${rel.length ? `<section class="sec"><h2>${t.related}</h2><div class="grid">${rel.map((x) => card(x, l, "h3")).join("")}</div></section>` : ""}
</main>` + footer(l);
}
function notFound(req, l = "es") {
  const t = BT[l], origin = originOf(req);
  const latest = published(l).slice(0, 3);
  return pageHead({ lang: l, title: `${t.nf} — ${BRAND()}`, description: t.nfP, canonical: "", origin, robots: "noindex,follow" }) + header(l) +
    `<main class="wrap"><h1>${t.nf}</h1><p class="lead">${t.nfP}</p><p><a class="btn" href="${homeUrl(l)}">${t.home}</a></p>${latest.length ? `<section class="sec"><h2>${t.blog}</h2><div class="grid">${latest.map((p) => card(p, l, "h3")).join("")}</div></section>` : ""}</main>` + footer(l);
}
function privacyPage(req, l) {
  const origin = originOf(req), b = biz();
  const who = [b.name, b.nif && `NIF ${b.nif}`, [b.street, b.postal, b.city].filter(Boolean).join(", "), b.email].filter(Boolean).map(esc).join(" · ");
  const mail = b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "";
  const TXT = {
    es: { h: "Política de privacidad", s: [
      ["Responsable", who],
      ["Qué datos tratamos y para qué", "Nombre, teléfono, email, el mensaje y las fotos que nos envías a través de los formularios o del visualizador. Los usamos solo para contactarte, preparar tu presupuesto y gestionar la obra."],
      ["Base legal", "Tu consentimiento al enviar el formulario y, si contratas, la ejecución del contrato."],
      ["Conservación", "Mientras dure la relación comercial y, si no llegamos a contratar, un máximo de 2 años, salvo obligación legal."],
      ["Destinatarios", "No cedemos tus datos a terceros. Usamos proveedores que los tratan por cuenta nuestra: alojamiento web, notificaciones internas y, en el visualizador, un servicio de inteligencia artificial que procesa la foto de tu baño para generar la imagen."],
      ["Tus derechos", `Puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${mail || "nuestro email de contacto"}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).`],
      ["Cookies", "Solo usamos cookies analíticas si las aceptas en el aviso de cookies. Puedes cambiar de opinión borrando las cookies de tu navegador."],
    ] },
    en: { h: "Privacy policy", s: [
      ["Data controller", who],
      ["What data we process and why", "Name, phone, email, your message and any photos you send through the forms or the visualiser. We use them only to contact you, prepare your quote and manage the works."],
      ["Legal basis", "Your consent when you send the form and, if you hire us, performance of the contract."],
      ["Retention", "For the duration of the business relationship and, if we don't work together, a maximum of 2 years, unless the law requires otherwise."],
      ["Recipients", "We do not share your data with third parties. We use processors acting on our behalf: web hosting, internal notifications and, for the visualiser, an AI service that processes your bathroom photo to create the image."],
      ["Your rights", `You can request access, rectification, erasure, objection, restriction and portability by writing to ${mail || "our contact email"}. You may also complain to the Spanish Data Protection Agency (aepd.es).`],
      ["Cookies", "We only use analytics cookies if you accept them in the cookie notice."],
    ] },
    ru: { h: "Политика конфиденциальности", s: [
      ["Ответственный", who],
      ["Какие данные и зачем", "Имя, телефон, email, сообщение и фото, которые вы отправляете через формы или визуализатор. Используем их только чтобы связаться с вами, подготовить смету и провести работы."],
      ["Правовое основание", "Ваше согласие при отправке формы, а при заключении договора — исполнение договора."],
      ["Срок хранения", "На время сотрудничества, а если договор не заключён — не более 2 лет, если закон не требует иного."],
      ["Получатели", "Мы не передаём данные третьим лицам. Используем обработчиков, действующих по нашему поручению: хостинг, внутренние уведомления и, для визуализатора, ИИ-сервис, который обрабатывает фото ванной."],
      ["Ваши права", `Доступ, исправление, удаление, возражение, ограничение и перенос данных — по запросу на ${mail || "наш email"}. Также можно подать жалобу в Испанское агентство по защите данных (aepd.es).`],
      ["Cookie", "Аналитические cookie используются только с вашего согласия."],
    ] },
  }[l];
  return pageHead({ lang: l, title: `${TXT.h} — ${b.name}`, description: TXT.h, canonical: privacyUrl(l), origin, robots: "noindex,follow" }) + header(l, Object.fromEntries(LANGS.map((x) => [x, privacyUrl(x)])))
    + `<main class="wrap"><h1>${TXT.h}</h1><div class="prose">${TXT.s.map(([h, p]) => `<h2>${h}</h2><p>${p}</p>`).join("")}</div></main>` + footer(l);
}
function sitemap(req) {
  const origin = originOf(req);
  const homeAlt = LANGS.map((l) => [l, homeUrl(l)]), blogAlt = LANGS.map((l) => [l, blogBase(l)]);
  const urls = [
    ...LANGS.map((l, i) => ({ loc: homeUrl(l), lastmod: Date.now(), pr: i ? "0.9" : "1.0", alt: homeAlt })),
    ...LANGS.map((l) => ({ loc: blogBase(l), lastmod: published(l)[0]?.updated, pr: "0.8", alt: blogAlt })),
  ];
  for (const p of published()) {
    const trs = translations(p);
    urls.push({ loc: postUrl(p), lastmod: p.updated || p.publishedAt, pr: "0.7", img: p.cover, alt: trs.length ? [p, ...trs].map((x) => [x.lang, postUrl(x)]) : [] });
  }
  for (const l of LANGS) {
    const counts = {};
    for (const p of published(l)) for (const x of p.tags) counts[x] = (counts[x] || 0) + 1;
    for (const [x, n] of Object.entries(counts)) if (n >= 2) urls.push({ loc: tagUrl(l, x), pr: "0.4", alt: [] });
  }
  const x = (s) => esc(origin + s);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `<url><loc>${x(u.loc)}</loc>${u.lastmod ? `<lastmod>${iso(u.lastmod).slice(0, 10)}</lastmod>` : ""}<priority>${u.pr}</priority>${u.alt.map(([l, h]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${x(h)}"/>`).join("")}${u.img ? `<image:image><image:loc>${esc(ogAbs(origin, u.img))}</image:loc></image:image>` : ""}</url>`).join("\n")}
</urlset>`;
}
const robots = (req) => `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /seo\nDisallow: /api/\nDisallow: /img/private/\n\nSitemap: ${originOf(req)}/sitemap.xml\n`;
function rss(req, l) {
  const origin = originOf(req);
  const items = published(l).slice(0, 30);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${esc(BRAND())} — ${BT[l].blog}</title><link>${esc(origin + blogBase(l))}</link><description>${esc(bt(l, "blogLead"))}</description><language>${l}</language>
<atom:link href="${esc(origin + blogBase(l))}/rss.xml" rel="self" type="application/rss+xml"/>
${items.map((p) => `<item><title>${esc(p.title)}</title><link>${esc(origin + postUrl(p))}</link><guid isPermaLink="true">${esc(origin + postUrl(p))}</guid><pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join("\n")}
</channel></rss>`;
}

// ======================= Главная (лендинг) =======================
const SVC_ICON = {
  integral: '<path d="M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M6 12V6a2 2 0 0 1 4 0"/><path d="M8 20l-1 2M16 20l1 2"/>',
  shower: '<path d="M5 21V8a4 4 0 0 1 8 0"/><path d="M10 11h6"/><path d="M12 14v1M15 14v1M18 14v1M13 17v1M16 17v1M19 17v1"/>',
  small: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M4 12h5"/>',
  tiles: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  plumbing: '<path d="M4 7h7a3 3 0 0 1 3 3v10"/><path d="M4 4v6M18 20h-8"/><path d="M14 13h6"/>',
  accessible: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 7v6h5l2 6"/><path d="M8 11a5 5 0 1 0 7 7"/>',
};
const svcName = (id, l) => HOME_T[l][`svc.${id}.t`] || id;
function latestFor(l, n = 3) {
  return published(l).slice(0, n).map((p) => ({ url: postUrl(p), title: p.title, description: p.description, cover: p.cover || "", alt: p.coverAlt || p.title, date: fmtDate(p.publishedAt, l) }));
}
function renderHome(req, l) {
  const tpl = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const origin = originOf(req), b = biz(), t = HOME_T[l], c = calcS(), sv = svcS(), v = vizS();
  const projects = publicProjects();
  const vizOn = v.enabled && !!falKey();
  const posts = latestFor(l);
  const meta = homeMeta(l);
  const vars = { city: b.city, cityRu: b.cityRu, g: b.guarantee, privacy: privacyUrl(l), pShower: money(sv.shower, l), pIntegral: money(sv.integral, l) };
  const fill = (s) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const dict = { ...t, lang: l, home: homeUrl(l), blogUrl: blogBase(l), "biz.name": b.name, "meta.title": meta.title, "meta.description": meta.description,
    "proj.attr": projects.length ? "" : "hidden", "viz.attr": vizOn ? "" : "hidden", "blog.attr": posts.length ? "" : "hidden" };
  const tel = phoneHref(b.phone), wa = waLink(b, { es: "Hola, quiero información sobre la reforma de un baño.", en: "Hello, I'd like information about a bathroom renovation.", ru: "Здравствуйте, хочу узнать про ремонт ванной." }[l]);
  const faq = FAQ_T[l].map(([q, a]) => [fill(q), fill(a)]);
  const address = [b.street, [b.postal, b.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const og = ogAbs(origin, S.ogImage);
  const business = {
    "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness", "@id": origin + "/#business", name: b.name, url: origin + "/", priceRange: "€€",
    ...(og ? { image: og } : {}), ...(b.phone ? { telephone: tel.replace("tel:", "") } : {}), ...(b.email ? { email: b.email } : {}),
    address: { "@type": "PostalAddress", ...(b.street ? { streetAddress: b.street } : {}), ...(b.postal ? { postalCode: b.postal } : {}), addressLocality: b.city, addressRegion: b.region, addressCountry: "ES" },
    geo: { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng },
    areaServed: b.areas.map((a) => ({ "@type": "City", name: a })),
    ...(b.openingHours ? { openingHours: b.openingHours } : {}),
    ...(b.gbp ? { sameAs: [b.gbp] } : {}),
    knowsLanguage: ["es", "en", "ru"],
    hasOfferCatalog: { "@type": "OfferCatalog", name: t["svc.title"], itemListElement: SERVICES.map((id) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: svcName(id, l), areaServed: b.city }, priceSpecification: { "@type": "PriceSpecification", minPrice: sv[id], priceCurrency: "EUR" } })) },
  };
  const blocks = {
    SEO_HEAD: [
      `<link rel="canonical" href="${esc(origin + homeUrl(l))}">`,
      ...LANGS.map((x) => `<link rel="alternate" hreflang="${x}" href="${esc(origin + homeUrl(x))}">`), `<link rel="alternate" hreflang="x-default" href="${esc(origin)}/">`,
      `<meta property="og:type" content="website"><meta property="og:url" content="${esc(origin + homeUrl(l))}"><meta property="og:site_name" content="${esc(b.name)}"><meta property="og:locale" content="${OG_LOCALE[l]}">`,
      og ? `<meta property="og:image" content="${esc(og)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(og)}">` : `<meta name="twitter:card" content="summary">`,
      `<link rel="alternate" type="application/rss+xml" title="${esc(b.name)}" href="${blogBase(l)}/rss.xml">`,
      ld(business),
      ld({ "@context": "https://schema.org", "@type": "WebSite", "@id": origin + "/#site", name: b.name, url: origin + "/", inLanguage: LANGS, publisher: bizRef(origin) }),
      ld({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }),
      headExtras(l),
    ].join("\n"),
    LANGS: langLinks(l, Object.fromEntries(LANGS.map((x) => [x, homeUrl(x)]))),
    HEADER_CALL: tel ? `<a class="btn ghost call" href="${tel}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg><span>${esc(b.phone)}</span></a>` : "",
    HERO_CALL: tel ? `<a class="btn big" href="${tel}">${esc(t["cta.call"])} · ${esc(b.phone)}</a>` : wa ? `<a class="btn big" href="${wa}" target="_blank" rel="noopener">${esc(t["cta.wa"])}</a>` : "",
    SERVICES: SERVICES.map((id) => `<article class="svc"><svg viewBox="0 0 24 24" aria-hidden="true">${SVC_ICON[id]}</svg><h3>${esc(svcName(id, l))}</h3><p>${esc(t[`svc.${id}.p`])}</p><span class="from">${esc(t["svc.from"])} <b>${esc(money(sv[id], l))}${id === "tiles" ? "/m²" : ""}</b></span></article>`).join(""),
    PROJECTS: projects.map((p) => {
      const name = p.caption || svcName(p.type, l);
      const sub = [p.city, p.area ? `${String(p.area).replace(".", l === "en" ? "." : ",")} m²` : "", p.days ? `${p.days} ${t["proj.days"]}` : ""].filter(Boolean).join(" · ");
      const altBase = `${svcName(p.type, l)}${p.city ? " — " + p.city : ""}`;
      return `<figure class="pj"><div class="ba" tabindex="0" role="slider" aria-label="${esc(altBase)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><img class="after" src="${esc(p.after)}" alt="${esc(altBase + " — " + t["proj.after"])}" loading="lazy"><img class="before" src="${esc(p.before)}" alt="${esc(altBase + " — " + t["proj.before"])}" loading="lazy"><div class="line"></div><span class="t l">${esc(t["proj.before"])}</span><span class="t r">${esc(t["proj.after"])}</span></div><figcaption><b>${esc(name)}</b><span>${esc(sub)}</span></figcaption></figure>`;
    }).join(""),
    PRICE_LIST: SERVICES.map((id) => `<li><span>${esc(svcName(id, l))}</span><b>${esc(t["svc.from"])} ${esc(money(sv[id], l))}${id === "tiles" ? "/m²" : ""}</b></li>`).join(""),
    VIZ_STYLES: Object.keys(VIZ_STYLES).map((id, i) => `<label class="vs vs-${id}"><input type="radio" name="vstyle" value="${id}"${i ? "" : " checked"}><span class="sw" aria-hidden="true"></span><b>${esc(t["st." + id])}</b></label>`).join(""),
    AREAS: b.areas.map((a) => `<li>${esc(a)}</li>`).join(""),
    FAQ: faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(""),
    LATEST_POSTS: posts.map((p) => `<a class="post" href="${esc(p.url)}"><span class="ph">${p.cover ? `<img src="${esc(p.cover)}" alt="${esc(p.alt)}" loading="lazy">` : ""}</span><span class="tx"><span class="d">${esc(p.date)}</span><b>${esc(p.title)}</b><span class="s">${esc(p.description)}</span></span></a>`).join(""),
    CONTACT_INFO: [
      tel ? `<li><span>${esc(t["c.phone"])}</span><a href="${tel}">${esc(b.phone)}</a></li>` : "",
      wa ? `<li><span>WhatsApp</span><a href="${wa}" target="_blank" rel="noopener">${esc(t["c.wa"])}</a></li>` : "",
      b.email ? `<li><span>${esc(t["c.email"])}</span><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></li>` : "",
      address ? `<li><span>${esc(t["c.address"])}</span><address>${esc(address)}</address></li>` : "",
      b.hours ? `<li><span>${esc(t["c.hours"])}</span><span>${esc(b.hours)}</span></li>` : "",
      b.gbp ? `<li><span>Google</span><a href="${esc(b.gbp)}" target="_blank" rel="noopener">${esc(t["c.reviews"])} ↗</a></li>` : "",
    ].join("") + (address ? `</ul><iframe class="map" title="${esc(b.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(b.name + ", " + address)}&output=embed"></iframe><ul hidden>` : ""),
    FOOTER_NAP: esc([b.name, address || b.city, b.phone, b.nif && "NIF " + b.nif].filter(Boolean).join(" · ")),
    MOBILE_BAR: [tel && `<a href="${tel}">${esc(t["cta.call"])}</a>`, wa && `<a href="${wa}" target="_blank" rel="noopener">${esc(t["cta.wa"])}</a>`, `<a class="q" href="#contact">${esc(t["cta.quote"])}</a>`].filter(Boolean).join(""),
    DATA: `<script>window.__D=${JSON.stringify({ lang: l, locale: LOCALE[l], calc: c, t: Object.fromEntries(CLIENT_KEYS.map((k) => [k, fill(t[k])])) }).replace(/</g, "\\u003c")};</script>`,
  };
  return tpl
    .replace(/\{\{\{([\w.]+)\}\}\}/g, (m, k) => (k in dict ? fill(dict[k]) : m))
    .replace(/\{\{([\w.]+)\}\}/g, (m, k) => (k in dict ? esc(fill(dict[k])) : m))
    .replace(/<!--([A-Z_]+)-->/g, (m, k) => (k in blocks ? blocks[k] : m));
}

// ======================= HTTP =======================
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = fs.existsSync(path.join(ROOT, "public", "index.html")) ? path.join(ROOT, "public") : ROOT;
const PORT = process.env.PORT || 3000;
const json = (res, data, status = 200) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
async function readBody(req, lim = 1e6) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > lim) throw new UserError("Слишком большой запрос. Загрузите меньше фото.", 413); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}
const parse = (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { throw new UserError("Некорректный запрос."); } };
function isAdmin(req) {
  const pass = process.env.ADMIN_PASSWORD || "";
  if (!pass) throw new UserError("Админка выключена: задайте ADMIN_PASSWORD в Railway → Variables.", 403);
  const a = crypto.createHash("sha256").update(pass).digest(), b = crypto.createHash("sha256").update(String(req.headers["x-admin"] || "")).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new UserError("Неверный пароль.", 401);
}

const routes = {
  // ---------- публичные ----------
  "POST /api/lead": async (req, res) => {
    const b = parse(await readBody(req, 9e6));
    const l = normLang(b.lang), E = HOME_T[l];
    if (b.website) return json(res, { ok: true });
    const who = validateContact(b, E);
    if (!limit("lead:" + ipOf(req), 6, 36e5)) throw new UserError(E["e.many"], 429);
    const photos = [];
    for (const ph of (Array.isArray(b.photos) ? b.photos : []).slice(0, 3)) { const img = parseImg(ph, E["e.photo"]); photos.push(writeImg("private", token(), img.buf, img.type)); }
    addLead({ ...who, message: String(b.message || "").trim().slice(0, 2000), lang: l, source: ["hero", "form", "calc"].includes(b.source) ? b.source : "form", estimate: clean(b.estimate, 200), page: clean(b.page, 200), photos }, knownOrigin());
    json(res, { ok: true });
  },
  "POST /api/visualize": async (req, res) => {
    const b = parse(await readBody(req, 9e6));
    const l = normLang(b.lang), E = HOME_T[l], v = vizS();
    if (!v.enabled || !falKey()) throw new UserError(E["e.off"], 503);
    if (b.website) throw new UserError(E["e.bad"]);
    const who = validateContact(b, E);
    const style = VIZ_STYLES[b.style] ? b.style : "modern";
    const img = parseImg(b.photo, E["e.photo"]);
    const today = day();
    if (db.viz.filter((x) => day(x.created) === today).length >= v.dailyCap) {
      addLead({ ...who, message: `Хотел(а) визуализацию (${style}), но дневной лимит исчерпан.`, lang: l, source: "viz" }, knownOrigin());
      throw new UserError(E["e.busy"], 429);
    }
    const pk = digits(who.phone).slice(-9);
    if (db.viz.filter((x) => x.phoneKey === pk && Date.now() - x.created < 864e5).length >= v.perPhone || !limit("viz:" + ipOf(req), 3, 864e5)) throw new UserError(E["e.limit"], 429);
    const fileId = token();
    const before = writeImg("private", `${fileId}-before`, img.buf, img.type);
    let lead = db.leads.find((x) => x.source === "viz" && digits(x.phone).slice(-9) === pk && Date.now() - x.created < 864e5);
    if (lead) lead.photos.push(before);
    else lead = addLead({ ...who, message: `Визуализатор: стиль «${HOME_T.ru["st." + style]}»`, lang: l, source: "viz", photos: [before] }, knownOrigin());
    const job = { id: newId(), token: token(), fileId, leadId: lead.id, style, model: v.model, phoneKey: pk, created: Date.now(), before, after: "", status: "working" };
    const r = await falSubmit(v.model, { prompt: vizPrompt(style), image_urls: [b.photo], num_images: 1, output_format: "jpeg", aspect_ratio: "auto", resolution: "1K" });
    if (!r.ok || !r.data.request_id) { job.status = "failed"; job.error = falError(r.status, r.data).admin; db.viz.unshift(job); save(); throw new UserError(E["e.failed"], 502); }
    job.statusUrl = r.data.status_url; job.responseUrl = r.data.response_url;
    db.viz.unshift(job);
    if (db.viz.length > 3000) db.viz.length = 3000;
    save();
    json(res, { job: job.id, token: job.token });
  },
  "POST /api/visualize/status": async (req, res) => {
    const b = parse(await readBody(req));
    const job = db.viz.find((x) => x.id === b.job);
    if (!job || job.token !== b.token) throw new UserError("Not found", 404);
    if (job.status === "working") await advanceViz(job);
    json(res, { state: job.status, after: job.after || "", error: job.status === "failed" ? HOME_T[normLang(b.lang)]["e.failed"] : "" });
  },
  "GET /api/health": async (req, res) => {
    const p = await falProbe();
    json(res, { fal: p.text, storage: PERSISTENT ? `сохраняется (${DATA_DIR})` : "Volume не подключён", telegram: tgOn(), admin: !!process.env.ADMIN_PASSWORD });
  },

  // ---------- админка ----------
  "GET /api/admin/stats": async (req, res) => {
    isAdmin(req);
    const DAY = 864e5;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const from = start.getTime() - i * DAY, to = from + DAY;
      days.push({ day: from, leads: db.leads.filter((x) => x.created >= from && x.created < to).length, viz: db.viz.filter((x) => x.created >= from && x.created < to).length });
    }
    const since = (ms) => db.leads.filter((x) => x.created >= Date.now() - ms).length;
    const cost = (m) => VIZ_MODELS.find((x) => x.id === m)?.cost ?? 0.15;
    const p = await falProbe();
    json(res, {
      brand: BRAND(), days,
      leads: { today: days[13].leads, week: since(7 * DAY), month: since(30 * DAY), total: db.leads.length, fresh: db.leads.filter((x) => x.status === "new").length, won: db.leads.filter((x) => x.status === "won").length },
      bySource: Object.fromEntries(["hero", "form", "calc", "viz"].map((s) => [s, db.leads.filter((x) => x.source === s).length])),
      viz: { total: db.viz.length, done: db.viz.filter((x) => x.status === "done").length, cost: +db.viz.filter((x) => x.status === "done").reduce((s, x) => s + cost(x.model), 0).toFixed(2) },
      system: { fal: p.text, falOk: p.ok, persistent: PERSISTENT, dataDir: DATA_DIR, telegram: tgOn(), publicUrl: process.env.PUBLIC_URL || "", biz: !!(biz().phone) },
    });
  },
  "GET /api/admin/leads": async (req, res) => { isAdmin(req); json(res, db.leads.slice(0, 1000)); },
  "POST /api/admin/leads/update": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req));
    const x = db.leads.find((l) => l.id === b.id);
    if (!x) throw new UserError("Заявка не найдена.", 404);
    if (STATUSES.includes(b.status)) x.status = b.status;
    if (b.note !== undefined) x.note = String(b.note).slice(0, 2000);
    save();
    json(res, x);
  },
  "POST /api/admin/leads/delete": async (req, res) => {
    isAdmin(req);
    const { id } = parse(await readBody(req));
    const x = db.leads.find((l) => l.id === id);
    if (x) {
      for (const u of [...x.photos, x.viz]) rmImg(u);
      for (const v of db.viz) if (v.leadId === id) { rmImg(v.before); rmImg(v.after); v.before = v.after = ""; }
      db.leads = db.leads.filter((l) => l.id !== id);
      save();
    }
    json(res, { ok: true });
  },
  "GET /api/admin/viz": async (req, res) => {
    isAdmin(req);
    json(res, db.viz.slice(0, 80).map(({ token: _t, statusUrl, responseUrl, ...v }) => ({ ...v, name: db.leads.find((l) => l.id === v.leadId)?.name || "" })));
  },
  "GET /api/admin/projects": async (req, res) => { isAdmin(req); json(res, db.projects); },
  "POST /api/admin/projects": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req, 9e6));
    const before = parseImg(b.before, "Загрузите фото «до».");
    const after = parseImg(b.after, "Загрузите фото «после».");
    const p = projectFields({ published: true, featured: false, ...b }, { id: newId(), created: Date.now() });
    p.before = writeImg("projects", `${p.id}-before`, before.buf, before.type);
    p.after = writeImg("projects", `${p.id}-after`, after.buf, after.type);
    db.projects.unshift(p);
    save();
    json(res, db.projects);
  },
  "POST /api/admin/projects/update": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req, 9e6));
    const p = db.projects.find((x) => x.id === b.id);
    if (!p) throw new UserError("Проект не найден.", 404);
    if (b.which === "before" || b.which === "after") { const img = parseImg(b.image); p[b.which] = writeImg("projects", `${p.id}-${b.which}`, img.buf, img.type); }
    else projectFields({ ...p, ...b }, p);
    save();
    json(res, db.projects);
  },
  "POST /api/admin/projects/delete": async (req, res) => {
    isAdmin(req);
    const { id } = parse(await readBody(req));
    const p = db.projects.find((x) => x.id === id);
    if (p) { rmImg(p.before); rmImg(p.after); db.projects = db.projects.filter((x) => x.id !== id); save(); }
    json(res, db.projects);
  },
  "GET /api/admin/settings": async (req, res) => {
    isAdmin(req);
    json(res, { biz: biz(), services: svcS(), calc: calcS(), viz: vizS(), vizModels: VIZ_MODELS, vizStyles: Object.keys(VIZ_STYLES).map((id) => ({ id, name: HOME_T.ru["st." + id] })), serviceNames: Object.fromEntries(SERVICES.map((id) => [id, HOME_T.ru[`svc.${id}.t`]])), telegram: tgOn(), falKey: !!falKey() });
  },
  "POST /api/admin/settings": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req));
    if (b.biz) {
      const x = b.biz;
      const lat = parseFloat(x.lat), lng = parseFloat(x.lng);
      db.settings.biz = {
        name: clean(x.name, 80), phone: clean(x.phone, 30), whatsapp: clean(x.whatsapp, 30), email: clean(x.email, 120),
        street: clean(x.street, 120), postal: clean(x.postal, 10), city: clean(x.city, 60), cityRu: clean(x.cityRu, 60), region: clean(x.region, 60),
        hours: clean(x.hours, 120), openingHours: clean(x.openingHours, 120), guarantee: Math.round(clampNum(x.guarantee, 1, 10, 2)),
        gbp: /^https?:\/\//.test(String(x.gbp || "")) ? clean(x.gbp, 400) : "", nif: clean(x.nif, 20),
        areas: String(Array.isArray(x.areas) ? x.areas.join(",") : x.areas || "").split(/[,\n]/).map((a) => clean(a, 60)).filter(Boolean).slice(0, 40),
        lat: Number.isFinite(lat) ? lat : undefined, lng: Number.isFinite(lng) ? lng : undefined,
      };
    }
    if (b.services) for (const id of SERVICES) db.settings.services[id] = Math.round(clampNum(b.services[id], 0, 1e6, SVC0[id]));
    if (b.calc) for (const k of Object.keys(CALC0)) db.settings.calc[k] = Math.round(clampNum(b.calc[k], 0, 1e6, CALC0[k]));
    if (b.viz) db.settings.viz = { enabled: !!b.viz.enabled, model: VIZ_MODELS.some((m) => m.id === b.viz.model) ? b.viz.model : VIZ0.model, dailyCap: Math.round(clampNum(b.viz.dailyCap, 0, 1000, 40)), perPhone: Math.round(clampNum(b.viz.perPhone, 1, 20, 2)) };
    save();
    json(res, { ok: true });
  },

  // ---------- Блог и SEO ----------
  "GET /api/admin/seo": async (req, res) => {
    isAdmin(req);
    const origin = originOf(req);
    if (jobsBusy()) await pollJobs();
    const graph = linkGraph();
    json(res, {
      brand: BRAND(), origin, publicUrl: !!process.env.PUBLIC_URL, langs: LANGS,
      settings: { home: S.home, defaults: Object.fromEntries(LANGS.map((l) => [l, defaultHome(l)])), verify: S.verify, analytics: S.analytics, llm: S.llm, indexnow: S.indexnow, autoCover: S.autoCover, ogImage: S.ogImage, lastIndexNow: S.lastIndexNow || null },
      llmModels: LLM_MODELS,
      posts: db.posts.map((p) => ({ ...postSummary(p), incoming: graph.incoming[postUrl(p)] || 0, outgoing: graph.outgoing[p.id] || 0 })),
      jobs: db.seoJobs.slice(0, 40).map(({ statusUrl, responseUrl, ...j }) => j),
      plan: S.plan.slice(0, 300),
      links: { manual: S.links, max: S.maxLinks, auto: LANGS.flatMap((l) => linkRules(l).filter((r) => r.auto).map((r) => ({ ...r, lang: l }))) },
      audit: audit(),
      views: viewsByDay(30),
    });
  },
  "GET /api/admin/seo/post": async (req, res, url) => {
    isAdmin(req);
    const p = findPost(url.searchParams.get("id"));
    if (!p) throw new UserError("Статья не найдена.", 404);
    json(res, { post: { ...p, translations: postSummary(p).translations }, analysis: analyze(p) });
  },
  "POST /api/admin/seo/post": async (req, res) => {
    isAdmin(req);
    const p = savePost(parse(await readBody(req, 2e6)));
    if (p.status === "published") indexNow([postUrl(p), "/sitemap.xml"]).catch(() => {});
    json(res, { post: { ...p, translations: postSummary(p).translations }, analysis: analyze(p) });
  },
  "POST /api/admin/seo/analyze": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req, 2e6));
    const p = { lang: normLang(b.lang), title: String(b.title || ""), keyword: String(b.keyword || ""), description: String(b.description || ""), slug: slugify(b.slug || b.title || ""), body: String(b.body || ""), faq: Array.isArray(b.faq) ? b.faq : [], tags: [], anchors: "", cover: b.cover || "", id: b.id || "" };
    json(res, analyze(p));
  },
  "POST /api/admin/seo/publish": async (req, res) => {
    isAdmin(req);
    const { id, published: on } = parse(await readBody(req));
    const p = setPublished(id, !!on);
    const r = on ? await indexNow([postUrl(p), blogBase(p.lang), "/sitemap.xml"]) : null;
    json(res, { post: postSummary(p), indexnow: r });
  },
  "POST /api/admin/seo/delete": async (req, res) => { isAdmin(req); deletePost(parse(await readBody(req)).id); json(res, { ok: true }); },
  "POST /api/admin/seo/cover": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req, 9e6));
    if (b.image) { uploadCover(b.id, b.image); return json(res, { ok: true, post: findPost(b.id) }); }
    await startCover(b.id);
    json(res, { ok: true, post: findPost(b.id) });
  },
  "POST /api/admin/seo/ai/article": async (req, res) => {
    isAdmin(req);
    const b = parse(await readBody(req));
    const items = Array.isArray(b.items) ? b.items.slice(0, 10) : [b];
    for (const it of items) await startArticle(it);
    json(res, { ok: true, started: items.length });
  },
  "POST /api/admin/seo/ai/translate": async (req, res) => { isAdmin(req); await startTranslate(parse(await readBody(req))); json(res, { ok: true }); },
  "POST /api/admin/seo/ai/plan": async (req, res) => { isAdmin(req); await startPlan(parse(await readBody(req))); json(res, { ok: true }); },
  "POST /api/admin/seo/ai/meta": async (req, res) => { isAdmin(req); json(res, await improveMeta(parse(await readBody(req, 2e6)))); },
  "POST /api/admin/seo/plan/remove": async (req, res) => { isAdmin(req); const { id } = parse(await readBody(req)); S.plan = S.plan.filter((x) => x.id !== id); save(); json(res, { ok: true }); },
  "POST /api/admin/seo/links": async (req, res) => { isAdmin(req); saveLinks(parse(await readBody(req))); json(res, { ok: true }); },
  "POST /api/admin/seo/settings": async (req, res) => { isAdmin(req); saveSeoSettings(parse(await readBody(req))); json(res, { ok: true }); },
  "POST /api/admin/seo/og": async (req, res) => { isAdmin(req); uploadOg(parse(await readBody(req, 9e6)).image); json(res, { ok: true, ogImage: S.ogImage }); },
  "POST /api/admin/seo/indexnow": async (req, res) => { isAdmin(req); originOf(req); json(res, await indexNow(allUrls())); },
};

const HTML = "text/html; charset=utf-8";
const send = (res, status, type, body, cache = "no-cache") => { res.writeHead(status, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" }); res.end(body); };
const HOMES = { "/": "es", "/en": "en", "/ru": "ru" };
const PRIVACY = { "/privacidad": "es", "/en/privacy": "en", "/ru/privacy": "ru" };
const ADMIN_PAGES = { "/admin": "admin.html", "/seo": "seo.html" };
function dynamic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const p = url.pathname;
  if (p.length > 1 && p.endsWith("/")) { res.writeHead(301, { location: p.replace(/\/+$/, "") + url.search }); res.end(); return true; }
  if (HOMES[p]) return send(res, 200, HTML, renderHome(req, HOMES[p])), true;
  if (PRIVACY[p]) return send(res, 200, HTML, privacyPage(req, PRIVACY[p])), true;
  if (ADMIN_PAGES[p]) {
    res.writeHead(200, { "content-type": HTML, "cache-control": "no-cache", "x-robots-tag": "noindex, nofollow" });
    fs.createReadStream(path.join(PUBLIC, ADMIN_PAGES[p])).pipe(res);
    return true;
  }
  if (p === "/sitemap.xml") return send(res, 200, "application/xml; charset=utf-8", sitemap(req)), true;
  if (p === "/robots.txt") return send(res, 200, "text/plain; charset=utf-8", robots(req)), true;
  if (p === `/${S.indexnowKey}.txt`) return send(res, 200, "text/plain; charset=utf-8", S.indexnowKey), true;
  let m = p.match(/^\/img\/(\w+)\/([^/]+)$/);
  if (m) return serveImg(res, m[1], m[2]);
  m = p.match(/^(?:\/(en|ru))?\/blog(?:\/(rss\.xml|tag\/([^/]+)|([a-z0-9-]+)))?$/);
  if (!m) return false;
  const l = m[1] || "es";
  const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);
  if (m[2] === "rss.xml") return send(res, 200, "application/rss+xml; charset=utf-8", rss(req, l)), true;
  if (m[3]) { const html = blogList(req, l, { page, tag: decodeURIComponent(m[3]) }); return send(res, html ? 200 : 404, HTML, html || notFound(req, l)), true; }
  if (m[4]) {
    const post = findBySlug(l, m[4]);
    if (!post) return send(res, 404, HTML, notFound(req, l)), true;
    countView(post, req);
    return send(res, 200, HTML, article(req, post)), true;
  }
  const html = blogList(req, l, { page });
  return send(res, html ? 200 : 404, HTML, html || notFound(req, l)), true;
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // Один основной адрес: www., *.up.railway.app и т. п. → 301 на PUBLIC_URL (API не трогаем)
  const canon = process.env.PUBLIC_URL ? (() => { try { return new URL(process.env.PUBLIC_URL); } catch { return null; } })() : null;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  if (canon && host && host !== canon.host && !/localhost|127\.0\.0\.1|\.railway\.internal$/.test(host) && (req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/api/")) {
    res.writeHead(301, { location: canon.origin + url.pathname + url.search });
    return res.end();
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) return await handler(req, res, url);
    if (url.pathname.startsWith("/api/")) return json(res, { error: "Не найдено" }, 404);
    if (dynamic(req, res, url)) return;
    const l = url.pathname.startsWith("/en/") ? "en" : url.pathname.startsWith("/ru/") ? "ru" : "es";
    send(res, 404, HTML, notFound(req, l));
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    if (!res.headersSent) json(res, { error: e instanceof UserError ? e.message : "Внутренняя ошибка сервера. Попробуйте ещё раз." }, e.status || 500);
  }
}).listen(PORT, () => console.log(`${BRAND()}: сайт запущен на порту ${PORT}. Данные: ${DATA_DIR}${PERSISTENT ? "" : " (Volume не подключён!)"}`));

setInterval(() => { for (const j of db.viz) if (j.status === "working") advanceViz(j); }, 5000).unref();
setInterval(() => { if (jobsBusy()) pollJobs().catch(() => {}); }, 5000).unref();
