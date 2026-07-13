import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Ensure notifications show up even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request permissions and set up Android channels.
 * Call this on app start.
 */
export async function setupNotifications() {
  if (Platform.OS === 'web') return false;

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    status = newStatus;
  }

  // Android 8.0+ requires notification channels
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Holdr Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d9fb5a', // Holdr lime green
    });
  }
  return status === 'granted';
}

/**
 * Schedules a local notification for an upcoming deadline.
 * Generates an automated date/time based on expiration logic.
 * 
 * @returns The generated notification ID, to be saved in the DB/State.
 */
export async function scheduleItemReminder(
  id: number,
  entity: string,
  type: string,
  deadlineStr: string
): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;

  // Target 10:00 AM on the deadline day
  const deadlineDate = new Date(`${deadlineStr}T10:00:00`);
  
  // Default: 2 days before the deadline
  let reminderDate = new Date(deadlineDate.getTime() - 2 * 24 * 60 * 60 * 1000);
  
  const now = Date.now();

  // If 2 days before is already past, try 1 day before
  if (reminderDate.getTime() < now) {
    reminderDate = new Date(deadlineDate.getTime() - 1 * 24 * 60 * 60 * 1000);
  }
  
  // If 1 day before is ALSO past...
  if (reminderDate.getTime() < now) {
    if (deadlineDate.getTime() < now) {
      // The deadline is entirely in the past, don't schedule a reminder.
      return undefined; 
    } else {
      // Deadline is today/tomorrow, but it's past 10 AM. 
      // Schedule for 1 minute from now just so the user gets notified.
      reminderDate = new Date(now + 60 * 1000); 
    }
  }

  const typeName = type === 'receipt' ? 'Return' : type === 'coupon' ? 'Deal' : 'Warranty';
  
  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${entity} ${typeName} expires soon!`,
        body: `Don't forget: you have a ${typeName.toLowerCase()} expiring on ${deadlineStr}.`,
        data: { itemId: id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
      },
    });
    return identifier;
  } catch (e) {
    console.error('Failed to schedule notification', e);
    return undefined;
  }
}

/**
 * Cancels an existing notification if the item is updated or deleted.
 */
export async function cancelItemReminder(notificationId?: string) {
  if (!notificationId || Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (e) {
    console.error('Failed to cancel notification', e);
  }
}
