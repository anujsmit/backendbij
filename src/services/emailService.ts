// backend/src/services/emailService.ts

import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

export interface OrderEmailData {
    orderId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    items: Array<{
        name: string;
        quantity: number;
        price: number;
        subtotal: number;
    }>;
    subtotal: number;
    tax: number;
    deliveryFee: number;
    discount: number;
    total: number;
    address: string;
    city: string;
    zipCode: string;
    paymentMethod: string;
    customerNotes?: string;
    createdAt: string;
}

/**
 * Send order confirmation email to admin
 */
export const sendOrderEmail = async (orderData: OrderEmailData): Promise<void> => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'anujkattel62@gmail.com';
        
        // Generate HTML for order items
        const itemsHtml = orderData.items.map(item => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">रु ${item.price.toLocaleString()}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">रु ${item.subtotal.toLocaleString()}</td>
            </tr>
        `).join('');

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
                    .order-details { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                    .section-title { font-size: 16px; font-weight: bold; color: #2563eb; margin: 15px 0 10px 0; border-bottom: 2px solid #2563eb; padding-bottom: 5px; }
                    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                    th { background: #f1f5f9; padding: 10px; text-align: left; font-weight: 600; }
                    td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
                    .total-row { background: #f8fafc; font-weight: bold; }
                    .total-amount { font-size: 20px; color: #2563eb; }
                    .label { font-weight: 600; color: #475569; }
                    .value { color: #0f172a; }
                    .footer { margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
                    .badge { display: inline-block; background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0;">🛒 New Order Received</h1>
                        <p style="margin: 5px 0 0 0; opacity: 0.9;">Order #${orderData.orderId.slice(0, 8).toUpperCase()}</p>
                    </div>
                    
                    <div class="content">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <span style="color: #64748b;">Placed on:</span>
                            <span style="font-weight: 600;">${new Date(orderData.createdAt).toLocaleString()}</span>
                        </div>

                        <!-- Customer Details -->
                        <div class="section-title">👤 Customer Details</div>
                        <div class="order-details">
                            <p><span class="label">Name:</span> <span class="value">${orderData.customerName}</span></p>
                            <p><span class="label">Phone:</span> <span class="value">${orderData.customerPhone}</span></p>
                            ${orderData.customerEmail ? `<p><span class="label">Email:</span> <span class="value">${orderData.customerEmail}</span></p>` : ''}
                        </div>

                        <!-- Address -->
                        <div class="section-title">📍 Delivery Address</div>
                        <div class="order-details">
                            <p><span class="label">Address:</span> <span class="value">${orderData.address}</span></p>
                            <p><span class="label">City:</span> <span class="value">${orderData.city}</span></p>
                            ${orderData.zipCode ? `<p><span class="label">ZIP Code:</span> <span class="value">${orderData.zipCode}</span></p>` : ''}
                        </div>

                        <!-- Order Items -->
                        <div class="section-title">📦 Order Items</div>
                        <div class="order-details">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th style="text-align: center;">Qty</th>
                                        <th style="text-align: right;">Price</th>
                                        <th style="text-align: right;">Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsHtml}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colspan="3" style="text-align: right; padding: 10px; font-weight: 600;">Subtotal:</td>
                                        <td style="text-align: right; padding: 10px;">रु ${orderData.subtotal.toLocaleString()}</td>
                                    </tr>
                                    <tr>
                                        <td colspan="3" style="text-align: right; padding: 10px; color: #64748b;">Tax (13%):</td>
                                        <td style="text-align: right; padding: 10px;">रु ${orderData.tax.toLocaleString()}</td>
                                    </tr>
                                    <tr>
                                        <td colspan="3" style="text-align: right; padding: 10px; color: #64748b;">Delivery Fee:</td>
                                        <td style="text-align: right; padding: 10px;">रु ${orderData.deliveryFee.toLocaleString()}</td>
                                    </tr>
                                    ${orderData.discount > 0 ? `
                                    <tr>
                                        <td colspan="3" style="text-align: right; padding: 10px; color: #10b981;">Discount:</td>
                                        <td style="text-align: right; padding: 10px; color: #10b981;">-रु ${orderData.discount.toLocaleString()}</td>
                                    </tr>
                                    ` : ''}
                                    <tr class="total-row">
                                        <td colspan="3" style="text-align: right; padding: 10px; font-size: 18px;">Total:</td>
                                        <td style="text-align: right; padding: 10px; font-size: 20px; color: #2563eb; font-weight: 700;">रु ${orderData.total.toLocaleString()}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <!-- Payment Method -->
                        <div class="section-title">💳 Payment Method</div>
                        <div class="order-details">
                            <p><span class="label">Method:</span> <span class="value">${orderData.paymentMethod.charAt(0).toUpperCase() + orderData.paymentMethod.slice(1)}</span></p>
                        </div>

                        ${orderData.customerNotes ? `
                        <!-- Customer Notes -->
                        <div class="section-title">📝 Customer Notes</div>
                        <div class="order-details">
                            <p style="margin: 0; color: #475569;">${orderData.customerNotes}</p>
                        </div>
                        ` : ''}

                        <!-- Admin Actions -->
                        <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
                            <p style="margin: 0; font-weight: 600; color: #92400e;">🔔 Action Required</p>
                            <p style="margin: 5px 0 0 0; color: #78350f; font-size: 14px;">
                                Please review this order and assign a professional.
                            </p>
                        </div>

                        <div class="footer">
                            <p>This is an automated notification from ServeX.</p>
                            <p>© ${new Date().getFullYear()} ServeX - All rights reserved.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        // Plain text version
        const text = `
NEW ORDER RECEIVED
------------------
Order #${orderData.orderId.slice(0, 8).toUpperCase()}
Placed on: ${new Date(orderData.createdAt).toLocaleString()}

CUSTOMER DETAILS
----------------
Name: ${orderData.customerName}
Phone: ${orderData.customerPhone}
${orderData.customerEmail ? `Email: ${orderData.customerEmail}` : ''}

DELIVERY ADDRESS
----------------
${orderData.address}
${orderData.city}${orderData.zipCode ? `, ${orderData.zipCode}` : ''}

ORDER ITEMS
-----------
${orderData.items.map(item => 
    `  ${item.name} x${item.quantity} = रु ${item.subtotal.toLocaleString()}`
).join('\n')}

Subtotal: रु ${orderData.subtotal.toLocaleString()}
Tax (13%): रु ${orderData.tax.toLocaleString()}
Delivery Fee: रु ${orderData.deliveryFee.toLocaleString()}
${orderData.discount > 0 ? `Discount: -रु ${orderData.discount.toLocaleString()}` : ''}
TOTAL: रु ${orderData.total.toLocaleString()}

Payment Method: ${orderData.paymentMethod}
${orderData.customerNotes ? `\nCustomer Notes: ${orderData.customerNotes}` : ''}

Please review and assign a professional.
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || 'noreply@servex.com',
            to: adminEmail,
            subject: `🛒 New Order Received - #${orderData.orderId.slice(0, 8).toUpperCase()}`,
            text: text,
            html: html,
        };

        await transporter.sendMail(mailOptions);
        logger.info(`Order email sent for order ${orderData.orderId}`);
    } catch (error) {
        logger.error('Error sending order email:', error);
        throw error;
    }
};

