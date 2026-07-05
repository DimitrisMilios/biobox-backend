const axios = require('axios');

const BOXNOW_BASE_URL = 'https://api.boxnow.gr'; // Using the production BoxNow API base URL as a default

/**
 * Get an authentication token from BoxNow
 */
async function getBoxNowToken() {
  const clientId = process.env.BOXNOW_CLIENT_ID;
  const clientSecret = process.env.BOXNOW_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing BoxNow Client ID or Secret in environment variables');
  }

  const response = await axios.post(`${BOXNOW_BASE_URL}/api/v1/auth-services/token`, {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  return response.data.access_token;
}

/**
 * Create a delivery request for a locker
 */
async function createDeliveryRequest(lockerId, buyerPhone, buyerName) {
  const token = await getBoxNowToken();

  // Based on standard BoxNow API structures for delivery requests
  // The exact payload might need adjustment depending on the specific BoxNow API documentation for the partner
  const payload = {
    delivery_requests: [
      {
        order_id: `tmp_${Date.now()}`, // Temporary internal id if needed
        destination: {
          type: 'locker',
          locker_id: lockerId
        },
        recipient: {
          name: buyerName,
          phone: buyerPhone
        }
      }
    ]
  };

  const response = await axios.post(`${BOXNOW_BASE_URL}/api/v1/delivery-requests`, payload, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  // Extract the voucher ID/PIN from the response. 
  // Assuming the response returns an array of results matching the request array
  const deliveryResult = response.data.data[0];
  
  if (!deliveryResult || !deliveryResult.voucher) {
    throw new Error('Failed to retrieve voucher from BoxNow API response');
  }

  return deliveryResult.voucher; // Assuming 'voucher' contains the 10-digit PIN
}

module.exports = {
  createDeliveryRequest
};
