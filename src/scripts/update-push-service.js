const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../services/pushNotificationService.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Update sendPushNotification function
const singleMessageOld = `  // Construct the message
  const message: ExpoPushMessage = {
    to: deviceToken,
    sound: 'default',
    title,
    body,
    data: data || {},
    priority: 'high',
    channelId: 'default',
  };`;

const singleMessageNew = `  // Check if this is an emergency notification
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
  };`;

content = content.replace(singleMessageOld, singleMessageNew);

// Update sendBulkPushNotifications function
const bulkMessageOld = `  // Construct messages for all tokens
  const messages: ExpoPushMessage[] = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: data || {},
    priority: 'high',
    channelId: 'default',
  }));`;

const bulkMessageNew = `  // Check if this is an emergency notification
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
  }));`;

content = content.replace(bulkMessageOld, bulkMessageNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated push notification service');