/**
 * Send order confirmation email to customer
 */
export const sendCustomerOrderEmail = async (orderData: OrderEmailData): Promise<void> => {
    if (!orderData.customerEmail) return;

    try {
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
                    .order-details { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                    .section-title { font-size: 16px; font-weight: bold; color: #10b981; margin: 15px 0 10px 0; border-bottom: 2px solid #10b981; padding-bottom: 5px; }
                    .total-amount { font-size: 20px; color: #10b981; }
                    .footer { margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0;">✅ Order Confirmed!</h1>
                        <p style="margin: 5px 0 0 0; opacity: 0.9;">Thank you for your order</p>
                    </div>
                    
                    <div class="content">
                        <p style="font-size: 16px;">Hi ${orderData.customerName},</p>
                        <p>Your order has been received and is being processed. You will receive a notification once a professional is assigned.</p>

                        <div class="section-title">📋 Order Summary</div>
                        <div class="order-details">
                            <p><strong>Order #:</strong> ${orderData.orderId.slice(0, 8).toUpperCase()}</p>
                            <p><strong>Placed on:</strong> ${new Date(orderData.createdAt).toLocaleString()}</p>
                            <p><strong>Total Amount:</strong> <span class="total-amount">रु ${orderData.total.toLocaleString()}</span></p>
                            <p><strong>Payment Method:</strong> ${orderData.paymentMethod.charAt(0).toUpperCase() + orderData.paymentMethod.slice(1)}</p>
                        </div>

                        <div style="margin-top: 20px; padding: 15px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #10b981;">
                            <p style="margin: 0; color: #166534; font-size: 14px;">
                                📍 We'll notify you when a professional is assigned to your order.
                            </p>
                        </div>

                        <div class="footer">
                            <p>Thank you for choosing ServeX!</p>
                            <p>© ${new Date().getFullYear()} ServeX - All rights reserved.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: process.env.SMTP_FROM || 'noreply@servex.com',
            to: orderData.customerEmail,
            subject: `✅ Order Confirmed - #${orderData.orderId.slice(0, 8).toUpperCase()}`,
            html: html,
        };

        await transporter.sendMail(mailOptions);
        logger.info(`Customer order email sent to ${orderData.customerEmail}`);
    } catch (error) {
        logger.error('Error sending customer order email:', error);
        // Don't throw - customer email failure shouldn't break the order
    }
};