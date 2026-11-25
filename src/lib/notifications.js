/**
 * notifications — Persistent Due-Date, Exam & Canvas Announcement Alert Engine.
 *
 * - On Android APK: schedules native offline reminders via `@capacitor/local-notifications`
 *   (24h before due, 3h before due, 7:00 AM exam morning, + optional sticky `ongoing: true`
 *   notification for Due Today / Overdue tasks that stays pinned until marked Done!).
 * - On Web / Desktop + Android: drives the persistent in-app Reminder Banner for Due Today,
 *   Overdue tasks, and unread Canvas Announcements.
 */
import { Capacitor } from '@capacitor/core';
import { db, localDateKey } from '../store/db';
import {
  formatTimeRange12h,
  resolveScheduleEntries,
  filterScheduleEntries,
  getScheduleFilterMode,
} from './scheduleView';
import { matchAnnouncementToCourse } from './announcementSchedule';

let _localNotifMod = null;
async function loadLocalNotifications() {
  if (!Capacitor.isNativePlatform?.()) return { plugin: null };
  if (!_localNotifMod) {
    _localNotifMod = await import('@capacitor/local-notifications').catch(() => null);
  }
  return { plugin: _localNotifMod?.LocalNotifications || null };
}

export const NOTIF_ENABLED_KEY = 'aicn:notifsEnabled';
export const NOTIF_STICKY_KEY = 'aicn:notifsSticky';
export const NOTIF_CLASS_REMINDERS_KEY = 'aicn:notifsClass15m';
export const NOTIF_CLASS_LEAD_KEY = 'aicn:notifsClassLeadMin';
export const NOTIF_CLASS_PERSISTENT_KEY = 'aicn:notifsClassPersistent';
export const NOTIF_READ_ANNS_KEY = 'aicn:readAnnIds';
export const NOTIF_SNOOZE_KEY = 'aicn:alertSnoozeUntil';

export const CLASS_REMINDER_CHANNEL_ID = 'class-reminders';
export const CLASS_REMINDER_ACTION_TYPE_ID = 'CLASS_REMINDER_ACTIONS';

const STICKY_NOTIF_ID = 900001;
const SCHEDULED_IDS_KEY = 'aicn:scheduledNotifIds';
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
let _channelInitialized = false;

function clampLeadMin(val) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.max(1, Math.min(60, n));
}

export function getNotificationSettings() {
  try {
    const en = localStorage.getItem(NOTIF_ENABLED_KEY);
    const st = localStorage.getItem(NOTIF_STICKY_KEY);
    const cr = localStorage.getItem(NOTIF_CLASS_REMINDERS_KEY);
    const leadRaw = localStorage.getItem(NOTIF_CLASS_LEAD_KEY);
    const persistRaw = localStorage.getItem(NOTIF_CLASS_PERSISTENT_KEY);
    const classEnabled = cr === 'true';
    return {
      enabled: en === null ? true : en !== 'false',
      stickyOngoing: st === null ? true : st !== 'false',
      classReminders15m: classEnabled,
      classRemindersEnabled: classEnabled,
      classReminderLeadMin: leadRaw !== null ? clampLeadMin(leadRaw) : 10,
      classReminderPersistent: persistRaw === null ? true : persistRaw !== 'false',
    };
  } catch {
    return {
      enabled: true,
      stickyOngoing: true,
      classReminders15m: false,
      classRemindersEnabled: false,
      classReminderLeadMin: 10,
      classReminderPersistent: true,
    };
  }
}

export function saveNotificationSettings(patch) {
  try {
    if (patch.enabled !== undefined) {
      localStorage.setItem(NOTIF_ENABLED_KEY, patch.enabled ? 'true' : 'false');
    }
    if (patch.stickyOngoing !== undefined) {
      localStorage.setItem(NOTIF_STICKY_KEY, patch.stickyOngoing ? 'true' : 'false');
    }
    const clsFlag =
      patch.classRemindersEnabled !== undefined
        ? patch.classRemindersEnabled
        : patch.classReminders15m;
    if (clsFlag !== undefined) {
      localStorage.setItem(NOTIF_CLASS_REMINDERS_KEY, clsFlag ? 'true' : 'false');
    }
    if (patch.classReminderLeadMin !== undefined) {
      localStorage.setItem(NOTIF_CLASS_LEAD_KEY, String(clampLeadMin(patch.classReminderLeadMin)));
    }
    if (patch.classReminderPersistent !== undefined) {
      localStorage.setItem(
        NOTIF_CLASS_PERSISTENT_KEY,
        patch.classReminderPersistent ? 'true' : 'false'
      );
    }
  } catch {
    // ignore
  }
}

