import { z } from "zod";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const eventSchema = z.object({
  kind: z.enum([
    "work",
    "activity",
    "fixed",
    "personal",
    "recovery",
    "off",
    "override",
  ]),
  title: z.string().trim().min(1).max(160),
  date: day,
  endDate: day.optional(),
  time: clock,
  endTime: clock,
  zone: z.string().min(1),
  repeat: z.enum(["once", "weekly", "pattern"]),
  weekdays: z.array(z.number().int().min(1).max(7)),
  until: day.optional(),
  pattern: z.array(z.enum(["day", "night", "recovery", "off"])).min(1),
  category: z.string().max(80),
  location: z.string().max(200),
  notes: z.string().max(4000),
  before: z.number().int().min(0).max(1440),
  after: z.number().int().min(0).max(1440),
  status: z.enum([
    "available",
    "selected",
    "booking",
    "booked",
    "attended",
    "cancelled",
  ]),
  bookingRequired: z.boolean(),
  bookingLead: z.number().int().min(0).max(43200),
  cancellationLead: z.number().int().min(0).max(43200),
  absenceLead: z.number().int().min(0).max(43200),
  required: z.boolean(),
  enabled: z.boolean(),
  overrideMode: z.enum(["replace", "suppress"]),
  workLayer: z.enum(["base", "shift"]).optional(),
  sleepHours: z.number().min(1).max(24).optional(),
  overrideScope: z.enum(["all", "base"]).optional(),
  scheduleGroup: z.string().optional(),
  activityMode: z.enum(["scheduled", "flexible"]).optional(),
  activityFormat: z.enum(["in_person", "online"]).optional(),
  attendanceMode: z.enum(["regular", "booking", "free"]).optional(),
  notifyAbsence: z.boolean().optional(),
  duration: z.number().int().min(1).max(1440).optional(),
  openingTime: clock.optional(),
  closingTime: clock.optional(),
  templateId: z.string().optional(),
  bookingConfirmed: z.boolean().optional(),
  source: z
    .object({
      url: z.string().url(),
      rulesUrl: z.string().url(),
      studio: z.string(),
      trainer: z.string(),
      room: z.string(),
      commercial: z.boolean(),
      capturedAt: z.string(),
      sessionIds: z.array(z.string()),
      dates: z.array(day),
      buffersConfigured: z.boolean(),
    })
    .optional(),
});
export type PlanEvent = z.infer<typeof eventSchema>;
export type ActionKind = "booking" | "cancellation" | "absence" | "conflict";
export interface Action {
  kind: ActionKind;
  occurrenceId: string;
  title: string;
  due: string;
  notifyAt: string;
  status: "pending" | "completed" | "snoozed";
  snoozeUntil?: string;
  completedAt?: string;
  resolvedAutomatically?: boolean;
}
export interface OccurrenceState {
  status: PlanEvent["status"];
  bookingConfirmed?: boolean;
}
export interface Settings {
  zone: string;
  lead: number;
  repeatMinutes: number;
}
export interface Attendance {
  title: string;
  date: string;
}
export type Payload =
  PlanEvent | Action | OccurrenceState | Settings | Attendance;
export interface RemoteRow {
  id: string;
  type: "event" | "action" | "occurrence" | "settings" | "attendance";
  payload: Payload;
  deleted: boolean;
  revision: number;
}
export interface Row extends RemoteRow {
  dirty: boolean;
  mutationId: string;
  conflict?: RemoteRow;
  conflictSource?: "import";
}
export interface Occurrence {
  id: string;
  sourceId: string;
  event: PlanEvent;
  start: number;
  end: number;
  occupiedStart: number;
  occupiedEnd: number;
  original?: boolean;
  replacedBy?: string;
  derivedFromNight?: boolean;
}
export interface Collision {
  id: string;
  a: Occurrence;
  b: Occurrence;
  severity: "hard" | "info";
}
export const defaultSettings: Settings = {
  zone: "Europe/Moscow",
  lead: 1440,
  repeatMinutes: 60,
};
export function newEvent(date: string, zone: string): PlanEvent {
  return {
    kind: "personal",
    title: "",
    date,
    time: "09:00",
    endTime: "10:00",
    zone,
    repeat: "once",
    weekdays: [1, 2, 3, 4, 5],
    pattern: ["day", "night", "recovery", "off"],
    category: "Другое",
    location: "",
    notes: "",
    before: 0,
    after: 0,
    status: "selected",
    bookingRequired: false,
    bookingLead: 1440,
    cancellationLead: 720,
    absenceLead: 1440,
    required: true,
    enabled: true,
    overrideMode: "replace",
  };
}
export const labels: Record<PlanEvent["kind"], string> = {
  work: "Работа",
  activity: "Занятие",
  fixed: "Занятие",
  personal: "Личное",
  recovery: "Отсыпной",
  off: "Выходной",
  override: "Замена графика",
};
export const statuses: Record<PlanEvent["status"], string> = {
  available: "Вариант для посещения",
  selected: "Планирую пойти",
  booking: "Нужна запись",
  booked: "Записан(а)",
  attended: "Посещено",
  cancelled: "Отменено",
};
