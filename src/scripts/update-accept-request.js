const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../controllers/serviceRequestController.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find and replace the acceptServiceRequest function's update logic
// We need to add transaction logic for emergency requests

const acceptLogicOld = `        const [updated] = await db
            .update(serviceRequests)
            .set({
                status: 'assigned',
                assignedMistriId: userId,
                assignedAt: new Date(),
            })
            .where(eq(serviceRequests.id, id))
            .returning();

        // Get mistri details for notification message
        const mistri = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        // Notify customer that their request has been accepted
        await createNotification(
            reqRow.customerId,
            'Service Request Accepted',
            \`\${mistri?.fullName || 'A mistri'} has accepted your \${reqRow.type} service request.\`,
            'request_accepted',
            id
        );

        return res.status(200).json({ success: true, message: "Request accepted", request: updated });`;

const acceptLogicNew = `        let updated;

        // Handle emergency requests with transaction to prevent race conditions
        if (reqRow.isEmergency) {
            try {
                updated = await db.transaction(async (tx) => {
                    // Lock row to prevent concurrent accepts
                    const [lockedReq] = await tx.select()
                        .from(serviceRequests)
                        .where(eq(serviceRequests.id, id))
                        .for('update');

                    if (!lockedReq || lockedReq.status !== 'pending') {
                        throw new Error('ALREADY_ACCEPTED');
                    }

                    const [updatedReq] = await tx.update(serviceRequests)
                        .set({
                            status: 'assigned',
                            assignedMistriId: userId,
                            assignedAt: new Date(),
                        })
                        .where(eq(serviceRequests.id, id))
                        .returning();

                    return updatedReq;
                });

                // Auto-reject all other mistris who received this emergency request
                await autoRejectOtherMistris(id, userId);
            } catch (error: any) {
                if (error.message === 'ALREADY_ACCEPTED') {
                    return res.status(409).json({
                        success: false,
                        message: "This emergency request was already accepted by another mistri"
                    });
                }
                throw error;
            }
        } else {
            // Normal request - standard update
            const [updatedReq] = await db
                .update(serviceRequests)
                .set({
                    status: 'assigned',
                    assignedMistriId: userId,
                    assignedAt: new Date(),
                })
                .where(eq(serviceRequests.id, id))
                .returning();
            updated = updatedReq;
        }

        // Get mistri details for notification message
        const mistri = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        // Notify customer that their request has been accepted
        const notificationTitle = reqRow.isEmergency
            ? '🚨 Emergency Request Accepted'
            : 'Service Request Accepted';
        const notificationMessage = \`\${mistri?.fullName || 'A mistri'} has accepted your \${reqRow.type} service request.\`;

        await createNotification(
            reqRow.customerId,
            notificationTitle,
            notificationMessage,
            reqRow.isEmergency ? 'emergency_accepted' : 'request_accepted',
            id
        );

        return res.status(200).json({ success: true, message: "Request accepted", request: updated });`;

content = content.replace(acceptLogicOld, acceptLogicNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated acceptServiceRequest function');
