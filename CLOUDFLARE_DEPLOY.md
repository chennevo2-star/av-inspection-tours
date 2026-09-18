# פריסה ל-Cloudflare — מדריך

## הבחירה האדריכלית (ולמה)

הועלה כאן במכוון **קונטיינר יחיד** שמריץ את שרת ה-Next.js הקיים כמו שהוא (`Dockerfile` בשורש
הריפו), עם Worker דק מלפניו שרק מנתב אליו בקשות (`worker/index.ts`) — ולא שכתוב של האפליקציה
להרצה על ריצת ה-edge של Workers (למשל דרך מתאם OpenNext).

הסיבה: `apps/web/app/api/report/docx-to-pdf/route.ts` מריץ את LibreOffice האמיתי כתהליך-משנה
(`child_process`) כדי להמיר DOCX ל-PDF — זו החלטה אדריכלית קיימת ומכוונת (ADR-004: ה-PDF תמיד
נגזר מה-DOCX האמיתי דרך LibreOffice, כדי שלעולם לא יהיה פער ביניהם). ריצת-edge של Workers **לא
יכולה** להריץ תהליכי-משנה או קבצי-הרצה (binaries) חיצוניים בשום קונפיגורציה — זו מגבלת פלטפורמה,
לא באג. בנוסף, המתאם הרשמי הנוכחי (`@opennextjs/cloudflare`) כבר הפסיק לתמוך ב-Next.js 14 (האפליקציה
כאן על 14), כך שהמסלול הזה גם דורש שדרוג גרסה מראש.

קונטיינר בודד עוקף את שתי הבעיות: זה סביבת לינוקס אמיתית, אז LibreOffice, driver ה-Postgres
(`postgres` package, חיבור TCP רגיל) והכול ממשיכים לעבוד בדיוק כמו היום, בלי לגעת בקוד האפליקציה
עצמו. המחיר: עלות ריצה קטנה של Workers Paid ($5/חודש) + זמן קונטיינר, ו"קרה" (cold start) בבקשה
הראשונה אחרי תקופת חוסר-פעילות (מוגדר כרגע ל-30 דקות ב-`worker/index.ts`).

**מה זה נותן בפועל, לעומת המצב היום (tunnel):** כתובת URL יציבה שלא מתחלפת (בניגוד ל-quick tunnel
שכבר ראינו נופל/מתחלף), והתוכנה רצה על התשתית של Cloudflare ולא תלויה שהמחשב האישי שלך יישאר דלוק.

## שני דברים שאני לא יכול להכין בשבילך

