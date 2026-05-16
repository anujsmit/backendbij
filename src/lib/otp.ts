import crypto from 'crypto';

export const generateOtp = (length = 6) => {
  // Use cryptographically secure random number generation
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  
  // Generate a random number between min and max (inclusive)
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  const otp = min + (randomValue % (max - min + 1));
  
  // Ensure it's always a string with proper length (handles leading zeros)
  return otp.toString().padStart(length, '0');
};
