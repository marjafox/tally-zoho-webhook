// server.js
const express = require('express');
const axios = require('axios');
const app = express();

// Configuration - we'll set these as environment variables
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;

// Debuggin code
console.log('Environment variables loaded:');
console.log('Client ID:', ZOHO_CLIENT_ID ? 'Present' : 'MISSING');
console.log('Client Secret:', ZOHO_CLIENT_SECRET ? 'Present' : 'MISSING');
console.log('Refresh Token:', ZOHO_REFRESH_TOKEN ? 'Present' : 'MISSING');

let accessToken = null;
let tokenExpiry = null;

// Middleware to parse JSON
app.use(express.json());

// Function to get a fresh access token
async function getAccessToken() {
    // If we have a valid token, use it
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
        return accessToken;
    }

    // Otherwise, get a new one using refresh token
    try {
        const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });

        accessToken = response.data.access_token;
        // Token expires in 1 hour, refresh 5 minutes early
        tokenExpiry = Date.now() + (55 * 60 * 1000);
        
        return accessToken;
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        throw error;
    }
}

// Function to find contact by email
async function findContactByEmail(email, token) {
    try {
        const response = await axios.get('https://www.zohoapis.com/crm/v2/Contacts/search', {
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`
            },
            params: {
                email: email
            }
        });

        if (response.data.data && response.data.data.length > 0) {
            return response.data.data[0].id;
        }
        
        return null;
    } catch (error) {
        if (error.response?.status === 404) {
            return null; // No contact found
        }
        console.error('Error searching for contact:', error.response?.data || error.message);
        throw error;
    }
}

// Function to update contact in Zoho CRM
async function updateContact(contactId, testimonial, token) {
    try {
        const response = await axios.put(
            `https://www.zohoapis.com/crm/v2/Contacts/${contactId}`,
            {
                data: [{
                    id: contactId,
                    Testimonial: testimonial,
                    Feedback_Received: true
                }]
            },
            {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error updating contact:', error.response?.data || error.message);
        throw error;
    }
}

// Webhook endpoint for Tally
app.post('/webhook/tally', async (req, res) => {
    try {
        console.log('Received webhook from Tally:', JSON.stringify(req.body, null, 2));

        // Extract data from Tally webhook
        const formData = req.body.data;
        
        // Get email and testimonial from the form submission
        const email = formData.fields.find(f => f.label === 'email')?.value;
        const testimonial = formData.fields.find(f => f.label === 'What would you tell other leaders considering working with me?')?.value;

        if (!email) {
            console.error('No email found in form submission');
            return res.status(400).json({ error: 'Email is required' });
        }

        if (!testimonial) {
            console.error('No testimonial found in form submission');
            return res.status(400).json({ error: 'Testimonial is required' });
        }

        // Get access token
        const token = await getAccessToken();

        // Find contact by email
        const contactId = await findContactByEmail(email, token);

        if (!contactId) {
            console.log(`No contact found with email: ${email}`);
            return res.status(404).json({ error: 'Contact not found in Zoho CRM' });
        }

        // Update contact with testimonial
        const result = await updateContact(contactId, testimonial, token);

        console.log('Successfully updated contact:', contactId);
        res.json({ success: true, contactId: contactId, message: 'Contact updated successfully' });

    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'Webhook server is running' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});
