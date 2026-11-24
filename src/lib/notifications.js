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
export const NOTIF_READ_ANNS_KEY = 'aicn:readAnnIds';
export const NOTIF_SNOOZE_KEY = 'aicn:alertSnoozeUntil';

const STICKY_NOTIF_ID = 900001;
const SCHEDULED_IDS_KEY = 'aicn:scheduledNotifIds';
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function getNotificationSettings() {
  try {
    const en = localStorage.getItem(NOTIF_ENABLED_KEY);
    const st = localStorage.getItem(NOTIF_STICKY_KEY);
    return {
      enabled: en === null ? true : en !== 'false',
      stickyOngoing: st === null ? true : st !== 'false',
    };
  } catch {
    return { enabled: true, stickyOngoing: true };
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

    // Cancel previously scheduled app reminders cleanly before re-scheduling
    let prevIds = [];
    try {
      prevIds = JSON.parse(localStorage.getItem(SCHEDULED_IDS_KEY) || '[]');
    } catch {
      prevIds = [];
    }
    const toCancel = [...new Set([...prevIds, STICKY_NOTIF_ID])].map(id => ({ id: Number(id) })).filter(x => x.id);
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

    const payload = scheduled.map(s => ({
      id: s.id,
      title: s.title,
      body: s.body,
      schedule: { at: new Date(s.at), allowWhileIdle: true },
      smallIcon: 'ic_stat_icon_config_sample',
      autoCancel: true,
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
    return { scheduledCount: scheduled.length, stickyActive: Boolean(sticky) };
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
