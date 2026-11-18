// Notifications: stored in-app, then delivered by email (Resend) and web push
// in the RECIPIENT's language. The web app renders in-app notifications from
// `type` + `data` with its own translations; these templates are for email/push.
import * as webpush from 'web-push';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { sendEmail } from './email.js';

const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

const CATEGORY = {
  en: { phone: 'phone', wallet: 'wallet', national_id: 'ID card', bank_cards: 'bank card', documents: 'documents', keys: 'keys', bag: 'bag', jewellery: 'jewellery', watch: 'watch', laptop: 'laptop', vehicle_documents: 'vehicle documents', pets: 'pet', childrens_items: "child's item", cash: 'cash', other: 'item' },
  ur: { phone: 'فون', wallet: 'بٹوا', national_id: 'شناختی کارڈ', bank_cards: 'بینک کارڈ', documents: 'دستاویزات', keys: 'چابیاں', bag: 'بیگ', jewellery: 'زیور', watch: 'گھڑی', laptop: 'لیپ ٹاپ', vehicle_documents: 'گاڑی کے کاغذات', pets: 'پالتو جانور', childrens_items: 'بچوں کی چیز', cash: 'نقد رقم', other: 'چیز' },
  ar: { phone: 'هاتف', wallet: 'محفظة', national_id: 'بطاقة هوية', bank_cards: 'بطاقة بنكية', documents: 'مستندات', keys: 'مفاتيح', bag: 'حقيبة', jewellery: 'مجوهرات', watch: 'ساعة', laptop: 'حاسوب محمول', vehicle_documents: 'مستندات مركبة', pets: 'حيوان أليف', childrens_items: 'غرض طفل', cash: 'نقود', other: 'غرض' },
};

