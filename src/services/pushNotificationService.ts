import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

// Create a new Expo SDK client
const expo = new Expo();

interface PushNotificationData {
  type: string;
  id?: string;
  [key: string]: any;
}

/**
 * Send a push notification to a user's device
 * @param deviceToken - The Expo push token for the user's device
 * @param title - Notification title
 * @param body - Notification body/message
 * @param data - Additional data to send with the notification
 * @returns Promise<boolean> - True if notification was sent successfully
 */
export const sendPushNotification = async (
  deviceToken: string | null,
  title: string,
  body: string,
  data?: PushNotificationData
): Promise<boolean> => {
  // If no device token, can't send push notification
  if (!deviceToken) {
    console.log('No device token provided, skipping push notification');
    return false;
  }

  // Check that the token is a valid Expo push token
  if (!Expo.isExpoPushToken(deviceToken)) {
    console.error(`Push token ${deviceToken} is not a valid Expo push token`);
    return false;
  }

  // Check if this is an emergency notification
  const isEmergency = data?.type === 'emergency_request';

  // Construct the message
  const message: ExpoPushMessage = {
    to: deviceToken,
    sound: 'default',
    title,
    body,
    data: data || {},
    priority: 'high',
    channelId: isEmergency ? 'emergency' : 'default',
    badge: isEmergency ? 1 : undefined,
    ...(isEmergency && { ttl: 300 }), // 5 min TTL for emergency
  };

  try {
    // Send the notification
    const ticketChunk = await expo.sendPushNotificationsAsync([message]);

    // Check if the notification was accepted
    const ticket = ticketChunk[0] as ExpoPushTicket;

    if (ticket.status === 'error') {
      console.error('Error sending push notification:', ticket.message);
      if (ticket.details) {
        console.error('Details:', ticket.details);
      }
      return false;
    }

    console.log('Push notification sent successfully:', ticket.id);
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
};

/**
 * Send push notifications to multiple device tokens
 * @param deviceTokens - Array of Expo push tokens
 * @param title - Notification title
 * @param body - Notification body/message
 * @param data - Additional data to send with the notification
 * @returns Promise<number> - Number of notifications sent successfully
 */
export const sendBulkPushNotifications = async (
  deviceTokens: string[],
  title: string,
  body: string,
  data?: PushNotificationData
): Promise<number> => {
  // Filter out invalid tokens
  const validTokens = deviceTokens.filter(token =>
    token && Expo.isExpoPushToken(token)
  );

  if (validTokens.length === 0) {
    console.log('No valid device tokens, skipping push notifications');
    return 0;
  }

  // Check if this is an emergency notification
  const isEmergency = data?.type === 'emergency_request';

  // Construct messages for all tokens
  const messages: ExpoPushMessage[] = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: data || {},
    priority: 'high',
    channelId: isEmergency ? 'emergency' : 'default',
    badge: isEmergency ? 1 : undefined,
    ...(isEmergency && { ttl: 300 }), // 5 min TTL for emergency
  }));

  try {
    // Expo recommends sending notifications in chunks of 100
    const chunks = expo.chunkPushNotifications(messages);
    let successCount = 0;

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);

      // Count successful sends
      ticketChunk.forEach((ticket) => {
        if (ticket.status === 'ok') {
          successCount++;
        } else if (ticket.status === 'error') {
          console.error('Error in bulk push:', ticket.message);
        }
      });
    }

    console.log(`Sent ${successCount}/${validTokens.length} push notifications successfully`);
    return successCount;
  } catch (error) {
    console.error('Error sending bulk push notifications:', error);
    return 0;
  }
};
