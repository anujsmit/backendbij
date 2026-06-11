// src/services/smsProvider.ts
import { logger } from '../utils/logger';

interface SparrowResponse {
  response_code: number;
  response: string;
  credits_used?: number;
  message_id?: string[];
}

export async function sendSms(phone: string, message: string): Promise<boolean> {
  try {
    // For development, just log the SMS
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[DEV SMS] To: ${phone}, Message: ${message}`);
      return true;
    }

    // Production: Use Sparrow SMS
    const sparrowToken = process.env.SPARROW_SMS_TOKEN;
    const from = process.env.SPARROW_FROM || 'ServeX';
    
    if (!sparrowToken) {
      logger.error('SPARROW_SMS_TOKEN not configured');
      return false;
    }

    // Clean phone number (remove any non-digit characters)
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Ensure phone number has country code (default to Nepal +977)
    let finalPhone = cleanPhone;
    if (cleanPhone.length === 10) {
      finalPhone = `977${cleanPhone}`;
    } else if (cleanPhone.length === 13 && cleanPhone.startsWith('977')) {
      finalPhone = cleanPhone;
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('977')) {
      finalPhone = cleanPhone;
    } else if (cleanPhone.length === 13 && cleanPhone.startsWith('+977')) {
      finalPhone = cleanPhone.substring(1);
    }

    // Sparrow SMS API endpoint
    const apiUrl = 'https://api.sparrowsms.com/v2/sms/';
    
    const params = new URLSearchParams({
      token: sparrowToken,
      from: from,
      to: finalPhone,
      text: message,
    });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data: SparrowResponse = await response.json();
    
    if (data.response_code === 200 || data.response_code === 202) {
      logger.info(`SMS sent successfully to ${phone}`, { 
        response_code: data.response_code,
        message_id: data.message_id 
      });
      return true;
    } else {
      logger.error(`Sparrow SMS failed for ${phone}:`, {
        response_code: data.response_code,
        response: data.response
      });
      return false;
    }
  } catch (error) {
    logger.error(`SMS send error for ${phone}:`, error);
    return false;
  }
}

// Test SMS balance
export async function checkSparrowBalance(): Promise<number | null> {
  try {
    const sparrowToken = process.env.SPARROW_SMS_TOKEN;
    if (!sparrowToken) return null;
    
    const response = await fetch(`https://api.sparrowsms.com/v2/balance/?token=${sparrowToken}`);
    const data = await response.json();
    
    if (data.response_code === 200) {
      return data.balance || 0;
    }
    return null;
  } catch (error) {
    logger.error('Failed to check Sparrow balance:', error);
    return null;
  }
}