import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { InspectionExtraction } from "@av-inspection/shared-types";
import type { ExtractionReferenceData } from "./reference-data.js";

/**
 * Claude tool definition for the Extraction Agent — forcing tool use (see extraction-agent.ts's
 * `tool_choice`) is far more reliable than asking for bare JSON in prose, and generating the schema from
 * the same Zod schema InspectionExtraction.safeParse() validates against means the two can never drift
 * out of sync with each other. The cast is pragmatic: zod-to-json-schema's output is a real JSON Schema
 * object (and does have `type: "object"` at runtime for a z.object() schema) but its generic return type
 * is wider than Anthropic's specific InputSchema type, which a general-purpose generator can't target
 * without a much heavier custom schema conversion.
 */
export const EXTRACTION_TOOL_SCHEMA: Anthropic.Tool = {
  name: "record_inspection_extraction",
  description:
    "רושם את הממצאים, המשימות והשיוכים המובנים שחולצו מתמלול סיור פיקוח עליון במערכות AV, לפי הסכמה הנתונה.",
  input_schema: zodToJsonSchema(InspectionExtraction) as Anthropic.Tool["input_schema"],
};

export interface ExtractionPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `אתה עוזר המסייע לחלץ ממצאי פיקוח מתומלול של סיור פיקוח עליון במערכות מולטימדיה (AV).

כללים מחייבים, ללא יוצא מן הכלל:
1. אסור לך להמציא קבלן, חדר או קומה שאינם ברשימות המסופקות לך. כל floorId / roomId / responsibleContractorId / secondaryResponsibleContractorId שאתה מחזיר חייב להיות בדיוק אחד מה-IDs שסופקו — לעולם לא ID מומצא, גם אם אתה "די בטוח" למה הכוונה. אם אינך בטוח באיזה קבלן/חדר/קומה מדובר, החזר null עבור השדה וסמן needsUserReview=true.
2. confidence הוא מספר בין 0 ל-1 המבטא את רמת הביטחון שלך בשיוך שביצעת.
3. אם המשתמש מזכיר בקול שמשימה פתוחה קיימת (מהרשימה שסופקה) הושלמה/טופלה — הוסף אותה למערך previousTaskUpdates עם existingTaskId, newStatus מתאים, ו-evidence מצוטט מהתמלול. אל תיצור עבורה גם finding כפול במערך findings.
4. inspectionSummary הוא סיכום קצר, ברור, בעברית תקנית של הסיור כולו.
5. כל שדה טקסט חופשי (subject, finding, requiredAction, description) חייב להיות בעברית תקנית ומקצועית, גם כאשר מוזכרים בו מונחים/דגמים באנגלית (HDMI, Poly, Crestron וכו') — אלה נשארים באנגלית בתוך המשפט העברי.
6. photoAssociations משייך תמונה (לפי photoId מהרשימה) לממצא (findingIndex — האינדקס של הממצא במערך findings) רק כאשר יש רמז ברור בתמלול (למשל "דבר על התמונה" בסמיכות זמן/הקשר לממצא).`;

export function buildExtractionPrompt(transcript: string, reference: ExtractionReferenceData): ExtractionPrompt {
  const lines: string[] = [];

  lines.push(`## פרויקט: ${reference.projectName}`);
  lines.push("");

  lines.push("## קומות זמינות (floorId — שם):");
  if (reference.floors.length === 0) lines.push("(לא הוגדרו קומות בפרויקט)");
  for (const floor of reference.floors) lines.push(`- ${floor.id} — ${floor.name}`);
  lines.push("");

  lines.push("## חדרים זמינים (roomId — שם — קומה):");
  if (reference.rooms.length === 0) lines.push("(לא הוגדרו חדרים בפרויקט)");
  for (const room of reference.rooms) lines.push(`- ${room.id} — ${room.name} (floorId: ${room.floorId})`);
  lines.push("");

  lines.push("## קבלנים זמינים (contractorId — שם — כינויים אפשריים):");
  if (reference.contractors.length === 0) lines.push("(לא הוגדרו קבלנים בפרויקט)");
  for (const contractor of reference.contractors) {
    const aliasSuffix = contractor.aliases.length > 0 ? ` (כינויים: ${contractor.aliases.join(", ")})` : "";
    lines.push(`- ${contractor.id} — ${contractor.companyName}${aliasSuffix}`);
  }
  lines.push("");

  lines.push("## משימות פתוחות מסיורים קודמים (taskId — מספר — תיאור):");
  if (reference.openTasks.length === 0) lines.push("(אין משימות פתוחות)");
  for (const task of reference.openTasks) {
    lines.push(`- ${task.id} — #${task.friendlyNumber ?? "?"} — ${task.description}`);
  }
  lines.push("");

  lines.push("## תמונות שצולמו במהלך הסיור (photoId — זמן יחסי מתחילת הסיור — כיתוב):");
  if (reference.photos.length === 0) lines.push("(לא צולמו תמונות בסיור זה)");
  for (const photo of reference.photos) {
    const captionSuffix = photo.caption ? ` — ${photo.caption}` : "";
    lines.push(`- ${photo.id} — ${Math.round(photo.approxTimestampSeconds)} שניות${captionSuffix}`);
  }
  lines.push("");

  lines.push("## תמלול הסיור:");
  lines.push(transcript.trim() || "(לא הוקלט/תומלל דבר בסיור זה)");

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}