// [title, body] per type and language. {{x}} placeholders come from `data`.
const T = {
  en: {
    match_for_owner: ['Possible match found', 'A found {{category}} may be yours ({{score}}% match). Take a look.'],
    match_for_finder: ['Someone may have lost this', 'A lost report matches the {{category}} you found ({{score}}% match).'],
    alert_match: ['Your alert: new {{category}} found', 'A {{category}} was found near the area you are watching.'],
    new_claim: ['New claim on your post', 'Someone says the {{category}} you found is theirs. Review their proof.'],
    claim_approved: ['Your claim was approved', 'The finder approved your claim. Agree on a safe handover.'],
    claim_rejected: ['Your claim was not approved', 'The finder could not confirm your claim for the {{category}}.'],
    claim_follow_up: ['The finder has a question', 'Answer a follow-up question about the {{category}}.'],
    follow_up_answered: ['Follow-up answered', 'The claimant answered your question. Review the claim.'],
    claim_expired: ['Claim expired', 'Your claim for the {{category}} expired without a response.'],
    new_message: ['New message', 'You have a new message about the {{category}}.'],
    handover_ready: ['Handover agreed', 'Both of you agreed to the handover. Choose how to meet.'],
    handover_updated: ['Handover details updated', 'The handover plan for the {{category}} changed.'],
    handover_reminder: ['Handover reminder', 'Your handover for the {{category}} is coming up. Meet only in a safe public place.'],
    item_returned: ['Returned!', 'The {{category}} is back with its owner. Please rate the handover.'],
    found_reminder: ['Still holding a found item?', 'Your {{category}} post has been open for 90 days. Consider handing it to {{authority}}.'],
    identity_approved: ['Identity verified', 'Your identity was verified. You now have the Identity verified badge.'],
    identity_rejected: ['Identity check not approved', 'We could not verify your identity. You can try again.'],
  },
  ur: {
    match_for_owner: ['ممکنہ میچ ملا', 'ملا ہوا {{category}} شاید آپ کا ہے ({{score}}% میچ)۔ ایک نظر دیکھیں۔'],
    match_for_finder: ['شاید کسی نے یہ کھویا ہے', 'گمشدگی کی ایک رپورٹ آپ کو ملے {{category}} سے ملتی ہے ({{score}}% میچ)۔'],
    alert_match: ['آپ کا الرٹ: نیا {{category}} ملا', 'آپ کے منتخب علاقے کے قریب ایک {{category}} ملا ہے۔'],
    new_claim: ['آپ کی پوسٹ پر نیا دعویٰ', 'کوئی کہتا ہے کہ آپ کو ملا {{category}} اس کا ہے۔ ان کا ثبوت دیکھیں۔'],
    claim_approved: ['آپ کا دعویٰ منظور ہو گیا', 'چیز پانے والے نے آپ کا دعویٰ منظور کر لیا۔ محفوظ حوالگی پر اتفاق کریں۔'],
    claim_rejected: ['آپ کا دعویٰ منظور نہیں ہوا', 'چیز پانے والا {{category}} کے لیے آپ کے دعوے کی تصدیق نہیں کر سکا۔'],
    claim_follow_up: ['چیز پانے والے کا ایک سوال ہے', '{{category}} کے بارے میں اضافی سوال کا جواب دیں۔'],
    follow_up_answered: ['اضافی سوال کا جواب آ گیا', 'دعویدار نے آپ کے سوال کا جواب دے دیا۔ دعویٰ دیکھیں۔'],
    claim_expired: ['دعویٰ ختم ہو گیا', '{{category}} کے لیے آپ کا دعویٰ جواب نہ ملنے پر ختم ہو گیا۔'],
    new_message: ['نیا پیغام', '{{category}} کے بارے میں آپ کے لیے نیا پیغام ہے۔'],
    handover_ready: ['حوالگی پر اتفاق ہو گیا', 'آپ دونوں نے حوالگی پر اتفاق کر لیا۔ ملنے کا طریقہ منتخب کریں۔'],
    handover_updated: ['حوالگی کی تفصیلات بدل گئیں', '{{category}} کی حوالگی کا منصوبہ تبدیل ہوا ہے۔'],
    handover_reminder: ['حوالگی کی یاد دہانی', '{{category}} کی حوالگی قریب ہے۔ صرف محفوظ عوامی جگہ پر ملیں۔'],
    item_returned: ['واپس مل گیا!', '{{category}} اپنے مالک تک پہنچ گیا۔ براہ کرم حوالگی کی درجہ بندی کریں۔'],
    found_reminder: ['کیا ملی ہوئی چیز ابھی آپ کے پاس ہے؟', 'آپ کی {{category}} کی پوسٹ 90 دن سے کھلی ہے۔ اسے {{authority}} کے حوالے کرنے پر غور کریں۔'],
    identity_approved: ['شناخت کی تصدیق ہو گئی', 'آپ کی شناخت کی تصدیق ہو گئی۔ اب آپ کے پاس شناخت تصدیق شدہ کا بیج ہے۔'],
    identity_rejected: ['شناخت کی تصدیق نہیں ہوئی', 'ہم آپ کی شناخت کی تصدیق نہیں کر سکے۔ آپ دوبارہ کوشش کر سکتے ہیں۔'],
  },
  ar: {
    match_for_owner: ['تطابق محتمل', 'قد يكون ({{category}}) الذي عُثر عليه لك (تطابق {{score}}%). ألقِ نظرة.'],
    match_for_finder: ['ربما أضاعه أحدهم', 'بلاغ فقدان يطابق ({{category}}) الذي وجدته (تطابق {{score}}%).'],
    alert_match: ['تنبيهك: عُثر على {{category}}', 'عُثر على {{category}} بالقرب من المنطقة التي تتابعها.'],
    new_claim: ['مطالبة جديدة على منشورك', 'يقول شخص إن ({{category}}) الذي وجدته يخصه. راجع إثباته.'],
    claim_approved: ['تمت الموافقة على مطالبتك', 'وافق من وجد الغرض على مطالبتك. اتفقا على تسليم آمن.'],
    claim_rejected: ['لم تتم الموافقة على مطالبتك', 'لم يتمكن من وجد الغرض من تأكيد مطالبتك بـ({{category}}).'],
    claim_follow_up: ['لدى من وجد الغرض سؤال', 'أجب عن سؤال إضافي بخصوص ({{category}}).'],
    follow_up_answered: ['تمت الإجابة عن السؤال', 'أجاب صاحب المطالبة عن سؤالك. راجع المطالبة.'],
    claim_expired: ['انتهت المطالبة', 'انتهت مطالبتك بـ({{category}}) دون رد.'],
    new_message: ['رسالة جديدة', 'لديك رسالة جديدة بخصوص ({{category}}).'],
    handover_ready: ['تم الاتفاق على التسليم', 'وافق كلاكما على التسليم. اختارا طريقة اللقاء.'],
    handover_updated: ['تم تحديث تفاصيل التسليم', 'تغيّرت خطة تسليم ({{category}}).'],
    handover_reminder: ['تذكير بالتسليم', 'موعد تسليم ({{category}}) يقترب. التقيا فقط في مكان عام آمن.'],
    item_returned: ['تمت الإعادة!', 'عاد ({{category}}) إلى صاحبه. يُرجى تقييم التسليم.'],
    found_reminder: ['هل ما زال الغرض معك؟', 'منشورك عن ({{category}}) مفتوح منذ 90 يومًا. فكّر في تسليمه إلى {{authority}}.'],
    identity_approved: ['تم التحقق من الهوية', 'تم التحقق من هويتك. لديك الآن شارة الهوية الموثّقة.'],
    identity_rejected: ['لم يتم التحقق من الهوية', 'لم نتمكن من التحقق من هويتك. يمكنك المحاولة مرة أخرى.'],
  },
};

