import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveQuery } from "dexie-react-hooks";
import { DateTime } from "luxon";
import {
  CalendarDays,
  Layers,
  Activity,
  ListTodo,
  Settings2,
  Plus,
  ArrowUpRight,
  X,
  Check,
  Clock3,
  AlertTriangle,
  Cloud,
  RefreshCw,
  Download,
  Upload,
  Bell,
  LogOut,
  Moon,
  CalendarCheck2,
  BarChart3,
} from "lucide-react";
import { registerSW } from "virtual:pwa-register";
import {
  type PlanEvent,
  type Row,
  type Action,
  type Settings,
  defaultSettings,
  newEvent,
  labels,
  eventSchema,
} from "./model";
import {
  expand,
  effectiveSchedule,
  conflicts,
  requiredActions,
  reconcileActionRows,
  actionState,
  validateEvent,
} from "./engine";
import {
  db,
  cloud,
  selectAccount,
  save,
  remove,
  sync,
  resolve,
  exportBackup,
  importBackup,
  enablePush,
  setStatus,
  finishAction,
} from "./store";
import "./style.css";
import { EventEditor } from "./EventEditor";
import { installStudioCatalog } from "./catalogSeed";
import { LeadTimeField } from "./LeadTimeField";
import { WorkSettings } from "./WorkSettings";
import { CatalogView } from "./CatalogView";
import { PlannerCalendar } from "./PlannerCalendar";
import { AttendanceView } from "./AttendanceView";
import {
  calendarStart,
  isActivity,
  attendanceMode,
  activityFormat,
} from "./planning";

type Section =
  "calendar" | "activities" | "actions" | "settings" | "attendance";
const nav = [
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "activities", label: "Мои занятия", icon: Activity },
  { id: "attendance", label: "Посещения", icon: BarChart3 },
  { id: "actions", label: "Центр действий", icon: ListTodo },
  { id: "settings", label: "Настройки", icon: Settings2 },
] as const;
const format = (n: number, zone: string, pattern = "HH:mm") =>
  DateTime.fromMillis(n, { zone }).setLocale("ru").toFormat(pattern);
const savedMinute = (time?: string) =>
  typeof time === "string" ? Math.floor(Date.parse(time) / 60000) : NaN;

