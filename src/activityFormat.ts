import type { PlanEvent } from "./model";
export function activityFormat(e: PlanEvent): "in_person" | "online" {
  if (e.activityFormat) return e.activityFormat;
  // The owner's existing Spanish lessons are online; explicit saved choices always win.
  const title = e.title.normalize("NFKC").toLocaleLowerCase("ru");
  return !e.source && /испанск|español|espanol|spanish/u.test(title)
    ? "online"
    : "in_person";
}
export function onlineDuringWork(a: PlanEvent, b: PlanEvent) {
  return (
    (a.kind === "work" &&
      ["activity", "fixed"].includes(b.kind) &&
      activityFormat(b) === "online") ||
    (b.kind === "work" &&
      ["activity", "fixed"].includes(a.kind) &&
      activityFormat(a) === "online")
  );
}