function getReadAnnouncementSet() {
  try {
    const arr = JSON.parse(localStorage.getItem(NOTIF_READ_ANNS_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveReadAnnouncementSet(set) {
  try {
    localStorage.setItem(NOTIF_READ_ANNS_KEY, JSON.stringify([...set].slice(-300)));
  } catch {
    // ignore
  }
}

export function isAnnouncementRead(item) {
  const key = item?.externalUid || String(item?.id || '');
  if (!key) return false;
  return getReadAnnouncementSet().has(key);
}

export function markAnnouncementRead(item) {
  const key = item?.externalUid || String(item?.id || '');
  if (!key) return;
  const set = getReadAnnouncementSet();
  set.add(key);
  saveReadAnnouncementSet(set);
}

export function markAnnouncementUnread(item) {
  const key = item?.externalUid || String(item?.id || '');
  if (!key) return;
  const set = getReadAnnouncementSet();
  set.delete(key);
  saveReadAnnouncementSet(set);
}

export function markAllAnnouncementsRead(items = []) {
  const set = getReadAnnouncementSet();
  for (const it of items) {
    const key = it?.externalUid || String(it?.id || '');
    if (key) set.add(key);
  }
  saveReadAnnouncementSet(set);
}

export function snoozeInAppBanner(minutes = 60) {
  try {
    localStorage.setItem(NOTIF_SNOOZE_KEY, String(Date.now() + minutes * 60 * 1000));
  } catch {
    // ignore
  }
}

export function clearBannerSnooze() {
  try {
    localStorage.removeItem(NOTIF_SNOOZE_KEY);
  } catch {
    // ignore
  }
}

function stableNotifId(seedStr) {
  let h = 2166136261;
  const s = String(seedStr || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 700000) + 10000;
}

/**
 * Pure deterministic notification schedule builder (unit-tested directly!).
 * Produces scheduled local notifications (24h before, 3h before, exam 7AM)
 * plus an optional sticky `ongoing: true` summary alert for Overdue / Due Today tasks.
 */
export function buildDeadlineSchedules(items = [], nowMs = Date.now(), { stickyOngoing = true } = {}) {
  const todayKey = localDateKey(new Date(nowMs));
  const scheduled = [];
  const urgentToday = [];

  for (const it of items) {
    if (!it || it.done || it.type === 'announcement') continue;
    const dueAt = Number(it.dueAt) || (it.dateKey ? new Date(`${it.dateKey}T23:59:00`).getTime() : 0);
    if (!dueAt) continue;

    if (it.dateKey && it.dateKey <= todayKey) {
      urgentToday.push(it);
    }

    const baseKey = it.externalUid || `local:${it.id || it.title}:${it.dateKey}`;
    const coursePrefix = it.course ? `[${it.course}] ` : '';

    // 1. 24-hour advance reminder
    const t24 = dueAt - DAY_MS;
    if (t24 > nowMs + 60000 && t24 < nowMs + 30 * DAY_MS) {
      scheduled.push({
        id: stableNotifId(`${baseKey}:24h`),
        title: `Due Tomorrow: ${coursePrefix}${it.title}`,
        body: `Due ${it.dateKey}${it.timeLabel ? ` at ${it.timeLabel}` : ''}. Tap to open Notes by Bai.`,
        at: t24,
        ongoing: false,
      });
    }

    // 2. 3-hour urgent reminder
    const t3 = dueAt - 3 * HOUR_MS;
    if (t3 > nowMs + 60000 && t3 < nowMs + 30 * DAY_MS) {
      scheduled.push({
        id: stableNotifId(`${baseKey}:3h`),
        title: `Due in 3 Hours: ${coursePrefix}${it.title}`,
        body: `Don't forget to submit before ${it.timeLabel || it.dateKey}!`,
        at: t3,
        ongoing: false,
      });
    }

    // 3. Exam Day 7:00 AM reminder
    if (it.type === 'exam' && it.dateKey) {
      const parts = it.dateKey.split('-').map(Number);
      if (parts.length === 3) {
        const morning = new Date(parts[0], parts[1] - 1, parts[2], 7, 0, 0).getTime();
        if (morning > nowMs + 60000 && morning < nowMs + 30 * DAY_MS) {
          scheduled.push({
            id: stableNotifId(`${baseKey}:exam7am`),
            title: `Exam Today: ${coursePrefix}${it.title}`,
            body: 'Good luck! Review your flashcards & notes before class.',
            at: morning,
            ongoing: false,
          });
        }
      }
    }
  }

  let sticky = null;
  if (stickyOngoing && urgentToday.length > 0) {
    const names = urgentToday.slice(0, 3).map(x => x.title).join(', ');
    sticky = {
      id: STICKY_NOTIF_ID,
      title: `⏰ ${urgentToday.length} Due Today / Overdue`,
      body: urgentToday.length > 3 ? `${names} +${urgentToday.length - 3} more` : names,
      ongoing: true,
    };
  }

  return { scheduled: scheduled.slice(0, 48), sticky };
}

/**
 * Pure deterministic customizable before-class notification schedule builder
 * (default 10m lead, optional persistent ongoing mode, weekly recurring closed-app alarms,
 * room/lab + teacher + unread posts).
 */
export function buildClassReminderSchedules(
  courses = [],
  scheduleRows = [],
  unreadAnnouncements = [],
  nowMs = Date.now(),
  { leadMinutes = 10, persistent = false, filterMode = getScheduleFilterMode() } = {}
) {
  const entries = filterScheduleEntries(resolveScheduleEntries(courses, scheduleRows), filterMode);
  if (entries.length === 0) return [];
  const lead = clampLeadMin(leadMinutes);
  const persist = Boolean(persistent);

  const unreadByCourseId = new Map();
  for (const ann of unreadAnnouncements || []) {
    const m = matchAnnouncementToCourse(ann, courses, scheduleRows, new Date(nowMs));
    if (m?.course?.id) {
      unreadByCourseId.set(m.course.id, (unreadByCourseId.get(m.course.id) || 0) + 1);
    }
  }

  const now = new Date(nowMs);
  const nowDow = now.getDay();
  const out = [];

  for (const e of entries) {
    // Compute native Capacitor recurring weekly trigger (weekday 1=Sun .. 7=Sat)
    let triggerDay = e.dayOfWeek;
    let triggerMin = e.startMin - lead;
    if (triggerMin < 0) {
      triggerMin += 1440;
      triggerDay = (triggerDay + 6) % 7;
    }
    const recurringOn = {
      weekday: triggerDay + 1,
      hour: Math.floor(triggerMin / 60),
      minute: triggerMin % 60,
    };

    for (let offset = 0; offset < 7; offset++) {
      const targetDow = (nowDow + offset) % 7;
      if (e.dayOfWeek !== targetDow) continue;

      const classStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offset,
        Math.floor(e.startMin / 60),
        e.startMin % 60,
        0
      ).getTime();
      const classEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offset,
        Math.floor(e.endMin / 60),
        e.endMin % 60,
        0
      ).getTime();

      const unreadCount = e.courseId ? unreadByCourseId.get(e.courseId) || 0 : 0;
      const roomPart = e.room ? ` · ${e.room}` : '';
      const timeRange = formatTimeRange12h(e.startTime, e.endTime);
      const teacherHint = e.instructor ? ` · ${e.instructor}` : '';
      const unreadHint =
        unreadCount > 0
          ? ` · ${unreadCount} unread post${unreadCount === 1 ? '' : 's'}`
          : '';
      const body = `${timeRange}${teacherHint}${unreadHint}`;

      const triggerAt = classStart - lead * 60 * 1000;
      const isImminentNow = offset === 0 && nowMs >= triggerAt && nowMs < classEnd;

      if (persist && isImminentNow) {
        const minsLeft = Math.max(1, Math.ceil((classStart - nowMs) / 60000));
        out.push({
          id: stableNotifId(`class-now:${e.baseCode}:${e.dayOfWeek}:${e.startTime}`),
          title:
            nowMs < classStart
              ? `🔔 Class in ${minsLeft}m: ${e.code}${roomPart}`
              : `🔔 In Class Now: ${e.code}${roomPart}`,
          body,
          at: null,
          recurringOn: null,
          classEndAt: classEnd,
          ongoing: true,
          autoCancel: false,
          channelId: CLASS_REMINDER_CHANNEL_ID,
          actionTypeId: CLASS_REMINDER_ACTION_TYPE_ID,
        });
        break;
      }

      const futureTriggerAt = triggerAt <= nowMs + 60000 ? triggerAt + 7 * DAY_MS : triggerAt;
      out.push({
        id: stableNotifId(`class:${e.baseCode}:${e.dayOfWeek}:${e.startTime}`),
        title: `${persist ? '🔔 ' : ''}Class in ${lead}m: ${e.code}${roomPart}`,
        body,
        at: futureTriggerAt,
        recurringOn,
        classEndAt: classEnd,
        ongoing: persist,
        autoCancel: !persist,
        channelId: CLASS_REMINDER_CHANNEL_ID,
        actionTypeId: persist ? CLASS_REMINDER_ACTION_TYPE_ID : undefined,
      });
      break;
    }
  }

  return out
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .slice(0, 24);
}

export async function requestNotificationPermission() {
  try {
    const { plugin: localNotifs } = await loadLocalNotifications();
    if (localNotifs) {
      const status = await localNotifs.requestPermissions();
      return status?.display === 'granted';
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') return true;
      const res = await Notification.requestPermission();
      return res === 'granted';
    }
  } catch {
    // ignore
  }
  return false;
}

async function ensureClassReminderChannel(localNotifs) {
  if (_channelInitialized || !localNotifs) return;
  _channelInitialized = true;
  try {
    await localNotifs.createChannel?.({
      id: CLASS_REMINDER_CHANNEL_ID,
      name: 'Class Reminders',
      description: 'Persistent upcoming class reminders with room & teacher info',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  } catch {
    // ignore on web or unsupported OS
  }
  try {
    await localNotifs.registerActionTypes?.({
      types: [
        {
          id: CLASS_REMINDER_ACTION_TYPE_ID,
          actions: [
            { id: 'dismiss', title: 'Dismiss', destructive: true },
            { id: 'open-schedule', title: 'Open Schedule', foreground: true },
          ],
        },
      ],
    });
  } catch {
    // ignore if action types unsupported
  }
}

/** Reconcile native Android scheduled reminders & sticky notification with current Dexie items. */
export async function syncDeadlineNotifications() {
  const cfg = getNotificationSettings();
  const { plugin: localNotifs } = await loadLocalNotifications();
  if (!localNotifs) {
    return { scheduledCount: 0, stickyActive: false };
  }

  try {
    const perm = await localNotifs.checkPermissions();
    if (perm?.display !== 'granted') {
      return { scheduledCount: 0, stickyActive: false, needsPermission: true };
    }

    await ensureClassReminderChannel(localNotifs);

    // Cancel previously scheduled app reminders cleanly before re-scheduling
    let prevIds = [];
    try {
      prevIds = JSON.parse(localStorage.getItem(SCHEDULED_IDS_KEY) || '[]');
    } catch {
      prevIds = [];
    }
    const toCancel = [...new Set([...prevIds, STICKY_NOTIF_ID])]
      .map(id => ({ id: Number(id) }))
      .filter(x => x.id);
    if (toCancel.length > 0) {
      await localNotifs.cancel({ notifications: toCancel }).catch(() => {});
    }

    if (!cfg.enabled) {
      localStorage.setItem(SCHEDULED_IDS_KEY, '[]');
      return { scheduledCount: 0, stickyActive: false };
    }

    const items = await db.plannerItems.toArray().catch(() => []);
    const { scheduled, sticky } = buildDeadlineSchedules(items, Date.now(), {
      stickyOngoing: cfg.stickyOngoing,
    });

    let classReminders = [];
    if (cfg.classRemindersEnabled || cfg.classReminders15m) {
      const [courses, schedRows] = await Promise.all([
        db.courses.toArray().catch(() => []),
        db.classSchedule.toArray().catch(() => []),
      ]);
      const readSet = getReadAnnouncementSet();
      const unreadAnns = items.filter(
        it => it.type === 'announcement' && !readSet.has(it.externalUid || String(it.id))
      );
      classReminders = buildClassReminderSchedules(courses, schedRows, unreadAnns, Date.now(), {
        leadMinutes: cfg.classReminderLeadMin,
        persistent: cfg.classReminderPersistent,
      });
    }

    const merged = [...scheduled, ...classReminders].slice(0, 60);
    const payload = merged.map(s => ({
      id: s.id,
      title: s.title,
      body: s.body,
      ...(s.recurringOn
        ? { schedule: { on: s.recurringOn, repeats: true, allowWhileIdle: true } }
        : s.at
          ? { schedule: { at: new Date(s.at), allowWhileIdle: true } }
          : {}),
      smallIcon: 'ic_stat_icon_config_sample',
      ongoing: Boolean(s.ongoing),
      autoCancel: s.autoCancel !== undefined ? Boolean(s.autoCancel) : !s.ongoing,
      ...(s.channelId ? { channelId: s.channelId } : {}),
      ...(s.actionTypeId ? { actionTypeId: s.actionTypeId } : {}),
    }));

    if (sticky) {
      payload.push({
        id: sticky.id,
        title: sticky.title,
        body: sticky.body,
        ongoing: true,
        autoCancel: false,
      });
    }

    if (payload.length > 0) {
      await localNotifs.schedule({ notifications: payload });
    }
    localStorage.setItem(SCHEDULED_IDS_KEY, JSON.stringify(payload.map(p => p.id)));
    return { scheduledCount: merged.length, stickyActive: Boolean(sticky) };
  } catch {
    return { scheduledCount: 0, stickyActive: false };
  }
}

/** Fire an immediate native/web notification when Canvas sync discovers brand-new announcements. */
export async function notifyNewCanvasAnnouncements(newAnnouncements = []) {
  if (!Array.isArray(newAnnouncements) || newAnnouncements.length === 0) return;
  const cfg = getNotificationSettings();
  if (!cfg.enabled) return;

  const first = newAnnouncements[0];
  const title =
    newAnnouncements.length === 1
      ? `📢 ${first.course || 'Canvas'}: ${first.title}`
      : `📢 ${newAnnouncements.length} New Canvas Announcements`;
  const body =
    newAnnouncements.length === 1
      ? `${first.author ? `${first.author}: ` : ''}${String(first.description || '').slice(0, 120)}`
      : newAnnouncements.slice(0, 3).map(a => a.title).join(' · ');

  try {
    const { plugin: localNotifs } = await loadLocalNotifications();
    if (localNotifs) {
      const perm = await localNotifs.checkPermissions();
      if (perm?.display === 'granted') {
        await localNotifs.schedule({
          notifications: [
            {
              id: stableNotifId(`ann:${Date.now()}:${first.title}`),
              title,
              body,
              autoCancel: true,
            },
          ],
        });
      }
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    // non-fatal
  }
}

/** Compute live urgent deadlines & unread announcements for the persistent in-app banner. */
export async function getInAppAlertSummary(prefetchedItems = null) {
  const todayKey = localDateKey();
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  const tomorrowKey = localDateKey(tom);

  const items = Array.isArray(prefetchedItems)
    ? prefetchedItems
    : await db.plannerItems.toArray().catch(() => []);
  const readSet = getReadAnnouncementSet();
  let snoozeUntil = 0;
  try {
    snoozeUntil = Number(localStorage.getItem(NOTIF_SNOOZE_KEY) || 0) || 0;
  } catch {
    snoozeUntil = 0;
  }

  const overdue = [];
  const dueToday = [];
  const dueTomorrow = [];
  const unreadAnnouncements = [];

  for (const it of items) {
    if (it.type === 'announcement') {
      const k = it.externalUid || String(it.id);
      if (!readSet.has(k)) unreadAnnouncements.push(it);
      continue;
    }
    if (it.done || !it.dateKey) continue;
    if (it.dateKey < todayKey) overdue.push(it);
    else if (it.dateKey === todayKey) dueToday.push(it);
    else if (it.dateKey === tomorrowKey) dueTomorrow.push(it);
  }

  const totalUrgent = overdue.length + dueToday.length + unreadAnnouncements.length;
  return {
    overdue,
    dueToday,
    dueTomorrow,
    unreadAnnouncements,
    totalUrgent,
    snoozed: Date.now() < snoozeUntil,
  };
}