function App() {
  const [account, setAccount] = useState<string | undefined>();
  const [recovery, setRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<Section>("calendar");
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState<DateTime>(
    DateTime.now().setZone("Europe/Moscow").startOf("day"),
  );
  const [selected, setSelected] = useState(cursor.toISODate()!);
  const [editor, setEditor] = useState<{
    event: PlanEvent;
    id?: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [reviewVersions, setReviewVersions] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [history, setHistory] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [now, setNow] = useState(Date.now());
  const rows =
    useLiveQuery<Row[]>(
      async () => (ready ? await db.rows.toArray() : []),
      [ready, account],
    ) || [];
  const lastSync = useLiveQuery<{ key: string; value: string } | undefined>(
    async () => (ready ? await db.meta.get("lastSync") : undefined),
    [ready, account],
  );
  const settings =
    (rows.find((r) => r.id === "settings" && !r.deleted)
      ?.payload as Settings) || defaultSettings;
  const zone = settings.zone;
  const act = (fn: () => Promise<unknown>, success?: string) => {
    void fn()
      .then(() => {
        if (success) setMessage(success);
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    let disposed = false;
    let chain = Promise.resolve();
    let opened = false;
    let currentAccount: string | undefined;
    const change = (id?: string, mail = "") => {
      chain = chain
        .then(async () => {
          if (disposed) return;
          if (opened && currentAccount === id) {
            setEmail(mail);
            return;
          }
          setReady(false);
          await selectAccount(id);
          if (disposed) return;
          try {
            const added = await installStudioCatalog(db);
            if (added)
              setMessage(
                `В каталог добавлено расписание «Весны»: ${added} строк. Посещения выбирайте самостоятельно.`,
              );
          } catch (error) {
            setMessage(
              `Не удалось добавить расписание студии: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (disposed) return;
          opened = true;
          currentAccount = id;
          setAccount(id);
          setEmail(mail);
          setReady(true);
        })
        .catch((error) =>
          setMessage(`Не удалось открыть локальную базу: ${error.message}`),
        );
    };
    if (cloud) {
      cloud.auth
        .getSession()
        .then(({ data }) =>
          change(data.session?.user.id, data.session?.user.email),
        );
      const { data } = cloud.auth.onAuthStateChange((_event, session) => {
        if (_event === "PASSWORD_RECOVERY") {
          setRecovery(true);
          setSection("settings");
        }
        change(session?.user.id, session?.user.email);
      });
      return () => {
        disposed = true;
        data.subscription.unsubscribe();
      };
    }
    change();
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener("online", fn);
    window.addEventListener("offline", fn);
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.removeEventListener("online", fn);
      window.removeEventListener("offline", fn);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setCursor((c) => c.setZone(zone, { keepLocalTime: true }));
  }, [zone]);
  useEffect(() => {
    const updater = registerSW({
      onNeedRefresh() {
        setUpdate(() => () => void updater(true));
      },
      onOfflineReady() {
        setMessage("Приложение готово к работе без интернета.");
      },
    });
  }, []);
  const doSync = async () => {
    setSyncing(true);
    try {
      await sync();
    } finally {
      setSyncing(false);
    }
  };
  const dirty = rows
    .filter((r) => r.dirty && !r.conflict)
    .map((r) => r.mutationId)
    .join(",");
  useEffect(() => {
    if (!ready || !account || !online) return;
    const t = setTimeout(() => {
      void doSync().catch((e) => setMessage(`Синхронизация: ${e.message}`));
    }, 1500);
    return () => clearTimeout(t);
  }, [dirty, ready, account, online]);
  useEffect(() => {
    if (!account || !online || !ready) return;
    const t = setInterval(
      () => void doSync().catch((e) => setMessage(e.message)),
      60000,
    );
    const onFocus = () => void doSync().catch((e) => setMessage(e.message));
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [account, online, ready]);
  const rangeStart = calendarStart(cursor, view);
  const rangeEnd =
    view === "month"
      ? rangeStart.plus({ days: 42 })
      : rangeStart.plus({ days: 7 });
  const schedule = useMemo(
    () => effectiveSchedule(expand(rows, rangeStart, rangeEnd)),
    [rows, rangeStart.toISO(), rangeEnd.toISO()],
  );
  const collisionList = useMemo(
    () => conflicts(schedule.effective),
    [schedule],
  );
  const horizon = DateTime.fromMillis(now, { zone }).startOf("day");
  const reminderSchedule = useMemo(
    () =>
      effectiveSchedule(
        expand(rows, horizon.minus({ days: 7 }), horizon.plus({ days: 90 })),
      ).effective,
    [rows, horizon.toISO()],
  );
  const needed = useMemo(
    () =>
      requiredActions(reminderSchedule, conflicts(reminderSchedule), settings),
    [reminderSchedule, settings],
  );
  useEffect(() => {
    if (!ready) return;
    const changes = reconcileActionRows(rows, needed, reminderSchedule);
    if (changes.length)
      act(async () => {
        await db.transaction("rw", db.rows, async () => {
          for (const c of changes) await save("action", c.payload, c.id);
        });
      });
  }, [needed, ready]);
  const actions = rows
    .filter((r) => r.type === "action" && !r.deleted)
    .sort(
      (a, b) =>
        Date.parse((a.payload as Action).due) -
        Date.parse((b.payload as Action).due),
    );
  const pending = actions.filter(
    (r) => (r.payload as Action).status !== "completed",
  );
  const due = pending.filter((r) => {
    const a = r.payload as Action;
    return Date.parse(a.notifyAt) <= now && actionState(a, now) !== "snoozed";
  });
  const syncConflicts = rows.filter((r) => r.conflict);
  const events = rows.filter((r) => r.type === "event" && !r.deleted);
  const booked = schedule.effective.filter(
    (o) => o.event.kind === "activity" && o.event.status === "booked",
  ).length;
  const openEditor = (kind: PlanEvent["kind"] = "personal") =>
    setEditor({
      event: {
        ...newEvent(selected, zone),
        kind,
        status: kind === "activity" ? "available" : "selected",
        ...(kind === "activity"
          ? {
              repeat: "weekly" as const,
              weekdays: [],
              activityMode: "scheduled" as const,
              attendanceMode: "free" as const,
              category: "",
            }
          : {}),
      },
    });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setSection("calendar");
          }}
        >
          <span className="brand-mark">ııı</span>ритм
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={section === n.id ? "active" : ""}
              onClick={() => setSection(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "actions" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-tip">
          <Moon size={20} />
          <p>В вашем ритме</p>
          <span>Работа, движение и время для себя — в одном месте.</span>
        </div>
        <button className="account" onClick={() => setSection("settings")}>
          <span className="avatar">Я</span>
          <span>
            <strong>{account ? "Мой аккаунт" : "Локальный профиль"}</strong>
            <small>
              {account ? "Облачная синхронизация" : "Сохраняется на устройстве"}
            </small>
          </span>
          <Settings2 size={15} />
        </button>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Моё пространство <span>/</span>{" "}
            <strong>{nav.find((n) => n.id === section)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection ${online ? "" : "offline"}`}>
              <span /> {online ? "Онлайн" : "Без интернета"}
            </span>
            <button
              className="icon-button"
              title="Центр действий"
              onClick={() => setSection("actions")}
            >
              <Bell size={19} />
              {due.length > 0 && <i />}
            </button>
            <span className="avatar small">Я</span>
          </div>
        </header>
        <div className="page">
          <div className="page-title">
            <div>
              <div className="eyebrow">ПЛАНИРУЙТЕ В СВОЁМ ТЕМПЕ</div>
              <h1>
                {section === "attendance"
                  ? "Где вы были"
                  : section === "calendar"
                    ? "Время для важного"
                    : section === "activities"
                      ? "Ваши занятия"
                      : section === "actions"
                        ? "Ничего не упустить"
                        : "Ваши правила"}
              </h1>
              <p>
                {section === "attendance"
                  ? "Цветные отметки по дням и количество посещений за месяц."
                  : section === "calendar"
                    ? "Смены, занятия и личные планы. Весь ваш день — перед глазами."
                    : section === "activities"
                      ? "Расписание, запись и свободные посещения — в одном каталоге."
                      : section === "actions"
                        ? "Записи, дедлайны и напоминания — до вашего подтверждения."
                        : "График работы, часовой пояс и сохранность ваших данных."}
              </p>
            </div>
            {section !== "settings" && section !== "attendance" && (
              <button
                className="primary"
                onClick={() =>
                  openEditor(section === "activities" ? "activity" : "personal")
                }
              >
                <Plus size={18} />
                {section === "activities"
                  ? "Добавить занятие"
                  : "Добавить событие"}
              </button>
            )}
          </div>
          {update && (
            <div className="notice">
              Доступна новая версия. Сначала дождитесь сохранения изменений.{" "}
              <button onClick={update}>Обновить приложение</button>
            </div>
          )}
          {syncConflicts.length > 0 && section !== "settings" && (
            <div className="notice warning">
              <AlertTriangle size={18} /> Сохранены разные версии{" "}
              {syncConflicts.length} записей.{" "}
              <button
                onClick={() => {
                  setReviewVersions(true);
                  setSection("settings");
                }}
              >
                Выбрать версии
              </button>
            </div>
          )}
          {due.length > 0 && section !== "actions" && (
            <button
              className="action-banner"
              onClick={() => setSection("actions")}
            >
              <span className="banner-icon">
                <Bell size={19} />
              </span>
              <span>
                <strong>Требуют внимания: {due.length}</strong>
                <small>{(due[0].payload as Action).title}</small>
              </span>
              <ArrowUpRight size={19} />
            </button>
          )}
          {section === "calendar" && (
            <>
              <div className="stats">
                <div>
                  <span className="stat-icon work">
                    <Layers size={20} />
                  </span>
                  <span>
                    <small>Рабочие смены</small>
                    <strong>
                      {
                        schedule.effective.filter(
                          (o) => o.event.kind === "work",
                        ).length
                      }
                      <em> в периоде</em>
                    </strong>
                  </span>
                </div>
                <div>
                  <span className="stat-icon activity">
                    <Activity size={20} />
                  </span>
                  <span>
                    <small>Записи на занятия</small>
                    <strong>
                      {booked}
                      <em> подтверждено</em>
                    </strong>
                  </span>
                </div>
                <div>
                  <span className="stat-icon personal">
                    <CalendarCheck2 size={20} />
                  </span>
                  <span>
                    <small>Личные планы</small>
                    <strong>
                      {
                        schedule.effective.filter((o) =>
                          ["personal", "fixed"].includes(o.event.kind),
                        ).length
                      }
                      <em> событий</em>
                    </strong>
                  </span>
                </div>
                <div>
                  <span
                    className={`stat-icon ${collisionList.some((c) => c.severity === "hard") ? "danger" : "recovery"}`}
                  >
                    <AlertTriangle size={20} />
                  </span>
                  <span>
                    <small>Конфликты планов</small>
                    <strong>
                      {
                        collisionList.filter((c) => c.severity === "hard")
                          .length
                      }
                      <em> конфликтов</em>
                    </strong>
                  </span>
                </div>
              </div>
              <PlannerCalendar
                items={schedule.effective}
                rows={rows}
                zone={zone}
                view={view}
                setView={setView}
                cursor={cursor}
                setCursor={setCursor}
                selected={selected}
                setSelected={setSelected}
                onEdit={(event, id) => setEditor({ event, id })}
                onAdd={(date) => setEditor({ event: newEvent(date, zone) })}
                onWorkSettings={() => setSection("settings")}
                report={setMessage}
              />
              <div className="under-calendar">
                <span>
                  <Cloud size={14} />
                  {lastSync
                    ? `Синхронизация: ${format(Date.parse(lastSync.value), zone, "d LLL HH:mm")}`
                    : "Данные на этом устройстве"}{" "}
                  · {rows.filter((r) => r.dirty).length} в очереди
                </span>
                <button
                  className="text-button"
                  onClick={() => setShowOriginal(!showOriginal)}
                >
                  <Layers size={14} />
                  {showOriginal
                    ? "Скрыть исходный график"
                    : "Слои и исходный график"}
                </button>
              </div>
              {showOriginal && (
                <section className="card">
                  <h3>Исходный и действующий график</h3>
                  <p>
                    Замены обрезают рабочие интервалы только на время своего
                    действия. Исходные события сохраняются. При пересечении
                    замен приоритет определяет стабильный идентификатор записи
                    (больший — выше).
                  </p>
                  {schedule.originals.map((o) => (
                    <p key={`${o.id}:${o.replacedBy}`}>
                      <span className="badge">Заменено</span> {o.event.title} ·{" "}
                      {format(o.start, zone, "d LLL HH:mm")}–
                      {format(o.end, zone, "d LLL HH:mm")}
                    </p>
                  ))}
                  {events
                    .filter((r) => (r.payload as PlanEvent).kind === "override")
                    .map((r) => (
                      <div className="record-line" key={r.id}>
                        <span>
                          {(r.payload as PlanEvent).title} ·{" "}
                          {(r.payload as PlanEvent).enabled
                            ? "Активная замена"
                            : "Отключена"}
                        </span>
                        <button
                          onClick={() =>
                            setEditor({
                              id: r.id,
                              event: r.payload as PlanEvent,
                            })
                          }
                        >
                          Изменить
                        </button>
                        <button
                          onClick={() =>
                            act(() =>
                              save(
                                "event",
                                {
                                  ...(r.payload as PlanEvent),
                                  enabled: !(r.payload as PlanEvent).enabled,
                                },
                                r.id,
                              ),
                            )
                          }
                        >
                          {(r.payload as PlanEvent).enabled
                            ? "Восстановить исходный"
                            : "Включить замену"}
                        </button>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {section === "activities" && (
            <CatalogView
              rows={rows}
              items={reminderSchedule}
              zone={zone}
              selected={selected}
              onEdit={(event, id) => setEditor({ event, id })}
              report={setMessage}
            />
          )}
          {section === "attendance" && (
            <AttendanceView rows={rows} zone={zone} report={setMessage} />
          )}
          {section === "actions" && (
            <>
              <div className="section-line">
                <div className="segmented">
                  <button
                    className={!history ? "chosen" : ""}
                    onClick={() => setHistory(false)}
                  >
                    К выполнению · {pending.length}
                  </button>
                  <button
                    className={history ? "chosen" : ""}
                    onClick={() => setHistory(true)}
                  >
                    История · {actions.length - pending.length}
                  </button>
                </div>
                <span>Напоминания не отправляют сообщения за вас</span>
              </div>
              <div className="actions-list">
                {actions
                  .filter(
                    (r) =>
                      ((r.payload as Action).status === "completed") ===
                      history,
                  )
                  .map((r) => {
                    const a = r.payload as Action;
                    const state = actionState(a, now);
                    return (
                      <article
                        className={`card action-card ${state}`}
                        key={r.id}
                      >
                        <span className="action-icon">
                          {state === "completed" ? (
                            <Check size={21} />
                          ) : a.kind === "conflict" ? (
                            <AlertTriangle size={21} />
                          ) : (
                            <Bell size={21} />
                          )}
                        </span>
                        <div className="action-copy">
                          <div className="action-meta">
                            <span>
                              {a.kind === "booking"
                                ? "ЗАПИСЬ"
                                : a.kind === "absence"
                                  ? "УВЕДОМЛЕНИЕ О ПРОПУСКЕ"
                                  : a.kind === "cancellation"
                                    ? "ОТМЕНА ЗАПИСИ"
                                    : "КОНФЛИКТ"}
                            </span>
                            <span
                              className={`badge ${state === "overdue" ? "red" : ""}`}
                            >
                              {state === "overdue"
                                ? "Просрочено"
                                : state === "snoozed"
                                  ? "Отложено"
                                  : state === "completed"
                                    ? "Выполнено"
                                    : "Ожидает"}
                            </span>
                          </div>
                          <h3>{a.title}</h3>
                          <p>
                            Срок:{" "}
                            {format(
                              Date.parse(a.due),
                              zone,
                              "d LLLL yyyy, HH:mm",
                            )}
                            {state === "snoozed"
                              ? ` · До ${format(Date.parse(a.snoozeUntil!), zone, "d LLL HH:mm")}`
                              : ""}
                          </p>
                          {!needed.has(r.id) && !history && (
                            <small>
                              Условие изменилось или событие вне ближайших 90
                              дней. Проверьте действие и завершите вручную.
                            </small>
                          )}
                          {history && a.completedAt && (
                            <small>
                              Выполнено{" "}
                              {format(
                                Date.parse(a.completedAt),
                                zone,
                                "d LLL yyyy HH:mm",
                              )}
                            </small>
                          )}
                        </div>
                        {!history && (
                          <div className="action-controls">
                            <button
                              className="subtle"
                              onClick={() =>
                                act(() =>
                                  save(
                                    "action",
                                    {
                                      ...a,
                                      status: "snoozed",
                                      snoozeUntil: new Date(
                                        now + 3600000,
                                      ).toISOString(),
                                    },
                                    r.id,
                                  ),
                                )
                              }
                            >
                              <Clock3 size={15} /> На час
                            </button>
                            <button
                              className="primary"
                              onClick={() => act(() => finishAction(r))}
                            >
                              <Check size={16} />
                              {a.kind === "booking"
                                ? "Записан(а)"
                                : a.kind === "absence"
                                  ? "Школа уведомлена"
                                  : a.kind === "cancellation"
                                    ? "Запись отменена"
                                    : "Выполнено"}
                            </button>
                            {a.kind === "booking" && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  act(async () => {
                                    await setStatus(
                                      a.occurrenceId,
                                      "available",
                                    );
                                    await save(
                                      "action",
                                      {
                                        ...a,
                                        status: "completed",
                                        completedAt: new Date().toISOString(),
                                      },
                                      r.id,
                                    );
                                  })
                                }
                              >
                                Не пойду
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
              {actions.filter(
                (r) =>
                  ((r.payload as Action).status === "completed") === history,
              ).length === 0 && (
                <Empty
                  icon={<ListTodo size={32} />}
                  title={history ? "История пока пуста" : "Всё спокойно"}
                  text={
                    history
                      ? "Завершённые действия сохраняются здесь."
                      : "Когда понадобится записаться, сообщить о пропуске или разобрать конфликт, действие появится здесь."
                  }
                />
              )}
              <p className="footnote">
                В приложении действия сохраняются до вашего подтверждения. Push
                требует настройки сервера и разрешения устройства; доставка в
                фоне зависит от платформы.
              </p>
            </>
          )}
          {section === "settings" && (
            <div className="settings-grid">
              {syncConflicts.length > 0 && (
                <section
                  className="card sync-conflicts"
                  aria-labelledby="sync-versions-heading"
                >
                  <div className="sync-conflicts-heading">
                    <h2 id="sync-versions-heading">
                      Разные версии · {syncConflicts.length}
                    </h2>
                    <button
                      aria-expanded={reviewVersions}
                      onClick={() => setReviewVersions(!reviewVersions)}
                    >
                      {reviewVersions ? "Свернуть" : "Выбрать версии"}
                    </button>
                  </div>
                  {reviewVersions && (
                    <>
                      <p className="footnote">
                        Пометка «Новее» сравнивает время сохранения, если оно
                        известно у обеих версий.
                      </p>
                      <ul className="sync-versions">
                        {syncConflicts.map((r) => {
                          const other = r.conflict;
                          if (!other) return null;
                          const fromBackup = r.conflictSource === "import";
                          const localTime = savedMinute(r.updated_at);
                          const otherTime = savedMinute(other.updated_at);
                          const versions = [
                            {
                              choice: "local",
                              source: "Локальная",
                              action: "Оставить локальную",
                              time: localTime,
                              newer: localTime > otherTime,
                              deleted: r.deleted,
                            },
                            {
                              choice: "remote",
                              source: fromBackup
                                ? "Из резервной копии"
                                : "Облачная",
                              action: fromBackup
                                ? "Принять из копии"
                                : "Оставить облачную",
                              time: otherTime,
                              newer: otherTime > localTime,
                              deleted: other.deleted,
                            },
                          ] as const;
                          const [eventId, date] = r.id.slice(4).split("@");
                          const occurrenceTitle =
                            r.type === "occurrence"
                              ? (
                                  events.find((event) => event.id === eventId)
                                    ?.payload as PlanEvent | undefined
                                )?.title
                              : undefined;
                          const title =
                            "title" in r.payload
                              ? r.payload.title
                              : r.type === "settings"
                                ? "Настройки"
                                : occurrenceTitle || "Статус занятия";
                          return (
                            <li className="sync-version-row" key={r.id}>
                              <div className="sync-version-title">
                                <strong>{title}</strong>
                                {r.type === "occurrence" && date && (
                                  <small>{date}</small>
                                )}
                                {(Number.isNaN(localTime) ||
                                  Number.isNaN(otherTime)) && (
                                  <small>Какая новее — неизвестно</small>
                                )}
                                {r.type === "event" && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      act(() => resolve(r.id, "both"))
                                    }
                                  >
                                    Сохранить обе
                                  </button>
                                )}
                              </div>
                              {versions.map((version) => (
                                <div key={version.choice}>
                                  <strong>{version.source}</strong>
                                  {version.newer && (
                                    <span className="version-newer">Новее</span>
                                  )}
                                  <small>
                                    {Number.isFinite(version.time)
                                      ? format(
                                          version.time * 60000,
                                          zone,
                                          "d LLL yyyy HH:mm",
                                        )
                                      : "Дата неизвестна"}
                                    {version.deleted && " · Удалена"}
                                  </small>
                                  <button
                                    onClick={() =>
                                      act(() => resolve(r.id, version.choice))
                                    }
                                  >
                                    {version.action}
                                  </button>
                                </div>
                              ))}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </section>
              )}
              <section className="card">
                <h2>Общие настройки</h2>
                <label>
                  Часовой пояс
                  <input
                    key={zone}
                    defaultValue={zone}
                    list="zones"
                    onBlur={(e) => {
                      try {
                        new Intl.DateTimeFormat("ru", {
                          timeZone: e.target.value,
                        });
                        act(() =>
                          save(
                            "settings",
                            { ...settings, zone: e.target.value },
                            "settings",
                          ),
                        );
                      } catch {
                        e.target.value = zone;
                        setMessage(
                          "Укажите действующий часовой пояс IANA, например Europe/Moscow.",
                        );
                      }
                    }}
                  />
                  <datalist id="zones">
                    {[
                      "Europe/Moscow",
                      "Europe/London",
                      "Europe/Berlin",
                      "Asia/Yekaterinburg",
                      "Asia/Dubai",
                      "Asia/Tokyo",
                      "America/New_York",
                      "UTC",
                    ].map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </label>
                <p className="footnote">
                  События хранят свой часовой пояс. Здесь меняется отображение;
                  новые события используют выбранный пояс.
                </p>
                <LeadTimeField
                  label="Первое напоминание до крайнего срока"
                  value={settings.lead}
                  onChange={(lead) =>
                    act(() =>
                      save("settings", { ...settings, lead }, "settings"),
                    )
                  }
                />
                <p className="footnote">
                  Это запас перед сроком самого действия. Если сообщить нужно за
                  сутки до занятия и здесь выбрано «За сутки», напоминание
                  начнётся за двое суток до занятия.
                </p>
                <LeadTimeField
                  label="Повторять уведомление, пока действие не выполнено"
                  value={settings.repeatMinutes}
                  min={15}
                  max={1440}
                  repeat
                  onChange={(repeatMinutes) =>
                    act(() =>
                      save(
                        "settings",
                        { ...settings, repeatMinutes },
                        "settings",
                      ),
                    )
                  }
                />
                <button
                  onClick={() =>
                    act(enablePush, "Push включён для этого устройства.")
                  }
                >
                  <Bell size={16} /> Разрешить push
                </button>
                <p className="footnote">
                  На iPadOS 16.4+ сначала добавьте приложение на домашний экран.
                  Без сети push может задерживаться. Открывайте центр действий,
                  чтобы проверить сохранённые задачи.
                </p>
                <button
                  onClick={() =>
                    act(
                      () =>
                        navigator.storage?.persist?.() ||
                        Promise.resolve(false),
                      "Запрос постоянного хранения отправлен браузеру.",
                    )
                  }
                >
                  <Download size={16} /> Запросить постоянное хранение
                </button>
              </section>
              <section className="card">
                <h2>Аккаунт и облако</h2>
                <p>
                  {cloud
                    ? "Supabase подключён в конфигурации."
                    : "Облако не настроено. Заполните .env и примените миграцию из проекта."}
                </p>
                {account ? (
                  <>
                    <p className="account-email">{email}</p>
                    {recovery && (
                      <PasswordRecovery
                        report={setMessage}
                        finish={() => setRecovery(false)}
                      />
                    )}
                    <button
                      onClick={() =>
                        act(async () => {
                          if ("serviceWorker" in navigator) {
                            const registration =
                              await navigator.serviceWorker.getRegistration();
                            const subscription =
                              await registration?.pushManager?.getSubscription();
                            if (subscription) {
                              await subscription.unsubscribe();
                              if (cloud && account)
                                await cloud
                                  .from("push_subscriptions")
                                  .delete()
                                  .eq("user_id", account)
                                  .eq("endpoint", subscription.endpoint);
                            }
                          }
                          await cloud?.auth.signOut();
                        }, "Вы вышли. Локальные данные аккаунта сохранены отдельно.")
                      }
                    >
                      <LogOut size={16} /> Выйти
                    </button>
                  </>
                ) : (
                  <Auth disabled={!cloud} report={setMessage} />
                )}
                <div className="sync-status">
                  <Cloud size={19} />
                  <span>
                    {syncing
                      ? "Синхронизация…"
                      : !online
                        ? "Нет сети"
                        : account
                          ? "Готово к синхронизации"
                          : "Локальный режим"}
                    <small>
                      {lastSync
                        ? format(
                            Date.parse(lastSync.value),
                            zone,
                            "d LLL yyyy HH:mm",
                          )
                        : "Успешной синхронизации ещё не было"}
                    </small>
                  </span>
                </div>
                <button
                  disabled={!account || syncing || !online}
                  onClick={() => act(doSync, "Синхронизация завершена.")}
                >
                  <RefreshCw size={16} /> Синхронизировать сейчас
                </button>
                <p className="footnote">
                  Локальный профиль и каждый аккаунт используют отдельные базы.
                  Для переноса локальных планов экспортируйте их, войдите и
                  импортируйте файл.
                </p>
              </section>
              <WorkSettings
                rows={rows}
                zone={zone}
                edit={(event, id) => setEditor({ event, id })}
                report={setMessage}
              />
              <section className="card">
                <h2>Занятия</h2>
                <p>
                  У испанского, танцев и бассейна один тип — занятие.
                  Расписание, запись и запас времени настраиваются внутри.
                </p>
                <div className="button-wrap">
                  <button onClick={() => setSection("activities")}>
                    Открыть мои занятия
                  </button>
                  <button onClick={() => openEditor("activity")}>
                    Добавить занятие
                  </button>
                </div>
              </section>
              <section className="card">
                <h2>Резервные копии</h2>
                <p>
                  JSON содержит события, статусы и историю действий. Сохраните
                  копию перед переносом на другое устройство.
                </p>
                <div className="button-wrap">
                  <button
                    onClick={() =>
                      act(exportBackup, "Резервная копия экспортирована.")
                    }
                  >
                    <Download size={16} /> Экспорт JSON
                  </button>
                  <label className="file-button">
                    <Upload size={16} /> Импорт JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) act(() => importBackup(f), "Импорт завершён.");
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="footnote">
                  Если запись отличается от той, что уже сохранена, выберите
                  версию вверху настроек.
                </p>
                <h3>Удалённые события</h3>
                {rows
                  .filter((r) => r.type === "event" && r.deleted)
                  .map((r) => (
                    <div className="record-line" key={r.id}>
                      <span>{(r.payload as PlanEvent).title}</span>
                      <button
                        onClick={() =>
                          act(
                            () => save("event", r.payload, r.id),
                            "Событие восстановлено.",
                          )
                        }
                      >
                        Восстановить
                      </button>
                    </div>
                  ))}
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              ритм. <span>Место для ваших планов</span>
            </span>
            <span>
              <span className="tiny-dot" /> Только ваш выбор. Никаких
              автоматических переносов.
            </span>
          </footer>
        </div>
      </main>
      {editor && (
        <EventEditor
          value={editor.event}
          existing={!!editor.id}
          onClose={() => setEditor(null)}
          onSave={async (e) => {
            if (isActivity(e)) {
              const mode = attendanceMode(e);
              e = {
                ...e,
                kind: "activity",
                attendanceMode: mode,
                activityFormat: activityFormat(e),
                bookingRequired: mode === "booking",
                notifyAbsence:
                  e.notifyAbsence ?? (e.kind === "fixed" && e.required),
                status:
                  e.activityMode === "flexible"
                    ? "available"
                    : mode === "regular" && e.status === "available"
                      ? "selected"
                      : e.status,
              };
            }
            eventSchema.parse(e);
            validateEvent(e);
            await save("event", e, editor.id);
            setEditor(null);
          }}
          onDelete={async () => {
            if (editor.id) await remove(editor.id);
            setEditor(null);
          }}
        />
      )}
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Закрыть сообщение"
            onClick={() => setMessage("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

function Empty({
  icon,
  title,
  text,
  action,
  button,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: () => void;
  button?: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="primary" onClick={action}>
          <Plus size={16} />
          {button}
        </button>
      )}
    </div>
  );
}
function PasswordRecovery({
  report,
  finish,
}: {
  report: (s: string) => void;
  finish: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void cloud?.auth.updateUser({ password }).then(({ error }) => {
          if (error) report(error.message);
          else {
            report("Пароль обновлён.");
            finish();
          }
        });
      }}
    >
      <label>
        Новый пароль
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit" className="primary">
        Сохранить новый пароль
      </button>
    </form>
  );
}
function Auth({
  disabled,
  report,
}: {
  disabled: boolean;
  report: (s: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!cloud) return;
        setBusy(true);
        const request = signup
          ? cloud.auth.signUp({ email, password })
          : cloud.auth.signInWithPassword({ email, password });
        void request
          .then(({ error }) => {
            if (error) throw error;
            report(
              signup
                ? "Проверьте почту для подтверждения аккаунта."
                : "Вход выполнен.",
            );
          })
          .catch((e) => report(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <label>
        Электронная почта
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Пароль
        <input
          required
          type="password"
          minLength={12}
          autoComplete={signup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="button-wrap">
        <button className="primary" disabled={disabled || busy}>
          {signup ? "Создать аккаунт" : "Войти"}
        </button>
        <button type="button" onClick={() => setSignup(!signup)}>
          {signup ? "Уже есть аккаунт" : "Регистрация"}
        </button>
      </div>
      <button
        type="button"
        className="text-button"
        disabled={disabled || !email}
        onClick={() => {
          void cloud?.auth
            .resetPasswordForEmail(email, { redirectTo: window.location.href })
            .then(({ error }) =>
              report(
                error
                  ? error.message
                  : "Ссылка восстановления отправлена на вашу почту.",
              ),
            );
        }}
      >
        Восстановить пароль
      </button>
    </form>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="empty-state">
        <h1>Не удалось открыть планировщик</h1>
        <p>{this.state.error}</p>
        <p>
          Проверьте доступ браузера к IndexedDB. Сохранённые данные не удалены.
        </p>
        <button onClick={() => location.reload()}>Повторить</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
