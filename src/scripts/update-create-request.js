const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../controllers/serviceRequestController.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add emergency field extraction after line with "const { type, serviceIds"
const extractionOld = `const { type, serviceIds, coords, address, source, customerNotes } = validatedData.data;`;
const extractionNew = `const { type, serviceIds, coords, address, source, customerNotes, isEmergency, emergencySurgeMultiplier } = validatedData.data;`;
content = content.replace(extractionOld, extractionNew);

// 2. Add emergency validation after selectedMistriId sanitization
const validationInsertPoint = `        // Debug: Log the received data`;
const emergencyValidation = `        // Emergency requests cannot be targeted - they must be broadcast
        if (isEmergency && selectedMistriId) {
            return res.status(400).json({
                success: false,
                message: "Emergency requests must be broadcast to all available mistris",
            });
        }

        ${validationInsertPoint}`;
content = content.replace(validationInsertPoint, emergencyValidation);

// 3. Calculate emergency pricing before creating request
const createRequestLine = `        // Create service request in database`;
const pricingCalculation = `        // Calculate emergency pricing if applicable
        let emergencyBasePrice = null;
        let emergencyFinalPrice = null;
        if (isEmergency && serviceIds && serviceIds.length > 0) {
            const validServices = await db
                .select()
                .from(mistriServices)
                .where(inArray(mistriServices.id, serviceIds));

            emergencyBasePrice = validServices.reduce((sum, service) =>
                sum + parseFloat(service.price || '0'), 0);
            emergencyFinalPrice = emergencyBasePrice * (emergencySurgeMultiplier || 1.5);
        }

        ${createRequestLine}`;
content = content.replace(createRequestLine, pricingCalculation);

// 4. Add emergency fields to insert statement
const insertOld = `            customerNotes: customerNotes || null,
        }).returning();`;
const insertNew = `            customerNotes: customerNotes || null,
            isEmergency: isEmergency || false,
            emergencySurgeMultiplier: isEmergency ? (emergencySurgeMultiplier || 1.5).toString() : null,
            emergencyBasePrice: emergencyBasePrice ? emergencyBasePrice.toString() : null,
            emergencyFinalPrice: emergencyFinalPrice ? emergencyFinalPrice.toString() : null,
        }).returning();`;
content = content.replace(insertOld, insertNew);

// 5. Replace targeted notification logic with emergency broadcast logic
const notificationOld = `        // Create notification for mistri if this is a targeted request
        if (selectedMistriId) {
            try {
                await createNotification(
                    selectedMistriId,
                    'New Service Request',
                    \`You have a new service request at \${address}\`,
                    'new_request',
                    newRequest.id
                );
            } catch (notifError) {
                console.error('Failed to create notification:', notifError);
            }
        }`;

const notificationNew = `        // Handle notifications based on request type
        if (isEmergency) {
            // Broadcast to all nearby available mistris
            try {
                await broadcastEmergencyRequest(
                    newRequest,
                    coords.lat,
                    coords.lng
                );
            } catch (notifError) {
                console.error('Failed to broadcast emergency request:', notifError);
            }
        } else if (selectedMistriId) {
            // Create notification for targeted request
            try {
                await createNotification(
                    selectedMistriId,
                    'New Service Request',
                    \`You have a new service request at \${address}\`,
                    'new_request',
                    newRequest.id
                );
            } catch (notifError) {
                console.error('Failed to create notification:', notifError);
            }
        }`;

content = content.replace(notificationOld, notificationNew);

// 6. Update return statement to include emergency data
const returnOld = `        return res.status(201).json({
            success: true,
            requestId: newRequest.id,
            status: newRequest.status,
        });`;

const returnNew = `        return res.status(201).json({
            success: true,
            requestId: newRequest.id,
            status: newRequest.status,
            isEmergency: newRequest.isEmergency,
            surgeMultiplier: newRequest.emergencySurgeMultiplier,
            finalPrice: newRequest.emergencyFinalPrice,
        });`;

content = content.replace(returnOld, returnNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated createServiceRequest function');