const fill = (tpl, data) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (data[k] ?? '').toString());

export function render(type, data, language = 'en') {
  const lang = T[language] ? language : 'en';
  const tpl = T[lang][type] ?? T.en[type];
  if (!tpl) return { title: 'FoundBack', body: '' };
  const vars = { ...data, category: (CATEGORY[lang] ?? CATEGORY.en)[data.category] ?? CATEGORY.en[data.category] ?? data.category ?? '' };
  return { title: fill(tpl[0], vars), body: fill(tpl[1], vars) };
}

/**
 * Create a notification and deliver it. Never throws (notifications must not
 * break the action that triggered them).
 * @param {{ userId: string, countryCode: string, type: string, data?: object, url?: string }} n
 */
export async function notify({ userId, countryCode, type, data = {}, url = '/' }) {
  try {
    const payload = { ...data, url };
    const { rows } = await query(
      'INSERT INTO notifications (country_code, user_id, type, data) VALUES ($1,$2,$3,$4) RETURNING id',
      [countryCode, userId, type, payload],
    );
    void deliver(rows[0].id, userId, type, payload);
    return rows[0].id;
  } catch (err) {
    logger.error({ err, type }, 'notify failed');
    return null;
  }
}

async function deliver(id, userId, type, data) {
  try {
    const { rows } = await query("SELECT email, language, notification_prefs FROM users WHERE id = $1 AND status = 'active'", [userId]);
    const u = rows[0];
    if (!u) return;
    const { title, body } = render(type, data, u.language);
    const link = `${env.APP_URL}${data.url ?? '/'}`;

    if (u.notification_prefs?.email !== false && u.email) {
      const dir = ['ur', 'ar', 'fa', 'he', 'ps'].includes(u.language) ? 'rtl' : 'ltr';
      await sendEmail({
        to: u.email,
        subject: title,
        text: `${body}\n\n${link}\n\nFoundBack connects people. Meet only in safe public places.`,
        html: `<div dir="${dir}" style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#14272a">
          <h2 style="color:#0f4c4f">${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>
          <p><a href="${link}" style="display:inline-block;background:#0f4c4f;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">FoundBack</a></p>
          <p style="color:#5b6f72;font-size:13px">FoundBack connects people. Meet only in safe public places.</p></div>`,
      });
      await query('UPDATE notifications SET emailed_at = now() WHERE id = $1', [id]);
    }

    if (pushEnabled && u.notification_prefs?.push !== false) {
      const subs = await query('SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = $1', [userId]);
      for (const s of subs.rows) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title, body, url: data.url ?? '/' }), { TTL: 3600 });
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        }
      }
      if (subs.rowCount) await query('UPDATE notifications SET pushed_at = now() WHERE id = $1', [id]);
    }
  } catch (err) {
    logger.warn({ err, type }, 'notification delivery failed');
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const vapidPublicKey = () => env.VAPID_PUBLIC_KEY || null;