1. **Postgres אמיתי בענן.** ל-Cloudflare אין מוצר Postgres מנוהל משלה, ובסביבת הפיתוח כאן
   רץ עד היום רק PGlite מקומי (ADR-007) — כלומר **אין עדיין שום Postgres אמיתי בפרודקשן**. הכי
   פשוט: [Neon](https://neon.tech) — יש להם tier חינמי, וזה אותו driver (`postgres` package) שכבר
   בשימוש כאן, אז שינוי הוא רק ב-connection string. חלופות: Supabase, או Postgres בקונטיינר נפרד.
2. **הרשאה בפועל ל-Cloudflare.** אני לא יכול (ולא אמור) להתחבר לחשבון ה-Cloudflare שלך. את
   `wrangler login` ואת `wrangler deploy` בסוף התהליך צריך להריץ אתה.

## שלבים

### 1. התקנת כלי ה-deploy (עוד לא בפרויקט)

```bash
npm install -D wrangler@latest @cloudflare/containers@latest
```

(השארתי את זה בחוץ מ-`package.json` בכוונה — Containers הוא מוצר בטא שמתעדכן מהר, עדיף שתביא את
הגרסה האמיתית העדכנית ביותר מול ה-registry, לא מספר שאני מנחש.)

### 2. התחברות ל-Cloudflare

```bash
npx wrangler login
```

### 3. ודא ש-Containers פעיל בחשבון שלך

זה מוצר ב-**public beta**, דורש תוכנית Workers Paid ($5/חודש). בדוק בדשבורד
(Workers & Pages → Containers) שהוא זמין לפני שממשיכים — זה משהו שרק אתה יכול לאשר.

### 4. יצירת bucket ב-R2 (מחליף את ה-S3/MinIO של הפיתוח המקומי)

בדשבורד: R2 → Create bucket (שם לדוגמה: `av-inspection-tours-files`), ואז
R2 → Manage API Tokens → צור טוקן עם הרשאת קריאה/כתיבה ל-bucket הזה. שמור את ה-Access Key ID
וה-Secret — אלה יוזנו כ-secrets בשלב 6. כתובת ה-endpoint היא:
`https://<account_id>.r2.cloudflarestorage.com` (ה-account_id מופיע בדשבורד).

`packages/storage/src/s3-storage.ts` כבר מדבר S3 API רגיל — R2 תואם S3, אז **אין שום שינוי קוד**.

### 5. הקמת Postgres אמיתי

ראה סעיף "שני דברים שאני לא יכול להכין בשבילך" למעלה. שמור את ה-connection string המלא
(`postgres://user:pass@host/db`).

לאחר שיש connection string אמיתי, תריץ הרצת מיגרציות **פעם אחת** מהמחשב שלך מול ה-DB החדש:

```bash
DATABASE_URL="postgres://..." npm run db:migrate -w packages/db
```

### 6. הגדרת secrets (לא נכנסים ל-git, לא ל-wrangler.toml)

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
```

וב-`wrangler.toml` תחת `[vars]` (לא סודי, מותר בקובץ) תעדכן/תוסיף:

```toml
[vars]
S3_ENDPOINT = "https://<account_id>.r2.cloudflarestorage.com"
S3_BUCKET = "av-inspection-tours-files"
```

(`ANTHROPIC_API_KEY` כ-secret נוסף רק כשמפעילים מחדש את צינור ה-AI המושהה כרגע — לא נדרש היום.)

### 7. פריסה

```bash
npm run deploy:cloudflare
```

הפעם הראשונה תבנה את ה-Docker image (כולל התקנת LibreOffice — יכולה לקחת כמה דקות) ותפרוס את
ה-Worker. הפלט של הפקודה יכלול את כתובת ה-URI היציבה של הפריסה (`*.workers.dev` כברירת מחדל, אלא
אם תגדיר route/דומיין משלך).

## מה עוד לבדוק אחרי הפריסה הראשונה

Containers הוא מוצר בטא — לא הצלחתי להריץ/לבדוק deploy אמיתי מהסביבה הזו (אין לי גישה לחשבון
Cloudflare שלך, וגם אין Docker מותקן כאן כדי לבדוק את ה-build באופן מקומי). הקבצים כאן בנויים בקפידה
לפי התיעוד הרשמי העדכני של Cloudflare, אבל כדאי לבדוק בפועל:
- שה-build של ה-Docker image מצליח (`docker build .` מקומית, אם יש Docker, לפני ה-deploy הראשון).
- ש-`docx-to-pdf` עובד בקונטיינר האמיתי (לא רק מקומית על Windows) — יש הבדלים ידועים בין
  גרסאות/פונטים של LibreOffice בין מערכות הפעלה.
- זמן ה-cold start בפועל אחרי שינה (`sleepAfter = "30m"`) — אם מרגיש איטי מדי, אפשר להעלות את הזמן
  או לוותר על השינה (בעלות גבוהה יותר).

## עדכון סטטוס (2026-09-18)

שני דברים השתנו מאז שהמדריך הזה נכתב:

1. **יצירת ה-PDF כבר לא תלויה ב-LibreOffice כברירת מחדל** — יש מנוע חדש בקוד טהור (pdf-lib + bidi-js
   + פונט עברי מוטמע), נבדק מקצה-לקצה מול שרת אמיתי. LibreOffice עדיין קיים כנתיב חלופי מפורש
   (`PDF_ENGINE=libreoffice`), לא נמחק. זה אומר שהקונטיינר הזה כבר לא **חייב** LibreOffice בשביל
   ה-PDF — הוא עדיין מותקן ב-Dockerfile ליתר ביטחון, אבל ברירת המחדל היא המנוע החדש.
2. **אין Docker מקומי בשום סביבה זמינה** — `npm run deploy:cloudflare` נכשל בפועל עם השגיאה
   "The Docker CLI is needed to build the configured image but could not be launched". הפתרון
   שאומץ בפועל: **Cloudflare Workers Builds** — חיבור ה-repository הזה (GitHub) ישירות ל-Worker
   `av-inspection-tours` דרך הדשבורד (Settings → Builds → Connect), כך שהבנייה (כולל Docker) קורית
   בענן של Cloudflare עצמם, לא אצלך. חשוב: ה-build הראשון לא מופעל אוטומטית מהחיבור עצמו — צריך
   push חדש (commit כלשהו) אחרי שהחיבור הושלם כדי שהבנייה הראשונה תתחיל.

Postgres אמיתי (Neon) הוקם והמיגרציות רצו נגדו בהצלחה; R2 bucket + API token הוגדרו; שלושת
ה-secrets (`DATABASE_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) הוגדרו דרך `wrangler secret
put`. הפריסה עצמה (build ראשון דרך Workers Builds) בתהליך.
